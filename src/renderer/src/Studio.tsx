import { useEffect, useRef, useState } from "react";
import type { DesktopUser, SourceInfo, PointerSample, ClickSample } from "./env";
import Logo from "./components/Logo";
import SourcePicker from "./components/SourcePicker";
import RecordingStage from "./components/RecordingStage";
import ReviewStage from "./components/ReviewStage";
import EditorStage from "./components/EditorStage";
import OpnamenPage from "./components/OpnamenPage";
import type { TranscriptState } from "./components/Transcript";
import type { EditProject } from "./lib/edl";
import { MediaRecorderCaptureEngine } from "./capture/MediaRecorderCaptureEngine";
import type { CaptureEngine, CaptureResult } from "./capture/CaptureEngine";
import { transcribeBlob, type TranscriptResult } from "./lib/transcribe";

type Stap = "bron" | "gereed" | "opnemen" | "review" | "editor";

const RAIL = [
  { key: "bron", label: "Bron" },
  { key: "opnemen", label: "Opnemen", rec: true },
  { key: "review", label: "Controleren" },
  { key: "editor", label: "Bewerken" },
] as const;

function railIndex(stap: Stap): number {
  if (stap === "bron") return 0;
  if (stap === "review") return 2;
  if (stap === "editor") return 3;
  return 1;
}

// Opname-kwaliteit: doel-bitrate voor de scherm-video. Lager = veel kleiner
// bestand (handig binnen upload-limieten), hoger = scherpere tekst/details.
type Kwaliteit = "hoog" | "balans" | "compact";
const KWALITEIT: Record<Kwaliteit, { label: string; sub: string; videoBps: number }> = {
  hoog: { label: "Hoog", sub: "scherpst · ~30 MB/min", videoBps: 4_000_000 },
  balans: { label: "Gebalanceerd", sub: "aanbevolen · ~11 MB/min", videoBps: 1_500_000 },
  compact: { label: "Compact", sub: "klein bestand · ~5 MB/min", videoBps: 700_000 },
};

/** Rendert één frame uit een video-blob naar een JPEG (omslag/thumbnail). */
function maakThumbnail(blob: Blob, frameSec: number): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    const klaar = () => URL.revokeObjectURL(url);
    v.muted = true;
    v.preload = "auto";
    v.addEventListener("loadedmetadata", () => {
      v.currentTime = Math.min(Math.max(0, frameSec), Math.max(0, (v.duration || frameSec) - 0.05));
    });
    v.addEventListener("seeked", () => {
      try {
        const bw = v.videoWidth || 1280;
        const bh = v.videoHeight || 720;
        const w = 640;
        const h = Math.round(w * (bh / bw));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        if (!ctx) return reject(new Error("geen canvas-context"));
        ctx.drawImage(v, 0, 0, w, h);
        c.toBlob(
          (b) => {
            klaar();
            if (b) b.arrayBuffer().then(resolve, reject);
            else reject(new Error("thumbnail-encode faalde"));
          },
          "image/jpeg",
          0.82,
        );
      } catch (e) {
        klaar();
        reject(e);
      }
    });
    v.addEventListener("error", () => {
      klaar();
      reject(new Error("thumbnail: video-laadfout"));
    });
    v.src = url;
  });
}

