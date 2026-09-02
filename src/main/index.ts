import { app, BrowserWindow, ipcMain, session, desktopCapturer, screen, systemPreferences, utilityProcess, shell } from "electron";
import { join } from "node:path";
import { mkdir, writeFile, readFile, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { saveSession, loadSession, clearSession, type DesktopUser, type Session } from "./store";

// Productie-site. Override mogelijk via env (bijv. lokaal testen tegen
// http://localhost:3000) zonder de build aan te passen.
const DEFAULT_BASE_URL = process.env.AFGEVINKT_BASE_URL || "https://afgevinkt.nl";

let mainWindow: BrowserWindow | null = null;
let selectedSourceId: string | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 880,
    minHeight: 620,
    backgroundColor: "#0A0E13",
    title: "Afgevinkt Recorder",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      // KRITISCH voor een recorder: het opnamevenster staat tijdens opnemen op
      // de achtergrond. Zonder dit throttelt Chromium timers/frames naar ~1fps,
      // waardoor de canvas-compositing (webcam) bevriest → lege/minuscule video.
      backgroundThrottling: false,
    },
  });

  // Scherm-picker: we tonen een EIGEN, vormgegeven bronkiezer in de app (geen
  // native picker). De gebruiker kiest een bron; die id zetten we in
  // selectedSourceId. De handler geeft exact die bron terug. Systeemaudio is
  // bewust buiten scope v1 — we vragen hier géén loopback-audio aan.
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer.getSources({ types: ["screen", "window"] }).then((sources) => {
      // Exact de gekozen bron; niet stilletjes terugvallen op scherm #1 (audit #10).
      const chosen = sources.find((s) => s.id === selectedSourceId);
      callback(chosen ? { video: chosen } : {}); // {} → getDisplayMedia weigert → nette fout
    });
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// ── Globale cursor-timeline + klik-capture (auto-zoom) ───────────────────
// Cursorpositie via screen.getCursorScreenPoint() (geen permissie nodig).
// Echte KLIKKEN via uiohook-napi (native, vereist macOS Toegankelijkheid).
// Klik-coördinaten worden genormaliseerd (0–1) t.o.v. het display onder de klik
// → bruikbaar als zoom-centrum. Faalt de hook/permissie: clicks blijft leeg.
interface PointerSample {
  t: number;
  x: number;
  y: number;
}
interface ClickSample {
  t: number; // ms sinds start
  cx: number; // genormaliseerd 0–1
  cy: number;
}
let pointerTimer: ReturnType<typeof setInterval> | null = null;
let pointerSamples: PointerSample[] = [];
let pointerStart = 0;

let clickSamples: ClickSample[] = [];
let clickHandler: ((e: { x: number; y: number }) => void) | null = null;
let hookActief = false;

function startPointer(): void {
  if (pointerTimer || hookActief) stopPointer(); // idempotent: nooit dubbel starten (I2)
  pointerSamples = [];
  pointerStart = Date.now();
  pointerTimer = setInterval(() => {
    const p = screen.getCursorScreenPoint();
    pointerSamples.push({ t: Date.now() - pointerStart, x: p.x, y: p.y });
  }, 1000 / 30);

  // Klik-hook (best-effort).
  clickSamples = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { uIOhook } = require("uiohook-napi") as {
      uIOhook: {
        on: (ev: string, cb: (e: { x: number; y: number }) => void) => void;
        off: (ev: string, cb: (e: { x: number; y: number }) => void) => void;
        start: () => void;
        stop: () => void;
      };
    };
    clickHandler = (e) => {
      const disp = screen.getDisplayNearestPoint({ x: e.x, y: e.y });
      const b = disp.bounds;
      const cx = b.width ? (e.x - b.x) / b.width : 0.5;
      const cy = b.height ? (e.y - b.y) / b.height : 0.5;
      clickSamples.push({
        t: Date.now() - pointerStart,
        cx: Math.max(0, Math.min(1, cx)),
        cy: Math.max(0, Math.min(1, cy)),
      });
    };
    uIOhook.on("mousedown", clickHandler);
    uIOhook.start();
    hookActief = true;
  } catch (e) {
    console.warn("[recorder] klik-hook niet beschikbaar (permissie/native):", e instanceof Error ? e.message : e);
    hookActief = false;
  }
}

