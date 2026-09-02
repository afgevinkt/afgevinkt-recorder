import type { TranscriptSegment } from "../env";
import { mmss } from "../lib/format";

export interface TranscriptState {
  status: "idle" | "bezig" | "klaar" | "fout";
  fase?: "model" | "audio" | "transcriberen";
  pct?: number;
  segments: TranscriptSegment[];
  fout?: string;
}

const FASE_LABEL: Record<string, string> = {
  model: "Model laden (eenmalig)",
  audio: "Audio voorbereiden",
  transcriberen: "Transcriberen",
};

// Interactieve transcript: klik een segment om de video daarheen te spoelen.
export default function Transcript({
  state,
  onSeek,
}: {
  state: TranscriptState;
  onSeek: (sec: number) => void;
}) {
  return (
    <div className="transcript">
      <h3>Transcript</h3>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Lokaal gegenereerd — verlaat je machine niet.
      </p>

      {state.status === "bezig" && (
        <>
          <p className="muted" style={{ fontSize: 13 }}>
            {FASE_LABEL[state.fase ?? "transcriberen"]}…
            {state.fase === "model" && state.pct != null
              ? ` ${Math.round(Math.min(1, state.pct) * 100)}%`
              : ""}
          </p>
          {state.fase === "transcriberen" ? (
            <div className="progress bezig">
              <i />
            </div>
          ) : (
            <div className="progress">
              <i style={{ width: `${Math.round(Math.min(1, state.pct ?? 0) * 100)}%` }} />
            </div>
          )}
        </>
      )}

      {state.status === "fout" && (
        <p className="error">{state.fout ?? "Transcriptie mislukt"}</p>
      )}

      {state.status === "klaar" && state.segments.length === 0 && (
        <p className="muted" style={{ fontSize: 13 }}>Geen spraak herkend.</p>
      )}

      {state.segments.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {state.segments.map((s, i) => (
            <button key={i} className="seg" onClick={() => onSeek(s.start)}>
              <time>{mmss(s.start)}</time>
              <p>{s.text}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