export default function Studio({
  user,
  onLogout,
  onSessieVerlopen,
}: {
  user: DesktopUser;
  onLogout: () => void;
  onSessieVerlopen: () => void;
}) {
  const engineRef = useRef<CaptureEngine | null>(null);
  const stopRef = useRef<() => void>(() => {});
  const transcribePromiseRef = useRef<Promise<TranscriptResult> | null>(null);
  const transcriptTokenRef = useRef<{ cancelled: boolean; stale: boolean } | null>(null);

  const [stap, setStap] = useState<Stap>("bron");
  const [toonOpnamen, setToonOpnamen] = useState(false);
  // Bewerken vanuit de bibliotheek: het project-id dat we bijwerken (i.p.v. een
  // nieuwe upload) en de opgeslagen bewerking die de editor herstelt.
  const [bewerkId, setBewerkId] = useState<string | null>(null);
  const [initieelProject, setInitieelProject] = useState<EditProject | null>(null);
  const [bron, setBron] = useState<SourceInfo | null>(null);
  const [webcam, setWebcam] = useState(false);
  const [kwaliteit, setKwaliteit] = useState<Kwaliteit>("balans");
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const [webcamFout, setWebcamFout] = useState<string | null>(null);
  const [micActief, setMicActief] = useState(true);

  const [resultaat, setResultaat] = useState<CaptureResult | null>(null);
  const [pointer, setPointer] = useState<PointerSample[]>([]);
  const [clicks, setClicks] = useState<ClickSample[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [webcamUrl, setWebcamUrl] = useState<string | null>(null);
  const [titel, setTitel] = useState("");
  const [transcript, setTranscript] = useState<TranscriptState>({ status: "idle", segments: [] });

  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [klaar, setKlaar] = useState<string | null>(null);

  useEffect(() => () => void (previewUrl && URL.revokeObjectURL(previewUrl)), [previewUrl]);
  useEffect(() => () => void (webcamUrl && URL.revokeObjectURL(webcamUrl)), [webcamUrl]);
  stopRef.current = stop; // OS-"stop delen" roept altijd de actuele stop() aan

  async function kiesBron(s: SourceInfo) {
    await window.api.selectSource(s.id);
    setBron(s);
    setFout(null);
    setStap("gereed");
  }

  async function start() {
    setFout(null);
    const engine = new MediaRecorderCaptureEngine();
    if (!engine.isSupported()) {
      setFout("Opnemen wordt niet ondersteund in deze omgeving.");
      return;
    }
    engineRef.current = engine;
    setWebcamFout(null);
    try {
      // macOS: vraag camera-toegang (TCC) expliciet op vóór getUserMedia, anders
      // faalt de webcam stil. Geweigerd? → opname gaat door zonder webcam.
      if (webcam) {
        // Triggert de OS-camera-prompt indien nodig. NB: kan false geven terwijl
        // getUserMedia tóch een stream levert → niet als fataal behandelen.
        await window.api.ensureCamera();
      }
      await engine.start({
        webcam,
        videoBitsPerSecond: KWALITEIT[kwaliteit].videoBps,
        onEnded: () => stopRef.current(),
      });
      await window.api.startPointer();
      setScreenStream(engine.getScreenStream());
      const ws = engine.getWebcamStream();
      setWebcamStream(ws);
      // Webcam gevraagd maar geen stream gekregen → toon de échte reden.
      if (webcam && !ws) {
        setWebcamFout(engine.getWebcamFout() ?? "Webcam niet beschikbaar (geen camera gevonden of in gebruik).");
      }
      setMicActief(engine.hasMic());
      setStap("opnemen");
    } catch (e) {
      // Half-gestarte opname netjes opruimen (tracks vrijgeven) — audit #5.
      engine.cleanup();
      engineRef.current = null;
      setFout(
        e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "NotFoundError")
          ? "Geen bron gekozen of geen toestemming. Kies een scherm/venster en sta opnemen toe."
          : e instanceof Error
            ? e.message
            : "Kon de opname niet starten.",
      );
      setStap("gereed");
    }
  }

  async function stop() {
    const engine = engineRef.current;
    if (!engine) return;
    engineRef.current = null; // guard tegen dubbele stop (OS-stop + handmatig, I3)

    let res: CaptureResult;
    let samples: PointerSample[] = [];
    let klikken: ClickSample[] = [];
    try {
      res = await engine.stop();
    } catch {
      engine.cleanup();
      res = { screen: new Blob(), webcam: null, heeftWebcam: false, durationSec: 0, mimeType: "video/webm" };
    } finally {
      // Pointer/klik-hook ALTIJD stoppen, ook als engine.stop() faalt (I3).
      const r = await window.api.stopPointer().catch(() => ({ pointer: [], clicks: [] }));
      samples = r.pointer;
      klikken = r.clicks;
    }

    setScreenStream(null);
    setWebcamStream(null);
    setResultaat(res);
    setPointer(samples);
    setClicks(klikken);

    const url = URL.createObjectURL(res.screen);
    setPreviewUrl(url);
    if (res.webcam) setWebcamUrl(URL.createObjectURL(res.webcam));
    setTitel((t) => t || standaardTitel());
    setStap("review");

    // Transcriptie lokaal starten op de ACHTERGROND (blokkeert publiceren niet).
    // Het model wordt de eerste keer eenmalig gedownload. Een token maakt
    // 'Overslaan' mogelijk zonder de UI te blokkeren.
    // Een eventueel nog lopend vorig transcript mag deze UI niet meer raken (audit #7).
    if (transcriptTokenRef.current) transcriptTokenRef.current.stale = true;

    // cancelled = gebruiker koos 'Overslaan' (geen UI-update, geen PATCH).
    // stale = nieuwe opname gestart (stop UI-update, maar PATCH mag doorgaan).
    const token = { cancelled: false, stale: false };
    transcriptTokenRef.current = token;
    const versUI = () => !token.cancelled && !token.stale;
    setTranscript({ status: "bezig", fase: "model", pct: 0, segments: [] });
    const p = transcribeBlob(res.screen, (fase, pct) => {
      if (versUI()) setTranscript((s) => ({ ...s, status: "bezig", fase, pct }));
    });
    transcribePromiseRef.current = p;
    p.then((r) => {
      if (versUI()) setTranscript({ status: "klaar", segments: r.segments, pct: 1 });
    }).catch((e) => {
      if (versUI())
        setTranscript({
          status: "fout",
          segments: [],
          fout: e instanceof Error ? e.message : "Transcriptie mislukt",
        });
    });
  }

  function slaTranscriptOver() {
    if (transcriptTokenRef.current) transcriptTokenRef.current.cancelled = true;
    window.api.cancelTranscribe(); // stop het zware proces (I6)
    setTranscript((s) => ({ status: "klaar", segments: s.segments }));
  }

  async function upload(editProject?: EditProject) {
    if (!resultaat) return;
    setBezig(true);
    setFout(null);

    // Loopt het transcript nog? Dan publiceren we nu zonder, en koppelen we het
    // later op de achtergrond (PATCH) zodra het klaar is. Geen blokkade.
    const transcriptBezig = transcript.status === "bezig";
    const lopendeTranscript = transcribePromiseRef.current;
    const lopendToken = transcriptTokenRef.current;

    try {
      const screenBuf = await resultaat.screen.arrayBuffer();
      const webcamBuf = resultaat.webcam ? await resultaat.webcam.arrayBuffer() : null;
      // Omslag/thumbnail: render het gekozen frame uit het scherm-blob naar JPEG.
      const thumb = editProject?.thumbnail;
      const thumbnailBuf =
        thumb && thumb.kind === "frame"
          ? await maakThumbnail(resultaat.screen, thumb.frameSec).catch(() => null)
          : null;
      const res = await window.api.upload({
        screenBuf,
        webcamBuf,
        thumbnailBuf,
        pointer,
        titel: titel.trim() || standaardTitel(),
        durationSec: resultaat.durationSec,
        mimeType: resultaat.mimeType,
        heeftWebcam: resultaat.heeftWebcam,
        transcript: transcript.segments.map((s) => s.text).join(" "),
        segments: transcript.segments,
        taal: "nl",
        editProject: editProject ?? null,
      });
      if (res.ok) {
        const opnameId = res.id;
        if (transcriptBezig && lopendeTranscript) {
          // Achtergrond: koppel het transcript zodra Whisper klaar is.
          lopendeTranscript
            .then((r) => {
              if (lopendToken?.cancelled || r.segments.length === 0) return;
              return window.api.updateTranscript({
                id: opnameId,
                transcript: r.segments.map((s) => s.text).join(" "),
                segments: r.segments,
                taal: r.taal,
              });
            })
            .catch(() => {
              /* best-effort — opname is al gepubliceerd */
            });
          setKlaar("Opname gepubliceerd — het transcript wordt op de achtergrond toegevoegd.");
        } else {
          setKlaar("Opname gepubliceerd — terug te zien onder ‘Opnames’ in Afgevinkt!");
        }
        reset();
      } else if (res.needsLogin) {
        onSessieVerlopen();
      } else {
        setFout(res.fout);
        setBezig(false);
      }
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Upload mislukt");
      setBezig(false);
    }
  }

  // Open een opgeslagen opname terug in de editor (incl. bewaarde bewerkingen).
  async function bewerkOpname(id: string) {
    setFout(null);
    const r = await window.api.loadOpnameVoorEditor(id);
    if (!r.ok) {
      setFout(r.fout);
      return;
    }
    const screenBlob = new Blob([r.screen], { type: r.mimeType });
    const webcamBlob = r.webcam ? new Blob([r.webcam], { type: r.mimeType }) : null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (webcamUrl) URL.revokeObjectURL(webcamUrl);
    setResultaat({
      screen: screenBlob,
      webcam: webcamBlob,
      heeftWebcam: r.heeftWebcam,
      durationSec: r.durationSec,
      mimeType: r.mimeType,
    });
    setPreviewUrl(URL.createObjectURL(screenBlob));
    setWebcamUrl(webcamBlob ? URL.createObjectURL(webcamBlob) : null);
    setPointer([]);
    setClicks([]); // klikken worden niet bewaard; auto-zoom is hier leeg
    setTranscript({ status: "klaar", segments: r.segments });
    setTitel(r.titel);
    setInitieelProject(r.editProject);
    setBewerkId(id);
    setToonOpnamen(false);
    setStap("editor");
  }

  // Publiceren vanuit de editor wanneer we een BESTAANDE opname bewerken:
  // werk de bewaarde map bij (geen dubbele kopie) en upload opnieuw.
  async function publiceerBewerking(editProject: EditProject) {
    if (!bewerkId || !resultaat) return;
    setBezig(true);
    setFout(null);
    try {
      const thumb = editProject.thumbnail;
      const thumbnailBuf =
        thumb && thumb.kind === "frame"
          ? await maakThumbnail(resultaat.screen, thumb.frameSec).catch(() => null)
          : null;
      const res = await window.api.updateEnPubliceer(bewerkId, editProject, thumbnailBuf);
      if (res.ok) {
        setKlaar("Bewerking opgeslagen en opnieuw gepubliceerd.");
        reset();
        setToonOpnamen(true); // terug naar de bibliotheek
      } else if (res.needsLogin) {
        onSessieVerlopen();
      } else {
        setFout(res.fout);
        setBezig(false);
      }
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Publiceren mislukt");
      setBezig(false);
    }
  }

  function reset() {
    // Markeer een eventueel nog lopend transcript als 'stale': het mag de UI
    // van de volgende opname niet meer aanraken (de PATCH loopt los door).
    if (transcriptTokenRef.current) transcriptTokenRef.current.stale = true;
    transcriptTokenRef.current = null;
    transcribePromiseRef.current = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (webcamUrl) URL.revokeObjectURL(webcamUrl);
    setPreviewUrl(null);
    setWebcamUrl(null);
    setResultaat(null);
    setPointer([]);
    setClicks([]);
    setTitel("");
    setTranscript({ status: "idle", segments: [] });
    setBron(null);
    setBezig(false);
    setBewerkId(null);
    setInitieelProject(null);
    setStap("bron");
  }

  const huidig = railIndex(stap);

  return (
    <div className="shell">
      <aside className="rail">
        <Logo />
        <ol className="steps">
          {RAIL.map((s, i) => {
            const state = i < huidig ? "done" : i === huidig ? "active" : "todo";
            const rec = s.key === "opnemen" && stap === "opnemen";
            return (
              <li
                key={s.key}
                className={`step${rec ? " step--rec" : ""}`}
                data-state={state}
              >
                <span className="step__num">{String(i + 1).padStart(2, "0")}</span>
                <span className="step__label">{s.label}</span>
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          className={`rail-nav${toonOpnamen ? " is-active" : ""}`}
          onClick={() => setToonOpnamen(true)}
          disabled={stap === "opnemen"}
          title={stap === "opnemen" ? "Beschikbaar zodra de opname is gestopt" : undefined}
        >
          Mijn opnamen
        </button>
        <div className="rail__foot">
          <div className="who">
            <span className="avatar">{user.initialen || "?"}</span>
            <span>{user.naam}</span>
          </div>
          <button className="btn btn-ghost" onClick={onLogout}>
            Uitloggen
          </button>
        </div>
      </aside>

      {toonOpnamen ? (
        <OpnamenPage
          onTerug={() => setToonOpnamen(false)}
          onSessieVerlopen={onSessieVerlopen}
          onBewerk={bewerkOpname}
        />
      ) : (
        <>
      {stap === "bron" && (
        <div className="stage">
          <div className="stage__head">
            <span className="eyebrow">Stap 01 — Bron</span>
            <h1>Wat wil je opnemen?</h1>
            <p className="sub">Kies een volledig scherm of een specifiek venster.</p>
          </div>
          <SourcePicker onChoose={kiesBron} />
          {klaar && <p className="ok" style={{ marginTop: 16 }}>{klaar}</p>}
          {fout && <p className="error">{fout}</p>}
        </div>
      )}

      {stap === "gereed" && bron && (
        <div className="stage">
          <div className="stage__head">
            <span className="eyebrow">Stap 02 — Opnemen</span>
            <h1>Klaar om op te nemen</h1>
            <p className="sub">Bron: {bron.naam}</p>
          </div>
          <div className="panel" style={{ maxWidth: 560 }}>
            {bron.thumbnail && (
              <img
                src={bron.thumbnail}
                alt=""
                style={{ width: "100%", borderRadius: 10, border: "1px solid var(--line)" }}
              />
            )}
            <label className="toggle" style={{ marginTop: 16 }}>
              <input type="checkbox" checked={webcam} onChange={(e) => setWebcam(e.target.checked)} />
              Webcam meenemen (aparte track)
            </label>
            <div style={{ marginTop: 16 }}>
              <span className="muted" style={{ fontSize: 12 }}>Kwaliteit</span>
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                {(Object.keys(KWALITEIT) as Kwaliteit[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className="btn btn-ghost"
                    aria-selected={kwaliteit === k}
                    onClick={() => setKwaliteit(k)}
                    style={{ flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "8px 12px" }}
                  >
                    <b style={{ fontSize: 13 }}>{KWALITEIT[k].label}</b>
                    <span style={{ fontSize: 11, opacity: 0.75 }}>{KWALITEIT[k].sub}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="row" style={{ marginTop: 18 }}>
              <button className="btn btn-ghost" onClick={() => setStap("bron")}>
                Andere bron
              </button>
              <button className="btn btn-rec" onClick={start}>
                ● Opname starten
              </button>
            </div>
            {fout && <p className="error">{fout}</p>}
          </div>
        </div>
      )}

      {stap === "opnemen" && (
        <RecordingStage
          screenStream={screenStream}
          webcamStream={webcamStream}
          webcamGevraagd={webcam}
          webcamFout={webcamFout}
          micActief={micActief}
          bronNaam={bron?.naam ?? ""}
          onStop={stop}
        />
      )}

      {stap === "review" && (
        <ReviewStage
          previewUrl={previewUrl}
          durationSec={resultaat?.durationSec ?? 0}
          grootte={resultaat?.screen.size ?? 0}
          pointerCount={pointer.length}
          hasWebcam={resultaat?.heeftWebcam ?? false}
          transcript={transcript}
          titel={titel}
          setTitel={setTitel}
          bezig={bezig}
          onUpload={() => upload()}
          onBewerk={() => setStap("editor")}
          onRetry={reset}
          onSkipTranscript={slaTranscriptOver}
          fout={fout}
        />
      )}

      {stap === "editor" && (
        <EditorStage
          previewUrl={previewUrl}
          webcamUrl={webcamUrl}
          durationSec={resultaat?.durationSec ?? 0}
          segments={transcript.segments}
          clicks={clicks}
          hasWebcam={resultaat?.heeftWebcam ?? false}
          bezig={bezig}
          initieelProject={initieelProject}
          onTerug={() => {
            if (bewerkId) {
              reset();
              setToonOpnamen(true);
            } else {
              setStap("review");
            }
          }}
          onPubliceer={(edl) => (bewerkId ? publiceerBewerking(edl) : upload(edl))}
        />
      )}
        </>
      )}
    </div>
  );
}

function standaardTitel(): string {
  const d = new Date();
  const dd = d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  const tt = d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  return `Opname ${dd} ${tt}`;
}
