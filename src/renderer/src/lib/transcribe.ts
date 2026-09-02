import type { TranscriptSegment } from "../env";

// Transcriptie draait in het MAIN-proces (onnxruntime-node, native). Hier in de
// renderer doen we alleen het audio-decoderen (Web Audio API) en sturen we 16kHz
// mono PCM via IPC naar main. Geen WASM/CSP/threads meer in de renderer.

export interface TranscriptResult {
  transcript: string;
  segments: TranscriptSegment[];
  taal: string;
}

export type Voortgang = (fase: "audio" | "model" | "transcriberen", pct: number) => void;

const LEEG: TranscriptResult = { transcript: "", segments: [], taal: "nl" };

/** Decodeer een opname-blob naar 16kHz mono PCM (Float32) via de Web Audio API. */
async function blobNaarPcm16k(blob: Blob): Promise<Float32Array> {
  const ab = await blob.arrayBuffer();
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const decoded = await ctx.decodeAudioData(ab);
    if (decoded.numberOfChannels === 1) return decoded.getChannelData(0).slice();
    const l = decoded.getChannelData(0);
    const r = decoded.getChannelData(1);
    const out = new Float32Array(l.length);
    for (let i = 0; i < l.length; i++) out[i] = (l[i] + r[i]) / 2;
    return out;
  } finally {
    await ctx.close();
  }
}

export async function transcribeBlob(blob: Blob, voortgang?: Voortgang): Promise<TranscriptResult> {
  voortgang?.("audio", 0);

  let audio: Float32Array;
  try {
    audio = await blobNaarPcm16k(blob);
  } catch {
    // Geen (decodeerbare) audiotrack — bijv. microfoon geweigerd. Geen spraak,
    // geen foutmelding (audit #8).
    return LEEG;
  }
  if (audio.length === 0) return LEEG;

  const stop = window.api.onTranscribeProgress((p) =>
    voortgang?.(p.fase as "model" | "transcriberen", p.pct),
  );
  try {
    const res = await window.api.transcribe(audio.buffer as ArrayBuffer);
    if (!res.ok) throw new Error(res.fout);
    return { transcript: res.transcript, segments: res.segments, taal: res.taal };
  } finally {
    stop();
  }
}