function stopPointer(): { pointer: PointerSample[]; clicks: ClickSample[] } {
  if (pointerTimer) clearInterval(pointerTimer);
  pointerTimer = null;
  if (hookActief) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { uIOhook } = require("uiohook-napi") as {
        uIOhook: { off: (ev: string, cb: (e: { x: number; y: number }) => void) => void; stop: () => void };
      };
      if (clickHandler) uIOhook.off("mousedown", clickHandler);
      uIOhook.stop();
    } catch {
      /* best-effort */
    }
  }
  clickHandler = null;
  hookActief = false;
  return { pointer: pointerSamples, clicks: clickSamples };
}

// ── IPC: sessie/auth ─────────────────────────────────────────────────────

ipcMain.handle("auth:session", () => {
  const s = loadSession();
  return s ? { loggedIn: true, user: s.user, baseUrl: s.baseUrl } : { loggedIn: false, baseUrl: DEFAULT_BASE_URL };
});

ipcMain.handle(
  "auth:login",
  async (
    _e,
    { baseUrl, email, wachtwoord, totp }: { baseUrl: string; email: string; wachtwoord: string; totp?: string },
  ) => {
    const url = (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    try {
      const res = await fetch(`${url}/api/desktop/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // totp = 6-cijferige TOTP-code óf back-upcode; alleen meesturen als ingevuld.
        body: JSON.stringify({ email, wachtwoord, totp: totp ? totp : undefined }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        token?: string;
        user?: DesktopUser;
        fout?: string;
        error?: string;
      };
      if (!res.ok || !body.token || !body.user) {
        // `code` = machine-leesbaar 2FA-signaal (TOTP_VEREIST/ONGELDIG/SETUP_VEREIST)
        // zodat de renderer een codeprompt kan tonen.
        return { ok: false as const, fout: body.fout ?? "Inloggen mislukt", code: body.error };
      }
      saveSession({ baseUrl: url, token: body.token, user: body.user });
      return { ok: true as const, user: body.user };
    } catch (e) {
      return { ok: false as const, fout: e instanceof Error ? e.message : "Kan de server niet bereiken" };
    }
  },
);

ipcMain.handle("auth:logout", () => {
  clearSession();
  return { ok: true };
});

// ── IPC: bronkiezer (schermen + vensters met thumbnails) ────────────────

ipcMain.handle("capture:sources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 200 },
    fetchWindowIcons: true,
  });
  return sources.map((s) => ({
    id: s.id,
    naam: s.name,
    type: s.id.startsWith("screen:") ? ("screen" as const) : ("window" as const),
    thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
    appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
  }));
});

// macOS camera-toegang (TCC). getUserMedia faalt stil als de OS-permissie niet is
// gegeven; hier triggeren/controleren we hem expliciet vóór we de webcam opvragen.
ipcMain.handle("media:ensureCamera", async () => {
  if (process.platform !== "darwin") return { ok: true, status: "granted" };
  const status = systemPreferences.getMediaAccessStatus("camera");
  if (status === "granted") return { ok: true, status };
  if (status === "not-determined") {
    const ok = await systemPreferences.askForMediaAccess("camera");
    return { ok, status: ok ? "granted" : "denied" };
  }
  // denied/restricted → gebruiker moet het in Systeeminstellingen aanzetten.
  return { ok: false, status };
});

ipcMain.handle("capture:select", (_e, id: string) => {
  selectedSourceId = id;
  return { ok: true };
});

// ── IPC: pointer-capture ─────────────────────────────────────────────────

ipcMain.handle("pointer:start", () => {
  startPointer();
  return { ok: true };
});
ipcMain.handle("pointer:stop", () => stopPointer());

// ── IPC: lokale transcriptie (Whisper, GEÏSOLEERD in een utilityProcess) ─
// onnxruntime draait in een apart proces: een crash/OOM neemt de recorder niet
// mee en de main-thread blokkeert niet. Bij een crash met whisper-small valt
// het automatisch terug op whisper-base (lichter) en onthouden we dat.
interface TranscribeResult {
  ok: boolean;
  transcript?: string;
  segments?: TranscriptSegment[];
  taal?: string;
  fout?: string;
  crashed?: boolean;
}

let smallOnbruikbaar = false; // onthoud per sessie dat het zware model crashte
let huidigeWorker: ReturnType<typeof utilityProcess.fork> | null = null;
let transcriptieGeannuleerd = false;
const TRANSCRIBE_TIMEOUT_MS = 12 * 60 * 1000; // watchdog tegen vastlopen

function stopHuidigeWorker(): void {
  if (huidigeWorker) {
    try {
      huidigeWorker.kill();
    } catch {
      /* al gestopt */
    }
    huidigeWorker = null;
  }
}

function transcribeInWorker(
  pcm: ArrayBuffer,
  model: string,
  onProgress: (fase: string, pct: number) => void,
): Promise<TranscribeResult> {
  return new Promise((resolve) => {
    stopHuidigeWorker(); // nooit twee zware processen tegelijk (C1)
    const child = utilityProcess.fork(join(__dirname, "transcribe-worker.js"));
    huidigeWorker = child;
    let klaar = false;
    const timer = setTimeout(
      () => af({ ok: false, crashed: true, fout: "Transcriptie duurde te lang en is afgebroken." }),
      TRANSCRIBE_TIMEOUT_MS,
    );
    const af = (r: TranscribeResult) => {
      if (klaar) return;
      klaar = true;
      clearTimeout(timer);
      if (huidigeWorker === child) huidigeWorker = null;
      try {
        child.kill();
      } catch {
        /* al gestopt */
      }
      resolve(r);
    };
    child.on(
      "message",
      (m: { type: string; fase?: string; pct?: number; transcript?: string; segments?: TranscriptSegment[]; taal?: string; fout?: string }) => {
        if (m.type === "progress") onProgress(m.fase ?? "model", m.pct ?? 0);
        else if (m.type === "result") af({ ok: true, transcript: m.transcript, segments: m.segments, taal: m.taal });
        else if (m.type === "error") af({ ok: false, fout: m.fout });
      },
    );
    child.on("exit", (code) => {
      if (!klaar) af({ ok: false, crashed: true, fout: `Transcriptie-proces gestopt (code ${code})` });
    });
    child.postMessage({ type: "run", pcm, model, cacheDir: join(app.getPath("userData"), "models") });
  });
}

// Annuleren (gebruiker koos 'Overslaan') → stop de worker, geen fallback.
ipcMain.handle("transcribe:cancel", () => {
  transcriptieGeannuleerd = true;
  stopHuidigeWorker();
  return { ok: true };
});

ipcMain.handle("transcribe:run", async (e, payload: { pcm: ArrayBuffer }) => {
  transcriptieGeannuleerd = false;
  const send = (fase: string, pct: number) => {
    if (!e.sender.isDestroyed()) e.sender.send("transcribe:progress", { fase, pct });
  };
  const voorkeur = process.env.WHISPER_MODEL || "Xenova/whisper-small";
  const eerste = smallOnbruikbaar ? "Xenova/whisper-base" : voorkeur;

  let res = await transcribeInWorker(payload.pcm, eerste, send);

  // Door gebruiker geannuleerd? Niet terugvallen, gewoon stoppen.
  if (transcriptieGeannuleerd) return { ok: false as const, fout: "Geannuleerd" };

  // Crashte het zware model? Eenmalig terugvallen op base (en onthouden).
  if (!res.ok && res.crashed && eerste !== "Xenova/whisper-base") {
    smallOnbruikbaar = true;
    send("model", 0);
    res = await transcribeInWorker(payload.pcm, "Xenova/whisper-base", send);
    if (transcriptieGeannuleerd) return { ok: false as const, fout: "Geannuleerd" };
  }

  return res.ok
    ? { ok: true as const, transcript: res.transcript, segments: res.segments, taal: res.taal }
    : { ok: false as const, fout: res.fout };
});

// ── IPC: opname opslaan + uploaden ───────────────────────────────────────
// Renderer levert de opgenomen bytes (ArrayBuffer). We schrijven het
// Opname-project lokaal weg (ruwe footage blijft op de machine — ADR 3) en
// uploaden in v1 alleen de scherm-track naar de site.

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

interface UploadPayload {
  screenBuf: ArrayBuffer;
  webcamBuf: ArrayBuffer | null;
  thumbnailBuf: ArrayBuffer | null;
  pointer: PointerSample[];
  titel: string;
  durationSec: number;
  mimeType: string;
  heeftWebcam: boolean;
  transcript: string;
  segments: TranscriptSegment[];
  taal: string;
  editProject: unknown | null;
}

ipcMain.handle("opname:upload", async (_e, payload: UploadPayload) => {
  const s = loadSession();
  if (!s) return { ok: false as const, fout: "Niet ingelogd" };

  // 1) Lokaal Opname-project wegschrijven (non-destructief; voor latere editor).
  const ext = payload.mimeType.includes("mp4") ? "mp4" : "webm";
  const projectDir = join(app.getPath("userData"), "opnames", String(Date.now()));
  try {
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, `screen.${ext}`), Buffer.from(payload.screenBuf));
    if (payload.webcamBuf) {
      await writeFile(join(projectDir, `webcam.${ext}`), Buffer.from(payload.webcamBuf));
    }
    if (payload.thumbnailBuf) {
      await writeFile(join(projectDir, "thumbnail.jpg"), Buffer.from(payload.thumbnailBuf));
    }
    await writeFile(join(projectDir, "pointer.json"), JSON.stringify(payload.pointer));
    await writeFile(
      join(projectDir, "transcript.json"),
      JSON.stringify({ taal: payload.taal, transcript: payload.transcript, segments: payload.segments }),
    );
    if (payload.editProject) {
      await writeFile(join(projectDir, "edit.json"), JSON.stringify(payload.editProject));
    }
    await writeFile(
      join(projectDir, "project.json"),
      JSON.stringify(
        {
          titel: payload.titel,
          durationSec: payload.durationSec,
          mimeType: payload.mimeType,
          heeftWebcam: payload.heeftWebcam,
          taal: payload.taal,
          captureEngine: "MediaRecorderCaptureEngine",
          transcriber: "whisper-base (transformers.js, WASM)",
        },
        null,
        2,
      ),
    );
  } catch (e) {
    return { ok: false as const, fout: `Lokaal opslaan mislukt: ${e instanceof Error ? e.message : e}` };
  }

  // 2) Scherm-track uploaden naar de site (Bearer-token blijft in main).
  try {
    const mimeKaal = baseMime(payload.mimeType);
    const form = new FormData();
    form.set("video", new Blob([payload.screenBuf], { type: mimeKaal }), `opname.${ext}`);
    if (payload.webcamBuf) {
      form.set("webcam", new Blob([payload.webcamBuf], { type: mimeKaal }), `webcam.${ext}`);
    }
    if (payload.thumbnailBuf) {
      form.set("thumbnail", new Blob([payload.thumbnailBuf], { type: "image/jpeg" }), "thumbnail.jpg");
    }
    form.set("titel", payload.titel);
    form.set("duur_sec", String(Math.round(payload.durationSec)));
    form.set("heeft_webcam", String(payload.heeftWebcam));
    form.set("transcript", payload.transcript);
    form.set("segments", JSON.stringify(payload.segments));
    form.set("taal", payload.taal);
    if (payload.editProject) form.set("edit_project", JSON.stringify(payload.editProject));

    const r = await postOpnameForm(s, form);
    if (r.ok) {
      await markeerGepubliceerd(projectDir, r.id, s.baseUrl);
      return { ok: true as const, id: r.id, projectDir };
    }
    return r.needsLogin
      ? { ok: false as const, fout: r.fout, needsLogin: true }
      : { ok: false as const, fout: r.fout };
  } catch (e) {
    return { ok: false as const, fout: e instanceof Error ? e.message : "Upload mislukt" };
  }
});

// ── IPC: opslagen opnamen (lokale bibliotheek) + opnieuw publiceren ───────
// De ruwe footage blijft non-destructief in userData/opnames/<timestamp>/.
// Deze handlers laten de renderer die map tonen, afspelen, opnieuw uploaden
// en verwijderen — zónder paden uit de renderer te vertrouwen (alleen de id =
// mapnaam, gefilterd) en zónder ooit het Bearer-token naar de renderer te geven.

function opnamesRoot(): string {
  return join(app.getPath("userData"), "opnames");
}

/** Valideert een opname-id (mapnaam) en geeft het volledige, bestaande pad terug. */
function veiligOpnameDir(id: string): string {
  const naam = String(id).replace(/[^0-9A-Za-z_-]/g, "");
  const dir = join(opnamesRoot(), naam);
  if (!naam || !existsSync(dir)) throw new Error("Opname niet gevonden");
  return dir;
}

/** Welke video-extensie heeft dit project (mp4 of webm)? */
function videoExt(mimeType: unknown): "mp4" | "webm" {
  return String(mimeType || "").includes("mp4") ? "mp4" : "webm";
}

/**
 * Basis-MIME zonder codec-parameters. MediaRecorder levert "video/webm;codecs=vp9,opus";
 * de site toetst het bestandstype op de kale "video/webm". Strip dus de parameters.
 */
function baseMime(mimeType: unknown): string {
  return String(mimeType || "").split(";")[0].trim() || "video/webm";
}

/** POST een opgebouwde FormData naar de site; tolkt 401 (sessie verlopen). */
async function postOpnameForm(
  s: Session,
  form: FormData,
): Promise<{ ok: true; id: string } | { ok: false; fout: string; needsLogin?: boolean }> {
  const res = await fetch(`${s.baseUrl}/api/opnames/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${s.token}` },
    body: form,
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; fout?: string };
  if (res.status === 401) return { ok: false, fout: "Sessie verlopen — log opnieuw in", needsLogin: true };
  if (!res.ok || !body.id) return { ok: false, fout: body.fout ?? "Upload mislukt" };
  return { ok: true, id: body.id };
}

/** Schrijft uploaded.json zodat de bibliotheek 'Gepubliceerd' kan tonen. */
async function markeerGepubliceerd(projectDir: string, id: string, baseUrl: string): Promise<void> {
  await writeFile(
    join(projectDir, "uploaded.json"),
    JSON.stringify({ id, baseUrl, uploadedAt: Date.now() }, null, 2),
  );
}

ipcMain.handle("opnames:list", async () => {
  const root = opnamesRoot();
  if (!existsSync(root)) return [];
  const namen = await readdir(root).catch(() => [] as string[]);
  const items = [];
  for (const naam of namen) {
    const dir = join(root, naam);
    try {
      const st = await stat(dir);
      if (!st.isDirectory()) continue;
      const projectPath = join(dir, "project.json");
      if (!existsSync(projectPath)) continue;
      const project = JSON.parse(await readFile(projectPath, "utf8"));
      const ext = videoExt(project.mimeType);
      const screenPath = join(dir, `screen.${ext}`);
      const speelbaar = existsSync(screenPath);
      const grootteBytes = speelbaar ? (await stat(screenPath)).size : 0;

      let thumbnail: string | null = null;
      const thumbPath = join(dir, "thumbnail.jpg");
      if (existsSync(thumbPath)) {
        thumbnail = `data:image/jpeg;base64,${(await readFile(thumbPath)).toString("base64")}`;
      }

      let gepubliceerd = false;
      let opnameId: string | undefined;
      const upPath = join(dir, "uploaded.json");
      if (existsSync(upPath)) {
        gepubliceerd = true;
        try {
          opnameId = JSON.parse(await readFile(upPath, "utf8")).id;
        } catch {
          /* corrupte marker — toon alsnog als gepubliceerd */
        }
      }

      const ts = Number(naam);
      items.push({
        id: naam,
        titel: project.titel || "Opname",
        durationSec: Number(project.durationSec) || 0,
        heeftWebcam: !!project.heeftWebcam,
        grootteBytes,
        gemaaktOp: Number.isFinite(ts) ? ts : st.mtimeMs,
        speelbaar,
        thumbnail,
        gepubliceerd,
        opnameId,
      });
    } catch {
      /* sla een corrupte/onvolledige map over */
    }
  }
  items.sort((a, b) => b.gemaaktOp - a.gemaaktOp);
  return items;
});

ipcMain.handle("opnames:open", async (_e, id: string) => {
  try {
    await shell.openPath(veiligOpnameDir(id));
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, fout: e instanceof Error ? e.message : "Map openen mislukt" };
  }
});

ipcMain.handle("opnames:play", async (_e, id: string) => {
  try {
    const dir = veiligOpnameDir(id);
    const mp4 = join(dir, "screen.mp4");
    const pad = existsSync(mp4) ? mp4 : join(dir, "screen.webm");
    if (!existsSync(pad)) return { ok: false as const, fout: "Geen videobestand gevonden" };
    const fout = await shell.openPath(pad); // lege string = ok
    return fout ? { ok: false as const, fout } : { ok: true as const };
  } catch (e) {
    return { ok: false as const, fout: e instanceof Error ? e.message : "Afspelen mislukt" };
  }
});

/** Bouwt de upload-FormData uit de bestanden in een opgeslagen project-map. */
async function bouwOpnameForm(dir: string): Promise<FormData> {
  const project = JSON.parse(await readFile(join(dir, "project.json"), "utf8"));
  const ext = videoExt(project.mimeType);
  const mimeType = baseMime(project.mimeType) || `video/${ext}`;
  const screenPath = join(dir, `screen.${ext}`);
  if (!existsSync(screenPath)) throw new Error("Videobestand ontbreekt");

  const form = new FormData();
  form.set("video", new Blob([await readFile(screenPath)], { type: mimeType }), `opname.${ext}`);
  const webcamPath = join(dir, `webcam.${ext}`);
  if (existsSync(webcamPath)) {
    form.set("webcam", new Blob([await readFile(webcamPath)], { type: mimeType }), `webcam.${ext}`);
  }
  const thumbPath = join(dir, "thumbnail.jpg");
  if (existsSync(thumbPath)) {
    form.set("thumbnail", new Blob([await readFile(thumbPath)], { type: "image/jpeg" }), "thumbnail.jpg");
  }

  let transcript = "";
  let segments: unknown[] = [];
  let taal = project.taal || "nl";
  const transcriptPath = join(dir, "transcript.json");
  if (existsSync(transcriptPath)) {
    const t = JSON.parse(await readFile(transcriptPath, "utf8"));
    transcript = t.transcript || "";
    segments = Array.isArray(t.segments) ? t.segments : [];
    taal = t.taal || taal;
  }
  form.set("titel", project.titel || "Opname");
  form.set("duur_sec", String(Math.round(Number(project.durationSec) || 0)));
  form.set("heeft_webcam", String(!!project.heeftWebcam));
  form.set("transcript", transcript);
  form.set("segments", JSON.stringify(segments));
  form.set("taal", taal);
  const editPath = join(dir, "edit.json");
  if (existsSync(editPath)) form.set("edit_project", await readFile(editPath, "utf8"));
  return form;
}

ipcMain.handle("opnames:reupload", async (_e, id: string) => {
  const s = loadSession();
  if (!s) return { ok: false as const, fout: "Niet ingelogd" };
  try {
    const dir = veiligOpnameDir(id);
    const r = await postOpnameForm(s, await bouwOpnameForm(dir));
    if (r.ok) {
      await markeerGepubliceerd(dir, r.id, s.baseUrl);
      return { ok: true as const, id: r.id };
    }
    return r.needsLogin
      ? { ok: false as const, fout: r.fout, needsLogin: true }
      : { ok: false as const, fout: r.fout };
  } catch (e) {
    return { ok: false as const, fout: e instanceof Error ? e.message : "Opnieuw publiceren mislukt" };
  }
});

// Laadt een opgeslagen project terug in de editor: de scherm-/webcam-bytes
// (voor de preview) plus het bewaarde transcript en edit.json (zodat de
// zooms/knips weer verschijnen).
ipcMain.handle("opnames:loadVoorEditor", async (_e, id: string) => {
  try {
    const dir = veiligOpnameDir(id);
    const project = JSON.parse(await readFile(join(dir, "project.json"), "utf8"));
    const ext = videoExt(project.mimeType);
    const screenPath = join(dir, `screen.${ext}`);
    if (!existsSync(screenPath)) return { ok: false as const, fout: "Videobestand ontbreekt" };
    const screenBuf = await readFile(screenPath);
    const screen = screenBuf.buffer.slice(screenBuf.byteOffset, screenBuf.byteOffset + screenBuf.byteLength);
    const webcamPath = join(dir, `webcam.${ext}`);
    let webcam: ArrayBuffer | null = null;
    if (existsSync(webcamPath)) {
      const wb = await readFile(webcamPath);
      webcam = wb.buffer.slice(wb.byteOffset, wb.byteOffset + wb.byteLength);
    }

    let segments: unknown[] = [];
    const transcriptPath = join(dir, "transcript.json");
    if (existsSync(transcriptPath)) {
      const t = JSON.parse(await readFile(transcriptPath, "utf8"));
      segments = Array.isArray(t.segments) ? t.segments : [];
    }
    let editProject: unknown = null;
    const editPath = join(dir, "edit.json");
    if (existsSync(editPath)) {
      try {
        editProject = JSON.parse(await readFile(editPath, "utf8"));
      } catch {
        /* corrupt edit.json — start met lege bewerking */
      }
    }
    return {
      ok: true as const,
      screen,
      webcam,
      mimeType: project.mimeType || `video/${ext}`,
      durationSec: Number(project.durationSec) || 0,
      heeftWebcam: !!project.heeftWebcam,
      titel: project.titel || "Opname",
      segments,
      editProject,
    };
  } catch (e) {
    return { ok: false as const, fout: e instanceof Error ? e.message : "Laden mislukt" };
  }
});

// Slaat een bijgewerkte bewerking op in de bestaande map (geen dubbele kopie)
// en publiceert opnieuw.
ipcMain.handle(
  "opnames:updateEnPubliceer",
  async (
    _e,
    { id, editProject, thumbnailBuf }: { id: string; editProject: unknown; thumbnailBuf: ArrayBuffer | null },
  ) => {
    const s = loadSession();
    if (!s) return { ok: false as const, fout: "Niet ingelogd" };
    try {
      const dir = veiligOpnameDir(id);
      await writeFile(join(dir, "edit.json"), JSON.stringify(editProject));
      if (thumbnailBuf) await writeFile(join(dir, "thumbnail.jpg"), Buffer.from(thumbnailBuf));
      const r = await postOpnameForm(s, await bouwOpnameForm(dir));
      if (r.ok) {
        await markeerGepubliceerd(dir, r.id, s.baseUrl);
        return { ok: true as const, id: r.id };
      }
      return r.needsLogin
        ? { ok: false as const, fout: r.fout, needsLogin: true }
        : { ok: false as const, fout: r.fout };
    } catch (e) {
      return { ok: false as const, fout: e instanceof Error ? e.message : "Publiceren mislukt" };
    }
  },
);

ipcMain.handle("opnames:delete", async (_e, id: string) => {
  try {
    await rm(veiligOpnameDir(id), { recursive: true, force: true });
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, fout: e instanceof Error ? e.message : "Verwijderen mislukt" };
  }
});

// Transcript later koppelen aan een al gepubliceerde opname (achtergrond).
ipcMain.handle(
  "opname:updateTranscript",
  async (
    _e,
    payload: { id: string; transcript: string; segments: TranscriptSegment[]; taal: string },
  ) => {
    const s = loadSession();
    if (!s) return { ok: false as const, fout: "Niet ingelogd" };
    try {
      const res = await fetch(`${s.baseUrl}/api/opnames/${payload.id}/transcript`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
        body: JSON.stringify({
          transcript: payload.transcript,
          segments: payload.segments,
          taal: payload.taal,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { fout?: string };
        return { ok: false as const, fout: body.fout ?? "Bijwerken mislukt" };
      }
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, fout: e instanceof Error ? e.message : "Bijwerken mislukt" };
    }
  },
);

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopPointer(); // anders blijft de 30Hz-interval draaien (audit #6)
  stopHuidigeWorker();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopPointer();
  stopHuidigeWorker();
});
