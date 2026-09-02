// Geïsoleerd transcriptie-proces (Electron utilityProcess). Whisper/onnxruntime
// draait HIER, niet in het main-proces: een crash/OOM van de native runtime kan
// zo de recorder niet meenemen, en de main-thread blokkeert niet.
// Communicatie via process.parentPort (MessagePort).

type AsrResult = { text?: string; chunks?: Array<{ timestamp: [number, number | null]; text: string }> };
type Asr = (audio: Float32Array, opts?: Record<string, unknown>) => Promise<AsrResult>;

interface RunMsg {
  type: "run";
  pcm: ArrayBuffer;
  model: string;
  cacheDir: string;
}

const TAAL = "dutch";

// ── Nederlandse na-correctie (vorm van vaktermen/acroniemen) ─────────────
const ACRONIEMEN: Record<string, string> = { vpb: "VPB", kvk: "KvK", zzp: "ZZP", iban: "IBAN", bsn: "BSN", btw: "btw" };
const VORM: Array<[RegExp, string]> = [
  [/\bbtw[-\s]?aangifte\b/gi, "btw-aangifte"],
  [/\bib[-\s]?aangifte\b/gi, "IB-aangifte"],
  [/\bvpb[-\s]?aangifte\b/gi, "VPB-aangifte"],
  [/\bwinst[-\s]?en[-\s]?verliesrekening\b/gi, "winst- en verliesrekening"],
  [/\bgrootboek\s?rekening\b/gi, "grootboekrekening"],
  [/\bloon\s?administratie\b/gi, "loonadministratie"],
  [/\bvennootschaps\s?belasting\b/gi, "vennootschapsbelasting"],
  [/\binkomsten\s?belasting\b/gi, "inkomstenbelasting"],
];
function corrigeerNederlands(tekst: string): string {
  let t = tekst;
  for (const [re, vervang] of VORM) t = t.replace(re, vervang);
  t = t.replace(/\b(vpb|kvk|zzp|iban|bsn|btw)\b/gi, (m) => ACRONIEMEN[m.toLowerCase()] ?? m);
  t = t.replace(/(^\s*|[.!?]\s+)([a-zà-ÿ])/g, (_m, p, c) => p + c.toUpperCase());
  return t;
}

let asrPromise: Promise<Asr> | null = null;
function getAsr(model: string, cacheDir: string, onModel: (pct: number) => void): Promise<Asr> {
  if (!asrPromise) {
    asrPromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = cacheDir;
      env.allowLocalModels = false;
      const p = await pipeline("automatic-speech-recognition", model, {
        progress_callback: (e: { status?: string; progress?: number }) => {
          if (e?.status === "progress" && typeof e.progress === "number") {
            onModel(Math.max(0, Math.min(1, e.progress / 100)));
          }
        },
      });
      return p as unknown as Asr;
    })().catch((e) => {
      asrPromise = null;
      throw e;
    });
  }
  return asrPromise;
}

interface ParentPort {
  on: (ev: "message", cb: (e: { data: RunMsg }) => void) => void;
  postMessage: (m: unknown) => void;
}
const port = (process as unknown as { parentPort: ParentPort }).parentPort;

port.on("message", async (e: { data: RunMsg }) => {
  const msg = e.data;
  if (!msg || msg.type !== "run") return;
  try {
    const audio = new Float32Array(msg.pcm);
    port.postMessage({ type: "progress", fase: "model", pct: 0 });
    const asr = await getAsr(msg.model, msg.cacheDir, (pct) => port.postMessage({ type: "progress", fase: "model", pct }));

    if (audio.length === 0) {
      port.postMessage({ type: "result", transcript: "", segments: [], taal: "nl" });
      return;
    }

    port.postMessage({ type: "progress", fase: "transcriberen", pct: 0 });
    const out = (await asr(audio, {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      language: TAAL,
      task: "transcribe",
    })) as AsrResult;

    const segments = (out.chunks ?? [])
      .map((c) => ({
        start: c.timestamp?.[0] ?? 0,
        end: c.timestamp?.[1] ?? c.timestamp?.[0] ?? 0,
        text: corrigeerNederlands((c.text ?? "").trim()),
      }))
      .filter((s) => s.text.length > 0);

    port.postMessage({
      type: "result",
      transcript: corrigeerNederlands((out.text ?? "").trim()),
      segments,
      taal: "nl",
    });
  } catch (err) {
    port.postMessage({ type: "error", fout: err instanceof Error ? err.message : "Transcriptie mislukt" });
  }
});
