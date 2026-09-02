// EDL (edit decision list) — gespiegeld met de site (afgevinkt-app/lib/edl.ts +
// lib/opnames/types.ts). Non-destructief: `keep` = geordende bewaarde BRON-ranges.
// Pure logica + editor-helpers; geen dependencies.

export interface KeepRange {
  start: number;
  end: number;
}
export interface ZoomKeyframe {
  tStart: number;
  tEnd: number;
  cx: number;
  cy: number;
  scale: number;
}
export interface WebcamLayout {
  visible: boolean;
  x: number;
  y: number;
  size: number;
  shape: "circle" | "rounded";
}
export interface EditBackground {
  type: "none" | "color" | "gradient";
  value: string;
  padding: number;
}
export interface CaptionStyle {
  enabled: boolean;
  font: string;
  size: number;
  color: string;
  bg: string;
  positie: "onder" | "boven";
}
export type OverlayType = "text" | "box" | "arrow";
export interface Overlay {
  id: string;
  type: OverlayType;
  tStart: number;
  tEnd: number;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  color: string;
  dik?: number;
}
export interface SensitiveRegion {
  id: string;
  tStart: number;
  tEnd: number;
  x: number;
  y: number;
  w: number;
  h: number;
  intensiteit: number;
}
export interface EditThumbnail {
  kind: "frame";
  frameSec: number;
}
export interface EditProject {
  version: number;
  keep: KeepRange[];
  zoom: ZoomKeyframe[];
  webcam: WebcamLayout | null;
  background: EditBackground;
  captions: CaptionStyle;
  overlays: Overlay[];
  sensitiveRegions: SensitiveRegion[];
  thumbnail: EditThumbnail | null;
}

export function legeEditProject(): EditProject {
  return {
    version: 1,
    keep: [],
    zoom: [],
    webcam: null,
    background: { type: "none", value: "", padding: 0 },
    captions: { enabled: false, font: "Inter", size: 18, color: "#ffffff", bg: "rgba(0,0,0,0.6)", positie: "onder" },
    overlays: [],
    sensitiveRegions: [],
    thumbnail: null,
  };
}

// ── Playback ─────────────────────────────────────────────────────────────
export function effectieveRanges(keep: KeepRange[] | undefined, duur: number): KeepRange[] {
  const geldig = (keep ?? [])
    .filter((r) => r.end > r.start)
    .map((r) => ({ start: Math.max(0, r.start), end: Math.min(duur || r.end, r.end) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
  return geldig.length ? geldig : [{ start: 0, end: duur || 0 }];
}
export function bewerkteDuur(ranges: KeepRange[]): number {
  return ranges.reduce((s, r) => s + (r.end - r.start), 0);
}
export function bronStap(ranges: KeepRange[], src: number): { jumpTo?: number; end?: boolean } {
  const EPS = 0.02;
  for (const r of ranges) {
    if (src < r.start - EPS) return { jumpTo: r.start };
    if (src <= r.end - EPS) return {};
  }
  return { end: true };
}

/** De actieve zoom-keyframe op bron-tijd `t`, of null. */
export function actieveZoom(zoom: ZoomKeyframe[] | undefined, t: number): ZoomKeyframe | null {
  for (const z of zoom ?? []) if (t >= z.tStart && t <= z.tEnd) return z;
  return null;
}

// ── Editor-helpers (keep opbouwen uit trim + cuts) ───────────────────────
/** Trekt één range af van een lijst ranges (voor knippen/transcript-delete). */
export function trekAf(ranges: KeepRange[], weg: KeepRange): KeepRange[] {
  const out: KeepRange[] = [];
  for (const r of ranges) {
    if (weg.end <= r.start || weg.start >= r.end) {
      out.push(r);
      continue;
    }
    if (weg.start > r.start) out.push({ start: r.start, end: Math.max(r.start, weg.start) });
    if (weg.end < r.end) out.push({ start: Math.min(r.end, weg.end), end: r.end });
  }
  return out.filter((r) => r.end - r.start > 0.05);
}

/** Bouwt de definitieve keep-ranges uit trim [inT,outT] minus de cut-regio's. */
export function bouwKeep(inT: number, outT: number, cuts: KeepRange[]): KeepRange[] {
  let basis: KeepRange[] = [{ start: inT, end: outT }];
  for (const c of cuts) basis = basis.flatMap((r) => trekAf([r], c));
  return basis.filter((r) => r.end - r.start > 0.05).sort((a, b) => a.start - b.start);
}

/** Voegt een cut toe en merget overlappende/aansluitende regio's. */
export function voegCutToe(cuts: KeepRange[], nieuw: KeepRange): KeepRange[] {
  const alle = [...cuts, nieuw].sort((a, b) => a.start - b.start);
  const merged: KeepRange[] = [];
  for (const c of alle) {
    const laatste = merged[merged.length - 1];
    if (laatste && c.start <= laatste.end + 0.05) laatste.end = Math.max(laatste.end, c.end);
    else merged.push({ ...c });
  }
  return merged;
}
