import { useRef } from "react";
import Viewfinder from "./Viewfinder";
import Transcript, { type TranscriptState } from "./Transcript";
import { mmss, bytes } from "../lib/format";

export default function ReviewStage({
  previewUrl,
  durationSec,
  grootte,
  pointerCount,
  hasWebcam,
  transcript,
  titel,
  setTitel,
  bezig,
  onUpload,
  onBewerk,
  onRetry,
  onSkipTranscript,
  fout,
}: {
  previewUrl: string | null;
  durationSec: number;
  grootte: number;
  pointerCount: number;
  hasWebcam: boolean;
  transcript: TranscriptState;
  titel: string;
  setTitel: (t: string) => void;
  bezig: boolean;
  onUpload: () => void;
  onBewerk: () => void;
  onRetry: () => void;
  onSkipTranscript: () => void;
  fout: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  function seek(sec: number) {
    if (videoRef.current) {
      videoRef.current.currentTime = sec;
      videoRef.current.play().catch(() => {});
    }
  }

  const transcriberen = transcript.status === "bezig";
  // Webcam-opname met verdacht weinig videodata (< ~20 KB/s) → waarschijnlijk
  // een bevroren composite. Waarschuw zichtbaar i.p.v. stil te publiceren.
  const webcamVerdacht =
    hasWebcam && durationSec > 1 && grootte > 0 && grootte / durationSec < 20 * 1024;

  return (
    <div className="stage">
      <div className="stage__head">
        <span className="eyebrow">Stap 03 — Controleren</span>
        <h1>Bekijk en publiceer</h1>
        <p className="sub">Klik een transcript-regel om naar dat moment te springen.</p>
      </div>

      <div className="review">
        <div>
          <Viewfinder>
            {previewUrl ? (
              <video
                ref={videoRef}
                className="vf__media"
                style={{ aspectRatio: "16 / 9" }}
                src={previewUrl}
                controls
                playsInline
              />
            ) : (
              <div style={{ aspectRatio: "16 / 9", display: "grid", placeItems: "center" }}>
                <span className="muted">Geen preview</span>
              </div>
            )}
          </Viewfinder>

          <div className="readouts" style={{ marginTop: 16 }}>
            <div className="readout">
              <b>{mmss(durationSec)}</b>
              <span>Duur</span>
            </div>
            <div className="readout">
              <b>{bytes(grootte)}</b>
              <span>Grootte</span>
            </div>
            <div className="readout">
              <b>{pointerCount}</b>
              <span>Cursor-punten</span>
            </div>
            <div className="readout">
              <b style={{ color: hasWebcam ? "var(--accent)" : "var(--muted2)" }}>
                {hasWebcam ? "JA" : "NEE"}
              </b>
              <span>Webcam</span>
            </div>
          </div>

          {webcamVerdacht && (
            <p className="error" style={{ marginTop: 12 }}>
              ⚠️ De webcam-opname bevat erg weinig videodata — mogelijk is het beeld bevroren.
              Neem opnieuw op (of zonder webcam) en controleer de preview hierboven.
            </p>
          )}

          <div className="field">
            <label htmlFor="titel">Titel</label>
            <input
              id="titel"
              type="text"
              value={titel}
              onChange={(e) => setTitel(e.target.value)}
              placeholder="Bijv. Uitleg BTW-aangifte Q2"
            />
          </div>

          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={onRetry} disabled={bezig}>
              Opnieuw opnemen
            </button>
            <button className="btn btn-ghost" onClick={onBewerk} disabled={bezig}>
              Bewerken
            </button>
            <button className="btn btn-primary" onClick={onUpload} disabled={bezig}>
              {bezig ? "Publiceren…" : "Publiceren"}
            </button>
          </div>
          {transcriberen && (
            <div className="callout" style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5 }}>
                Transcript loopt nog — je kunt al publiceren; het wordt later toegevoegd.
              </span>
              <button className="link-knop" style={{ margin: 0 }} onClick={onSkipTranscript} disabled={bezig}>
                Transcript overslaan
              </button>
            </div>
          )}
          {fout && <p className="error" role="alert">{fout}</p>}
        </div>

        <Transcript state={transcript} onSeek={seek} />
      </div>
    </div>
  );
}
