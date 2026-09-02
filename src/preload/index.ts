import { contextBridge, ipcRenderer } from "electron";

// Smalle, getypte brug tussen renderer en main. De renderer raakt nooit het
// Bearer-token of het netwerk aan — login/upload gebeuren in main (geen CORS,
// token blijft uit de renderer).
const api = {
  getSession: () => ipcRenderer.invoke("auth:session"),
  login: (baseUrl: string, email: string, wachtwoord: string, totp?: string) =>
    ipcRenderer.invoke("auth:login", { baseUrl, email, wachtwoord, totp }),
  logout: () => ipcRenderer.invoke("auth:logout"),

  listSources: () => ipcRenderer.invoke("capture:sources"),
  selectSource: (id: string) => ipcRenderer.invoke("capture:select", id),
  ensureCamera: () => ipcRenderer.invoke("media:ensureCamera"),

  startPointer: () => ipcRenderer.invoke("pointer:start"),
  stopPointer: () => ipcRenderer.invoke("pointer:stop"),

  upload: (payload: {
    screenBuf: ArrayBuffer;
    webcamBuf: ArrayBuffer | null;
    thumbnailBuf: ArrayBuffer | null;
    pointer: Array<{ t: number; x: number; y: number }>;
    titel: string;
    durationSec: number;
    mimeType: string;
    heeftWebcam: boolean;
    transcript: string;
    segments: Array<{ start: number; end: number; text: string }>;
    taal: string;
    editProject: unknown | null;
  }) => ipcRenderer.invoke("opname:upload", payload),

  updateTranscript: (payload: {
    id: string;
    transcript: string;
    segments: Array<{ start: number; end: number; text: string }>;
    taal: string;
  }) => ipcRenderer.invoke("opname:updateTranscript", payload),

  // Lokale opnamen-bibliotheek (userData/opnames). Acties verwijzen naar de
  // mapnaam (id); main valideert die en houdt het token buiten de renderer.
  listOpnamen: () => ipcRenderer.invoke("opnames:list"),
  openOpname: (id: string) => ipcRenderer.invoke("opnames:open", id),
  playOpname: (id: string) => ipcRenderer.invoke("opnames:play", id),
  reuploadOpname: (id: string) => ipcRenderer.invoke("opnames:reupload", id),
  deleteOpname: (id: string) => ipcRenderer.invoke("opnames:delete", id),
  loadOpnameVoorEditor: (id: string) => ipcRenderer.invoke("opnames:loadVoorEditor", id),
  updateEnPubliceer: (id: string, editProject: unknown, thumbnailBuf: ArrayBuffer | null) =>
    ipcRenderer.invoke("opnames:updateEnPubliceer", { id, editProject, thumbnailBuf }),

  // Lokale transcriptie draait in een geïsoleerd proces. Renderer stuurt PCM.
  transcribe: (pcm: ArrayBuffer) => ipcRenderer.invoke("transcribe:run", { pcm }),
  cancelTranscribe: () => ipcRenderer.invoke("transcribe:cancel"),
  onTranscribeProgress: (cb: (p: { fase: string; pct: number }) => void) => {
    const listener = (_e: unknown, p: { fase: string; pct: number }) => cb(p);
    ipcRenderer.on("transcribe:progress", listener);
    return () => ipcRenderer.removeListener("transcribe:progress", listener);
  },
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
