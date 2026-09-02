import fixWebmDuration from "fix-webm-duration";
import type { CaptureEngine, CaptureOptions, CaptureResult } from "./CaptureEngine";

// v1/Fase 4-implementatie met de browser-MediaRecorder (ADR 5).
// - Scherm via getDisplayMedia (eigen bronkiezer in main bepaalt de bron) + microfoon.
// - Webcam (optioneel): als APARTE track opgenomen (niet ingebrand). De site-player
//   legt de webcam later gesynchroniseerd over het scherm (herplaatsbaar, achtergrond).
//   Geen canvas-compositing meer → lichter, geen tekenlus-lag.
// MediaRecorder-WebM mist duur-metadata → na afloop injecteren we de duur
// (fix-webm-duration) zodat seekbar/tijdlijn klopt.

function kiesMime(): string {
  const kandidaten = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  for (const m of kandidaten) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "video/webm";
}

/** Injecteert de echte duur in een WebM-blob (anders Infinity → kapotte seekbar). */
async function herstelDuur(blob: Blob, durationMs: number, mime: string): Promise<Blob> {
  if (!mime.includes("webm") || durationMs <= 0 || blob.size === 0) return blob;
  try {
    return await fixWebmDuration(blob, durationMs, { logger: false });
  } catch {
    return blob; // best-effort
  }
}

class TrackRecorder {
  private rec: MediaRecorder;
  private chunks: Blob[] = [];

  constructor(stream: MediaStream, mime: string, opts?: MediaRecorderOptions) {
    this.rec = new MediaRecorder(stream, { mimeType: mime, ...opts });
    this.rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.rec.start(1000);
  }

  stop(mime: string): Promise<Blob> {
    return new Promise((resolve) => {
      const lever = () => resolve(new Blob(this.chunks, { type: mime }));
      if (this.rec.state === "inactive") return lever();
      // Fallback-timeout: als 'onstop' nooit vuurt (track-teardown-race), lever
      // toch de tot dan toe verzamelde chunks i.p.v. eeuwig te hangen (I4).
      const timer = setTimeout(lever, 4000);
      const klaar = () => {
        clearTimeout(timer);
        lever();
      };
      this.rec.onstop = klaar;
      this.rec.onerror = klaar;
      try {
        this.rec.stop();
      } catch {
        klaar();
      }
    });
  }
}

export class MediaRecorderCaptureEngine implements CaptureEngine {
  readonly name = "MediaRecorderCaptureEngine";

  private mime = kiesMime();
  private screenStream: MediaStream | null = null;
  private webcamStream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private screenRec: TrackRecorder | null = null;
  private webcamRec: TrackRecorder | null = null;
  private startTs = 0;
  private heeftWebcam = false;
  private webcamFout: string | null = null;

  isSupported(): boolean {
    return (
      typeof MediaRecorder !== "undefined" &&
      !!navigator.mediaDevices?.getDisplayMedia &&
      !!navigator.mediaDevices?.getUserMedia
    );
  }

  async start(options: CaptureOptions): Promise<void> {
    // Scherm (video) — geen systeemaudio (out of scope).
    this.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 30 } },
      audio: false,
    });

    // Microfoon — best effort; zonder mic gaat de opname stil door.
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      this.micStream = null;
    }

    // Webcam (optioneel) — APARTE track.
    if (options.webcam) {
      try {
        this.webcamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        this.webcamFout = null;
      } catch (e) {
        this.webcamStream = null;
        this.webcamFout = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        // Niet stil falen: log de échte reden zodat we 'm kunnen diagnosticeren.
        console.error("[webcam] getUserMedia faalde:", e);
      }
    }
    this.heeftWebcam = !!this.webcamStream;

    // Scherm-video + mic-audio in één opname-stream.
    const schermOpname = new MediaStream();
    this.screenStream.getVideoTracks().forEach((t) => schermOpname.addTrack(t));
    this.micStream?.getAudioTracks().forEach((t) => schermOpname.addTrack(t));

    // OS-balk "delen stoppen" → laat Studio de volledige stop-flow draaien
    // (alle recorders + tracks afronden), i.p.v. half te stoppen (I5).
    this.screenStream.getVideoTracks()[0]?.addEventListener("ended", () => {
      options.onEnded?.();
    });

    // Kwaliteit: een opgegeven doel-bitrate begrenst de bestandsgrootte. De
    // mic-audio houden we compact (96 kbps). De webcam-bubble is klein → daar
    // hoeft de bitrate nooit hoger dan ~1 Mbps.
    const vbps = options.videoBitsPerSecond;
    const schermOpts: MediaRecorderOptions = vbps
      ? { videoBitsPerSecond: vbps, audioBitsPerSecond: 96_000 }
      : {};
    const webcamOpts: MediaRecorderOptions = vbps
      ? { videoBitsPerSecond: Math.min(vbps, 1_000_000) }
      : {};

    this.screenRec = new TrackRecorder(schermOpname, this.mime, schermOpts);
    if (this.webcamStream) {
      this.webcamRec = new TrackRecorder(this.webcamStream, this.mime, webcamOpts); // video-only track
    }
    this.startTs = performance.now();
  }

  async stop(): Promise<CaptureResult> {
    const durationSec = (performance.now() - this.startTs) / 1000;

    let screen = this.screenRec ? await this.screenRec.stop(this.mime) : new Blob();
    let webcam = this.webcamRec ? await this.webcamRec.stop(this.mime) : null;
    screen = await herstelDuur(screen, durationSec * 1000, this.mime);
    if (webcam) webcam = await herstelDuur(webcam, durationSec * 1000, this.mime);

    const heeftWebcam = this.heeftWebcam;
    this.cleanup();

    return { screen, webcam, heeftWebcam, durationSec, mimeType: this.mime };
  }

  getScreenStream(): MediaStream | null {
    return this.screenStream;
  }
  getWebcamStream(): MediaStream | null {
    return this.webcamStream;
  }
  getWebcamFout(): string | null {
    return this.webcamFout;
  }
  hasMic(): boolean {
    return !!this.micStream && this.micStream.getAudioTracks().some((t) => t.readyState === "live");
  }

  /** Stopt alle tracks/recorders (bij stop of bij afbreken/fout). */
  cleanup(): void {
    [this.screenStream, this.webcamStream, this.micStream].forEach((s) =>
      s?.getTracks().forEach((t) => t.stop()),
    );
    this.screenStream = this.webcamStream = this.micStream = null;
    this.screenRec = this.webcamRec = null;
  }
}
