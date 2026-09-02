/// <reference types="vite/client" />

import type { EditProject } from "./lib/edl";

export interface DesktopUser {
  id: string;
  naam: string;
  initialen: string;
  rol: string;
}

export interface PointerSample {
  t: number;
  x: number;
  y: number;
}

/** Echte klik (genormaliseerd 0–1) tijdens opname — voedt auto-zoom. */
export interface ClickSample {
  t: number;
  cx: number;
  cy: number;
}

export interface SourceInfo {
  id: string;
  naam: string;
  type: "screen" | "window";
  thumbnail: string | null;
  appIcon: string | null;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

/** Eén lokaal opgeslagen opname-project (userData/opnames/<id>). */
export interface OpnameItem {
  id: string;
  titel: string;
  durationSec: number;
  heeftWebcam: boolean;
  grootteBytes: number;
  gemaaktOp: number;
  speelbaar: boolean;
  thumbnail: string | null;
  gepubliceerd: boolean;
  opnameId?: string;
}

export interface RecorderApi {
  getSession(): Promise<
    { loggedIn: true; user: DesktopUser; baseUrl: string } | { loggedIn: false; baseUrl: string }
  >;
  login(
    baseUrl: string,
    email: string,
    wachtwoord: string,
    totp?: string,
  ): Promise<{ ok: true; user: DesktopUser } | { ok: false; fout: string; code?: string }>;
  logout(): Promise<{ ok: true }>;
  listSources(): Promise<SourceInfo[]>;
  selectSource(id: string): Promise<{ ok: true }>;
  ensureCamera(): Promise<{ ok: boolean; status: string }>;
  startPointer(): Promise<{ ok: true }>;
  stopPointer(): Promise<{ pointer: PointerSample[]; clicks: ClickSample[] }>;
  upload(payload: {
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
    editProject: EditProject | null;
  }): Promise<
    { ok: true; id: string; projectDir: string } | { ok: false; fout: string; needsLogin?: boolean }
  >;
  updateTranscript(payload: {
    id: string;
    transcript: string;
    segments: TranscriptSegment[];
    taal: string;
  }): Promise<{ ok: true } | { ok: false; fout: string }>;
  transcribe(
    pcm: ArrayBuffer,
  ): Promise<
    | { ok: true; transcript: string; segments: TranscriptSegment[]; taal: string }
    | { ok: false; fout: string }
  >;
  onTranscribeProgress(cb: (p: { fase: string; pct: number }) => void): () => void;
  cancelTranscribe(): Promise<{ ok: true }>;

  listOpnamen(): Promise<OpnameItem[]>;
  openOpname(id: string): Promise<{ ok: true } | { ok: false; fout: string }>;
  playOpname(id: string): Promise<{ ok: true } | { ok: false; fout: string }>;
  reuploadOpname(
    id: string,
  ): Promise<{ ok: true; id: string } | { ok: false; fout: string; needsLogin?: boolean }>;
  deleteOpname(id: string): Promise<{ ok: true } | { ok: false; fout: string }>;
  loadOpnameVoorEditor(id: string): Promise<
    | {
        ok: true;
        screen: ArrayBuffer;
        webcam: ArrayBuffer | null;
        mimeType: string;
        durationSec: number;
        heeftWebcam: boolean;
        titel: string;
        segments: TranscriptSegment[];
        editProject: EditProject | null;
      }
    | { ok: false; fout: string }
  >;
  updateEnPubliceer(
    id: string,
    editProject: EditProject,
    thumbnailBuf: ArrayBuffer | null,
  ): Promise<{ ok: true; id: string } | { ok: false; fout: string; needsLogin?: boolean }>;
}

declare global {
  interface Window {
    api: RecorderApi;
  }
}
