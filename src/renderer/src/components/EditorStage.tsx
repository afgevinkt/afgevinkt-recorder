import { useEffect, useMemo, useRef, useState } from "react";
import type { ClickSample, TranscriptSegment } from "../env";
import {
  bouwKeep,
  bewerkteDuur,
  bronStap,
  actieveZoom,
  trekAf,
  voegCutToe,
  legeEditProject,
  effectieveRanges,
  type EditProject,
  type KeepRange,
  type ZoomKeyframe,
  type WebcamLayout,
  type EditBackground,
  type CaptionStyle,
  type Overlay,
  type OverlayType,
  type SensitiveRegion,
} from "../lib/edl";
import { mmss } from "../lib/format";

type Tab = "knippen" | "zoom" | "camera" | "achtergrond" | "captions" | "overlays" | "blur";
const TABS: { id: Tab; label: string }[] = [
  { id: "knippen", label: "Knippen" },
  { id: "zoom", label: "Zoom" },
  { id: "camera", label: "Camera" },
  { id: "achtergrond", label: "Achtergrond" },
  { id: "captions", label: "Captions" },
  { id: "overlays", label: "Overlays" },
  { id: "blur", label: "Blur" },
];

const DEFAULT_WEBCAM: WebcamLayout = { visible: true, x: 0.81, y: 0.69, size: 0.15, shape: "circle" };
const MIN_SCALE = 1.1;
const MAX_SCALE = 4;

const klem = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

// Een opgeslagen edit bewaart het EINDRESULTAAT (keep-ranges). De editor werkt
// met trim [inT,outT] + losse cuts. Hier rekenen we keep daar weer naar terug:
// inT/outT = eerste/laatste bewaarde grens, cuts = de gaten ertussen.
function keepNaarTrimCuts(
  keep: KeepRange[] | undefined,
  duur: number,
): { inT: number; outT: number; cuts: KeepRange[] } {
  if (!keep || keep.length === 0) return { inT: 0, outT: duur, cuts: [] };
  const ranges = effectieveRanges(keep, duur);
  const inT = ranges[0].start;
  const outT = ranges[ranges.length - 1].end;
  const cuts: KeepRange[] = [];
  for (let i = 0; i < ranges.length - 1; i++) {
    const gap = { start: ranges[i].end, end: ranges[i + 1].start };
    if (gap.end - gap.start > 0.05) cuts.push(gap);
  }
  return { inT, outT, cuts };
}

type Rect = { x: number; y: number; w: number; h: number };

// ── Zoom ⇆ focuskader ──────────────────────────────────────────────────
// Een zoom is niets anders dan "welk stuk van het beeld vult straks het kader".
// Dat stuk is een rechthoek; de cx/cy/scale rekenen we eruit (en terug).
function rectVanZoom(k: ZoomKeyframe): Rect {
  const w = 1 / k.scale; // breedte- én hoogte-fractie (uniforme zoom)
  return { x: k.cx * (1 - w), y: k.cy * (1 - w), w, h: w };
}
function zoomVanRect(r: Rect): { cx: number; cy: number; scale: number } {
  const scale = klem(1 / r.w, MIN_SCALE, MAX_SCALE);
  const w = 1 / scale;
  return {
    scale,
    cx: w < 1 ? klem(r.x / (1 - w), 0, 1) : 0.5,
    cy: w < 1 ? klem(r.y / (1 - w), 0, 1) : 0.5,
  };
}

/** Clustert klikken in de tijd en maakt er zoom-keyframes van (auto-zoom). */
function autoZoom(clicks: ClickSample[], duur: number): ZoomKeyframe[] {
  const sorted = [...clicks].sort((a, b) => a.t - b.t);
  const out: ZoomKeyframe[] = [];
  let i = 0;
  while (i < sorted.length && out.length < 24) {
    const groep = [sorted[i]];
    let j = i + 1;
    while (j < sorted.length && sorted[j].t - groep[groep.length - 1].t < 1500) groep.push(sorted[j++]);
    const tSec = groep[0].t / 1000;
    const cx = groep.reduce((s, c) => s + c.cx, 0) / groep.length;
    const cy = groep.reduce((s, c) => s + c.cy, 0) / groep.length;
    const tStart = Math.max(0, tSec - 0.3);
    const tEnd = Math.min(duur, tSec + 2.5);
    if (tEnd - tStart > 0.5) out.push({ tStart, tEnd, cx, cy, scale: 1.8 });
    i = j;
  }
  return out;
}

type Dir = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

/**
 * Versleepbaar + verschaalbaar kader in genormaliseerde coördinaten (0–1).
 * Hét bouwblok voor direct manipuleren in het videobeeld.
 */
function DragBox({
  rect,
  onChange,
  onActief,
  getBounds,
  geselecteerd,
  onSelecteer,
  aspect = "free",
  minW = 0.05,
  minH = 0.05,
  color = "var(--accent)",
  label,
  children,
  style,
}: {
  rect: Rect;
  onChange: (r: Rect) => void;
  onActief?: (bezig: boolean) => void;
  getBounds: () => DOMRect | undefined;
  geselecteerd: boolean;
  onSelecteer: () => void;
  aspect?: "free" | "lock";
  minW?: number;
  minH?: number;
  color?: string;
  label?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const corners: Dir[] = ["nw", "ne", "sw", "se"];
  const edges: Dir[] = ["n", "s", "e", "w"];
  const handles = aspect === "lock" ? corners : [...corners, ...edges];

  function startMove(e: React.PointerEvent) {
    e.stopPropagation();
    onSelecteer();
    const b = getBounds();
    if (!b) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const start = { ...rect };
    onActief?.(true);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / b.width;
      const dy = (ev.clientY - sy) / b.height;
      onChange({ ...start, x: klem(start.x + dx, 0, 1 - start.w), y: klem(start.y + dy, 0, 1 - start.h) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onActief?.(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function startResize(e: React.PointerEvent, dir: Dir) {
    e.stopPropagation();
    onSelecteer();
    const b = getBounds();
    if (!b) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const start = { ...rect };
    onActief?.(true);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / b.width;
      const dy = (ev.clientY - sy) / b.height;
      let { x, y, w, h } = start;
      if (dir.includes("e")) w = start.w + dx;
      if (dir.includes("s")) h = start.h + dy;
      if (dir.includes("w")) { w = start.w - dx; x = start.x + dx; }
      if (dir.includes("n")) { h = start.h - dy; y = start.y + dy; }

      if (aspect === "lock") {
        // Houd de fractie-breedte gelijk aan de fractie-hoogte (uniforme zoom).
        const dominW = Math.abs(w - start.w) >= Math.abs(h - start.h);
        const m = klem(dominW ? w : h, minW, 1);
        w = m;
        h = m;
        if (dir.includes("w")) x = start.x + start.w - m;
        if (dir.includes("n")) y = start.y + start.h - m;
      }
      w = klem(w, minW, 1);
      h = klem(h, minH, 1);
      x = klem(x, 0, 1 - w);
      y = klem(y, 0, 1 - h);
      onChange({ x, y, w, h });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onActief?.(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const cur: Record<Dir, string> = {
    n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
    nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
  };
  const pos: Record<Dir, React.CSSProperties> = {
    n: { top: -5, left: "50%", marginLeft: -5 },
    s: { bottom: -5, left: "50%", marginLeft: -5 },
    e: { right: -5, top: "50%", marginTop: -5 },
    w: { left: -5, top: "50%", marginTop: -5 },
    nw: { top: -5, left: -5 },
    ne: { top: -5, right: -5 },
    sw: { bottom: -5, left: -5 },
    se: { bottom: -5, right: -5 },
  };

  return (
    <div
      onPointerDown={startMove}
      style={{
        position: "absolute",
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.w * 100}%`,
        height: `${rect.h * 100}%`,
        cursor: "move",
        outline: geselecteerd ? `2px solid ${color}` : `1.5px dashed ${color}`,
        outlineOffset: -1,
        ...style,
      }}
    >
      {children}
      {label && geselecteerd && (
        <span style={{ position: "absolute", top: -22, left: 0, fontSize: 11, fontFamily: "var(--mono)", color, background: "rgba(10,14,19,0.8)", padding: "1px 6px", borderRadius: 4, whiteSpace: "nowrap", pointerEvents: "none" }}>
          {label}
        </span>
      )}
      {geselecteerd &&
        handles.map((d) => (
          <span
            key={d}
            onPointerDown={(e) => startResize(e, d)}
            style={{ position: "absolute", width: 10, height: 10, borderRadius: 3, background: color, border: "1.5px solid #fff", cursor: cur[d], ...pos[d] }}
          />
        ))}
    </div>
  );
}

// Kleine transport-iconen.
const IconPlay = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
);
const IconPause = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
);

export default function EditorStage({
  previewUrl,
  webcamUrl,
  durationSec,
  segments,
  clicks,
  hasWebcam,
  bezig,
  onTerug,
  onPubliceer,
  initieelProject,
}: {
  previewUrl: string | null;
  webcamUrl: string | null;
  durationSec: number;
  segments: TranscriptSegment[];
  clicks: ClickSample[];
  hasWebcam: boolean;
  bezig: boolean;
  onTerug: () => void;
  onPubliceer: (edl: EditProject) => void;
  initieelProject?: EditProject | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const camRef = useRef<HTMLVideoElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const duur = durationSec || 0;
  const getBounds = () => previewRef.current?.getBoundingClientRect();

  // Eénmalige herstart vanuit een opgeslagen bewerking (bibliotheek → editor).
  const init = initieelProject ?? null;
  const initTrim = keepNaarTrimCuts(init?.keep, duur);

  const [tab, setTab] = useState<Tab>("knippen");
  const [inT, setInT] = useState(initTrim.inT);
  const [outT, setOutT] = useState(init ? initTrim.outT : duur);
  const [cuts, setCuts] = useState<KeepRange[]>(initTrim.cuts);
  const [markIn, setMarkIn] = useState<number | null>(null);
  const [woordModus, setWoordModus] = useState(false);
  const [tijd, setTijd] = useState(0);
  const [speelt, setSpeelt] = useState(false);

  const [zoom, setZoom] = useState<ZoomKeyframe[]>(init ? init.zoom : []);
  const [zoomSel, setZoomSel] = useState<number>(-1);
  const [toonResultaat, setToonResultaat] = useState(false); // zoom-resultaat live laten zien
  const [geavanceerd, setGeavanceerd] = useState(false);
  const [bezigSlepen, setBezigSlepen] = useState(false);
  const [marquee, setMarquee] = useState<Rect | null>(null);

  const [webcam, setWebcam] = useState<WebcamLayout | null>(
    init ? init.webcam : hasWebcam ? DEFAULT_WEBCAM : null,
  );
  const [bg, setBg] = useState<EditBackground>(
    init ? init.background : { type: "none", value: "#0a0e13", padding: 0.04 },
  );
  const [captions, setCaptions] = useState<CaptionStyle>(init ? init.captions : legeEditProject().captions);
  const [overlays, setOverlays] = useState<Overlay[]>(init ? init.overlays : []);
  const [overlaySel, setOverlaySel] = useState(-1);
  const [plaatsType, setPlaatsType] = useState<OverlayType | null>(null);
  const [blurRegios, setBlurRegios] = useState<SensitiveRegion[]>(init ? init.sensitiveRegions : []);
  const [blurSel, setBlurSel] = useState(-1);
  const [thumbFrame, setThumbFrame] = useState<number | null>(
    init?.thumbnail ? init.thumbnail.frameSec : null,
  );
  const idTeller = useRef((init?.overlays.length ?? 0) + (init?.sensitiveRegions.length ?? 0));
  const nieuwId = () => `id${++idTeller.current}`;

  const keep = useMemo(() => bouwKeep(inT, outT, cuts), [inT, outT, cuts]);
  const keepRef = useRef(keep);
  useEffect(() => void (keepRef.current = keep), [keep]);

  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / (duur || 1)) * 100))}%`;
  const bewerkt = bewerkteDuur(keep);

  // Tijdens afspelen tonen we het EINDRESULTAAT (alle bewerkingen toegepast);
  // bij pauze de bewerk-affordances (kaders, handles).
  const bewerkLaag = !speelt;

  // Webcam-preview synchroon met het scherm.
  useEffect(() => {
    const v = videoRef.current;
    const w = camRef.current;
    if (!v || !w || !webcamUrl) return;
    w.muted = true;
    const onPlay = () => w.play().catch(() => {});
    const onPause = () => w.pause();
    const onSeek = () => (w.currentTime = v.currentTime);
    const drift = () => {
      if (Math.abs(w.currentTime - v.currentTime) > 0.3) w.currentTime = v.currentTime;
    };
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("seeking", onSeek);
    v.addEventListener("timeupdate", drift);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("seeking", onSeek);
      v.removeEventListener("timeupdate", drift);
    };
  }, [webcamUrl, tab, speelt]);

  function onTime() {
    const v = videoRef.current;
    if (!v) return;
    setTijd(v.currentTime);
    const stap = bronStap(keepRef.current, v.currentTime);
    if (stap.jumpTo != null && Math.abs(stap.jumpTo - v.currentTime) > 0.05) v.currentTime = stap.jumpTo;
    else if (stap.end && !v.paused) v.pause();
  }

  const seekNaar = (t: number) => {
    if (videoRef.current) videoRef.current.currentTime = Math.max(0, Math.min(duur, t));
  };

  // ── Transport ────────────────────────────────────────────────────────
  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime >= duur - 0.1) v.currentTime = inT; // vanaf het begin opnieuw
      v.play().catch(() => {});
    } else v.pause();
  }
  const spring = (d: number) => seekNaar((videoRef.current?.currentTime ?? tijd) + d);

  // Spatiebalk = afspelen/pauzeren (behalve in invoervelden).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [duur, inT]);

  // Scrubben: klik + sleep op de tijdlijn.
  function scrubPointer(e: React.PointerEvent<HTMLDivElement>) {
    const b = e.currentTarget.getBoundingClientRect();
    const at = (cx: number) => klem((cx - b.left) / b.width) * duur;
    seekNaar(at(e.clientX));
    const move = (ev: PointerEvent) => seekNaar(at(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // ── Knippen ─────────────────────────────────────────────────────────
  const isVerwijderd = (s: TranscriptSegment) => {
    const lengte = Math.max(0.01, s.end - s.start);
    const gedekt = cuts.reduce((a, c) => a + Math.max(0, Math.min(c.end, s.end) - Math.max(c.start, s.start)), 0);
    return gedekt / lengte > 0.5;
  };
  const toggleZin = (s: TranscriptSegment) =>
    setCuts((c) => (isVerwijderd(s) ? trekAf(c, { start: s.start, end: s.end }) : voegCutToe(c, { start: s.start, end: s.end })));
  function markeerKnip() {
    if (markIn == null) setMarkIn(tijd);
    else {
      const a = Math.min(markIn, tijd);
      const b = Math.max(markIn, tijd);
      if (b - a > 0.1) setCuts((c) => voegCutToe(c, { start: a, end: b }));
      setMarkIn(null);
    }
  }

  // Woord-niveau: splits een zin in woorden en interpoleer per-woord-timing
  // lineair over [start, end] op basis van tekstpositie (benaderend, géén
  // pipeline-/DB-wijziging — ideaal om stopwoorden/versprekingen weg te knippen).
  function woordSegmenten(s: TranscriptSegment): { woord: string; start: number; end: number }[] {
    const total = s.text.length || 1;
    const dur = Math.max(0.01, s.end - s.start);
    const out: { woord: string; start: number; end: number }[] = [];
    let idx = 0;
    for (const w of s.text.split(/\s+/).filter(Boolean)) {
      const pos = s.text.indexOf(w, idx);
      const startChar = pos >= 0 ? pos : idx;
      const endChar = startChar + w.length;
      idx = endChar;
      out.push({ woord: w, start: s.start + (startChar / total) * dur, end: s.start + (endChar / total) * dur });
    }
    return out;
  }
  function isBereikVerwijderd(a: number, b: number): boolean {
    const lengte = Math.max(0.01, b - a);
    const gedekt = cuts.reduce((acc, c) => acc + Math.max(0, Math.min(c.end, b) - Math.max(c.start, a)), 0);
    return gedekt / lengte > 0.5;
  }
  const toggleWoord = (w: { start: number; end: number }) =>
    setCuts((c) => (isBereikVerwijderd(w.start, w.end) ? trekAf(c, { start: w.start, end: w.end }) : voegCutToe(c, { start: w.start, end: w.end })));

  // ── Zoom ────────────────────────────────────────────────────────────
  const updateZoom = (i: number, patch: Partial<ZoomKeyframe>) =>
    setZoom((z) => z.map((k, idx) => (idx === i ? { ...k, ...patch } : k)));

  /** Zet het focuskader van de geselecteerde zoom (rekent cx/cy/scale uit). */
  const zetZoomRect = (i: number, r: Rect) => updateZoom(i, zoomVanRect(r));

  function zoomOpPunt(cx: number, cy: number) {
    const kf: ZoomKeyframe = { tStart: tijd, tEnd: Math.min(duur, Math.max(tijd + 2.5, tijd)), cx, cy, scale: 1.8 };
    setZoom((z) => [...z, kf]);
    setZoomSel(zoom.length);
    setTab("zoom");
  }
  function zoomToevoegen() {
    // Centreer standaard op de dichtstbijzijnde klik rond de playhead, anders midden.
    const dichtbij = clicks
      .map((c) => ({ c, d: Math.abs(c.t / 1000 - tijd) }))
      .filter((x) => x.d < 2.5)
      .sort((a, b) => a.d - b.d)[0];
    zoomOpPunt(dichtbij ? dichtbij.c.cx : 0.5, dichtbij ? dichtbij.c.cy : 0.5);
  }
  function zoomUitRegio(r: Rect) {
    const { cx, cy, scale } = zoomVanRect(r);
    const kf: ZoomKeyframe = { tStart: tijd, tEnd: Math.min(duur, Math.max(tijd + 2.5, tijd)), cx, cy, scale };
    setZoom((z) => [...z, kf]);
    setZoomSel(zoom.length);
    setTab("zoom");
  }
  function autoZoomToevoegen() {
    setZoom(autoZoom(clicks, duur));
    setZoomSel(-1);
  }
  function dupliceerZoom(i: number) {
    const k = zoom[i];
    const lengte = k.tEnd - k.tStart;
    const nieuw: ZoomKeyframe = { ...k, tStart: Math.min(duur - 0.2, k.tEnd + 0.2), tEnd: Math.min(duur, k.tEnd + 0.2 + lengte) };
    setZoom((z) => [...z, nieuw]);
    setZoomSel(zoom.length);
  }
  const verwijderZoom = (i: number) => {
    setZoom((z) => z.filter((_, idx) => idx !== i));
    setZoomSel(-1);
  };

  // Sleep een zoompunt op de tijdlijn (verschuif begin+eind samen).
  function sleepZoomMarker(e: React.PointerEvent, i: number) {
    e.stopPropagation();
    setZoomSel(i);
    setTab("zoom");
    const baan = e.currentTarget.parentElement as HTMLElement | null;
    const b = baan?.getBoundingClientRect();
    if (!b) return;
    const start = zoom[i];
    const lengte = start.tEnd - start.tStart;
    const sx = e.clientX;
    const move = (ev: PointerEvent) => {
      const d = ((ev.clientX - sx) / b.width) * duur;
      const ns = klem(start.tStart + d, 0, duur - lengte);
      updateZoom(i, { tStart: ns, tEnd: ns + lengte });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // ── Preview-interactie voor de zoom-tab (klikken / tekenen) ──────────
  function onPreviewDblClick(e: React.MouseEvent) {
    if (tab !== "zoom" || !bewerkLaag) return;
    const b = getBounds();
    if (!b) return;
    zoomOpPunt(klem((e.clientX - b.left) / b.width), klem((e.clientY - b.top) / b.height));
  }
  function onPreviewPointerDown(e: React.PointerEvent) {
    const b = getBounds();
    if (!b) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const x0 = klem((sx - b.left) / b.width);
    const y0 = klem((sy - b.top) / b.height);
    let getekend = false;
    setBezigSlepen(true);
    const move = (ev: PointerEvent) => {
      const x1 = klem((ev.clientX - b.left) / b.width);
      const y1 = klem((ev.clientY - b.top) / b.height);
      if (Math.abs(x1 - x0) > 0.02 || Math.abs(y1 - y0) > 0.02) {
        getekend = true;
        setMarquee({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) });
      }
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setBezigSlepen(false);
      setMarquee(null);
      const x1 = klem((ev.clientX - b.left) / b.width);
      const y1 = klem((ev.clientY - b.top) / b.height);
      if (getekend) {
        const r = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
        if (zoomSel >= 0) zetZoomRect(zoomSel, r);
        else zoomUitRegio(r);
      } else if (zoomSel >= 0) {
        // Klik = verplaats het centrum van de geselecteerde zoom hierheen.
        updateZoom(zoomSel, { cx: x0, cy: y0 });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // ── Overlays & blur ──────────────────────────────────────────────────
  // Drag-to-place: kies een type → klik in de video om het dáár te plaatsen.
  function startPlaatsen(type: OverlayType) {
    setTab("overlays");
    setPlaatsType((t) => (t === type ? null : type));
  }
  function plaatsOverlay(type: OverlayType, cx: number, cy: number) {
    const w = 0.3;
    const h = type === "text" ? 0.12 : 0.2;
    const o: Overlay = { id: nieuwId(), type, tStart: tijd, tEnd: Math.min(duur, tijd + 3), x: klem(cx - w / 2, 0, 1 - w), y: klem(cy - h / 2, 0, 1 - h), w, h, text: type === "text" ? "Tekst" : undefined, color: "#1cb5e8", dik: 3 };
    setOverlays((v) => [...v, o]);
    setOverlaySel(overlays.length);
    setPlaatsType(null);
  }
  const updateOverlay = (i: number, patch: Partial<Overlay>) =>
    setOverlays((v) => v.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));

  function blurToevoegen() {
    const s: SensitiveRegion = { id: nieuwId(), tStart: tijd, tEnd: Math.min(duur, tijd + 3), x: 0.4, y: 0.4, w: 0.25, h: 0.15, intensiteit: 10 };
    setBlurRegios((v) => [...v, s]);
    setBlurSel(blurRegios.length);
    setTab("blur");
  }
  const updateBlur = (i: number, patch: Partial<SensitiveRegion>) =>
    setBlurRegios((v) => v.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  // ── Publiceren ──────────────────────────────────────────────────────
  function publiceer() {
    onPubliceer({
      ...legeEditProject(),
      keep,
      zoom,
      webcam,
      background: bg,
      captions,
      overlays,
      sensitiveRegions: blurRegios,
      thumbnail: thumbFrame != null ? { kind: "frame", frameSec: thumbFrame } : null,
    });
  }

  // Actieve elementen op de huidige tijd (voor de preview).
  const actieveOverlays = overlays.map((o, i) => ({ o, i })).filter(({ o }) => tijd >= o.tStart && tijd <= o.tEnd);
  const actieveBlur = blurRegios.map((s, i) => ({ s, i })).filter(({ s }) => tijd >= s.tStart && tijd <= s.tEnd);
  const actieveCaption = captions.enabled && segments.find((s) => tijd >= s.start && tijd < (segments[segments.indexOf(s) + 1]?.start ?? s.end));

  // Zoom-transform op de preview. Bij pauze + zoom-tab tonen we het ONgezoomde
  // beeld met het focuskader; tijdens afspelen (of "Voorbeeld") de echte zoom.
  const zoomBewerken = tab === "zoom" && !toonResultaat && bewerkLaag;
  const z = actieveZoom(zoom, tijd);
  const transformActief = zoomBewerken ? null : z;
  const videoTransform = transformActief
    ? { transform: `scale(${transformActief.scale})`, transformOrigin: `${transformActief.cx * 100}% ${transformActief.cy * 100}%`, transition: bezigSlepen ? "none" : "transform 0.4s ease" }
    : { transform: "scale(1)", transition: "transform 0.4s ease" };
  const padPct = bg.type === "color" ? `${bg.padding * 100}%` : "0";

  const selZoomRect = zoomBewerken && zoomSel >= 0 && zoom[zoomSel] ? rectVanZoom(zoom[zoomSel]) : null;
  const toonWebcamDrag = tab === "camera" && bewerkLaag && webcam?.visible && !!webcamUrl;

  return (
    <div className="stage stage--editor">
      <div className="stage__head">
        <span className="eyebrow">Stap 04 — Bewerken</span>
        <h1>Editor</h1>
        <p className="sub">
          Niets wordt gewist. Bewerkte lengte:{" "}
          <b style={{ color: "var(--accent)" }}>{mmss(bewerkt)}</b> van {mmss(duur)}.
        </p>
      </div>

      <div className="editor">
        {/* ── Player ──────────────────────────────────────────────────── */}
        <div className="player-card">
          <div className="vf" style={{ background: bg.type === "color" ? bg.value : "#000", padding: padPct }}>
            <div
              ref={previewRef}
              onDoubleClick={onPreviewDblClick}
              style={{ position: "relative", overflow: "hidden", borderRadius: 8, aspectRatio: "16 / 9", background: "#000" }}
            >
              {previewUrl ? (
                <video
                  ref={videoRef}
                  src={previewUrl}
                  playsInline
                  onTimeUpdate={onTime}
                  onPlay={() => setSpeelt(true)}
                  onPause={() => setSpeelt(false)}
                  style={{ width: "100%", height: "100%", objectFit: "contain", ...videoTransform }}
                />
              ) : (
                <div style={{ display: "grid", placeItems: "center", height: "100%" }}>
                  <span className="muted">Geen preview</span>
                </div>
              )}

              {webcam?.visible && webcamUrl && !toonWebcamDrag && (
                <video
                  ref={camRef}
                  src={webcamUrl}
                  playsInline
                  muted
                  style={{
                    position: "absolute",
                    left: `${webcam.x * 100}%`,
                    top: `${webcam.y * 100}%`,
                    width: `${webcam.size * 100}%`,
                    aspectRatio: "1 / 1",
                    objectFit: "cover",
                    borderRadius: webcam.shape === "circle" ? "50%" : "14px",
                    border: "2px solid rgba(255,255,255,0.85)",
                    background: "#000",
                    zIndex: 3,
                  }}
                />
              )}

              {/* ── ZOOM: direct manipuleren (alleen bij pauze) ──────── */}
              {zoomBewerken && (
                <>
                  {/* Vang-laag: klikken om te centreren / slepen om een kader te tekenen */}
                  <div
                    onPointerDown={onPreviewPointerDown}
                    style={{ position: "absolute", inset: 0, zIndex: 4, cursor: "crosshair" }}
                  />
                  {selZoomRect && (
                    <DragBox
                      rect={selZoomRect}
                      onChange={(r) => zetZoomRect(zoomSel, r)}
                      onActief={setBezigSlepen}
                      getBounds={getBounds}
                      geselecteerd
                      onSelecteer={() => {}}
                      aspect="lock"
                      minW={1 / MAX_SCALE}
                      label={`Uitlichten · ${zoom[zoomSel].scale.toFixed(1)}×`}
                      style={{ zIndex: 5, boxShadow: "0 0 0 9999px rgba(8,11,15,0.55)" }}
                    />
                  )}
                  {marquee && (
                    <div style={{ position: "absolute", left: `${marquee.x * 100}%`, top: `${marquee.y * 100}%`, width: `${marquee.w * 100}%`, height: `${marquee.h * 100}%`, border: "2px solid var(--accent)", background: "rgba(28,181,232,0.12)", zIndex: 6, pointerEvents: "none" }} />
                  )}
                </>
              )}

              {/* ── BLUR-regio's ─────────────────────────────────────── */}
              {actieveBlur.map(({ s, i }) =>
                tab === "blur" && bewerkLaag ? (
                  <DragBox
                    key={s.id}
                    rect={s}
                    onChange={(r) => updateBlur(i, r)}
                    getBounds={getBounds}
                    geselecteerd={blurSel === i}
                    onSelecteer={() => setBlurSel(i)}
                    color="var(--accent)"
                    label="Blur"
                    style={{ zIndex: 6, backdropFilter: `blur(${s.intensiteit}px)`, background: "rgba(10,14,19,0.25)", borderRadius: 6 }}
                  />
                ) : (
                  <div key={s.id} style={{ position: "absolute", left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.w * 100}%`, height: `${s.h * 100}%`, backdropFilter: `blur(${s.intensiteit}px)`, background: "rgba(10,14,19,0.25)", borderRadius: 6, zIndex: 6 }} />
                ),
              )}

              {/* ── Tekst/box/pijl-overlays ──────────────────────────── */}
              {actieveOverlays.map(({ o, i }) => {
                const inhoud =
                  o.type === "text" ? (
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", pointerEvents: "none" }}>
                      <span style={{ color: o.color, background: "rgba(0,0,0,0.55)", padding: "2px 8px", borderRadius: 6, fontWeight: 600 }}>{o.text}</span>
                    </div>
                  ) : o.type === "arrow" ? (
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                      <defs>
                        <marker id={`e-${o.id}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                          <path d="M0,0 L6,3 L0,6 Z" fill={o.color} />
                        </marker>
                      </defs>
                      <line x1="6" y1="6" x2="94" y2="94" stroke={o.color} strokeWidth={o.dik ?? 3} markerEnd={`url(#e-${o.id})`} vectorEffect="non-scaling-stroke" />
                    </svg>
                  ) : (
                    <div style={{ position: "absolute", inset: 0, border: `${o.dik ?? 3}px solid ${o.color}`, borderRadius: 6, pointerEvents: "none" }} />
                  );
                return tab === "overlays" && bewerkLaag ? (
                  <DragBox
                    key={o.id}
                    rect={o}
                    onChange={(r) => updateOverlay(i, r)}
                    getBounds={getBounds}
                    geselecteerd={overlaySel === i}
                    onSelecteer={() => setOverlaySel(i)}
                    color={o.color}
                    label={o.type}
                    style={{ zIndex: 7 }}
                  >
                    {inhoud}
                  </DragBox>
                ) : (
                  <div key={o.id} style={{ position: "absolute", left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.w * 100}%`, height: `${o.h * 100}%`, zIndex: 7 }}>
                    {inhoud}
                  </div>
                );
              })}

              {/* ── WEBCAM direct verplaatsen/schalen ────────────────── */}
              {toonWebcamDrag && webcam && (
                <DragBox
                  rect={{ x: webcam.x, y: webcam.y, w: webcam.size, h: klem(webcam.size * (16 / 9), 0, 1) }}
                  onChange={(r) => setWebcam({ ...webcam, x: r.x, y: r.y, size: klem(r.w, 0.1, 0.5) })}
                  getBounds={getBounds}
                  geselecteerd
                  onSelecteer={() => {}}
                  aspect="lock"
                  minW={0.1}
                  color="var(--accent)"
                  label="Webcam"
                  style={{ zIndex: 8, borderRadius: webcam.shape === "circle" ? "50%" : "14px", overflow: "hidden" }}
                >
                  <video ref={camRef} src={webcamUrl ?? undefined} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", background: "#000", pointerEvents: "none" }} />
                </DragBox>
              )}

              {/* Drag-to-place: klik in de video om het gekozen element te plaatsen */}
              {plaatsType && bewerkLaag && (
                <div
                  title="Klik om hier te plaatsen"
                  onClick={(e) => {
                    const b = getBounds();
                    if (!b) return;
                    plaatsOverlay(plaatsType, klem((e.clientX - b.left) / b.width), klem((e.clientY - b.top) / b.height));
                  }}
                  style={{ position: "absolute", inset: 0, zIndex: 10, cursor: "crosshair", background: "rgba(28,181,232,0.06)", outline: "2px dashed rgba(28,181,232,0.5)", outlineOffset: -4 }}
                />
              )}

              {/* Ondertiteling-preview (gestileerd) */}
              {actieveCaption && (
                <div style={{ position: "absolute", left: 0, right: 0, top: captions.positie === "boven" ? 10 : undefined, bottom: captions.positie === "boven" ? undefined : 10, display: "flex", justifyContent: "center", zIndex: 9, pointerEvents: "none", padding: "0 16px" }}>
                  <span style={{ maxWidth: "92%", borderRadius: 6, padding: "4px 10px", textAlign: "center", background: captions.bg, color: captions.color, fontFamily: captions.font, fontSize: captions.size }}>
                    {actieveCaption.text}
                  </span>
                </div>
              )}
            </div>
            <span className="vf__corner tl" />
            <span className="vf__corner tr" />
            <span className="vf__corner bl" />
            <span className="vf__corner br" />
          </div>

          {/* Transport */}
          <div className="transport">
            <button className="play-btn" onClick={togglePlay} disabled={!previewUrl} aria-label={speelt ? "Pauzeren" : "Afspelen"} title={speelt ? "Pauzeren (spatie)" : "Afspelen (spatie)"}>
              {speelt ? <IconPause /> : <IconPlay />}
            </button>
            <button className="icon-btn" onClick={() => spring(-5)} disabled={!previewUrl} title="5 sec terug" aria-label="5 seconden terug">«</button>
            <button className="icon-btn" onClick={() => spring(5)} disabled={!previewUrl} title="5 sec vooruit" aria-label="5 seconden vooruit">»</button>
            <span className="transport__time"><b>{mmss(tijd)}</b> / {mmss(duur)}</span>
            <span className="transport__spacer" />
            {tab === "zoom" && (
              <button className="btn btn-ghost" aria-selected={toonResultaat} onClick={() => setToonResultaat((v) => !v)} style={{ padding: "8px 14px", fontSize: 13 }} title="Wissel tussen kader bewerken en eindresultaat">
                {toonResultaat ? "✏️ Kader bewerken" : "👁 Voorbeeld zoom"}
              </button>
            )}
          </div>

          {/* Scrub-tijdlijn */}
          <div
            className="scrub"
            onPointerDown={scrubPointer}
            title="Klik of sleep om door de video te scrubben"
          >
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: pct(inT), background: "rgba(10,14,19,0.6)" }} />
            <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: pct(duur - outT), background: "rgba(10,14,19,0.6)" }} />
            {cuts.map((c, i) => (
              <div key={i} style={{ position: "absolute", top: 0, bottom: 0, left: pct(c.start), width: pct(c.end - c.start), background: "rgba(248,85,109,0.32)", borderLeft: "1px solid var(--rec)", borderRight: "1px solid var(--rec)" }} />
            ))}
            {/* Versleepbare zoompunten */}
            {zoom.map((k, i) => (
              <div
                key={`z${i}`}
                onPointerDown={(e) => sleepZoomMarker(e, i)}
                title="Sleep om te verplaatsen"
                style={{ position: "absolute", bottom: 6, height: 16, left: pct(k.tStart), width: pct(k.tEnd - k.tStart), minWidth: 8, background: zoomSel === i ? "var(--accent)" : "var(--accent2)", borderRadius: 4, cursor: "grab", border: zoomSel === i ? "1.5px solid #fff" : "none", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3 }}
              >
                <span style={{ fontSize: 9, color: "#fff", fontFamily: "var(--mono)", pointerEvents: "none" }}>{k.scale.toFixed(1)}×</span>
              </div>
            ))}
            {markIn != null && <div style={{ position: "absolute", top: 0, bottom: 0, left: pct(markIn), width: 2, background: "var(--ok)" }} />}
            <div style={{ position: "absolute", top: 0, bottom: 0, left: pct(tijd), width: 2, background: "#fff", boxShadow: "0 0 6px rgba(255,255,255,0.6)", pointerEvents: "none" }} />
          </div>

          {/* Knip-acties */}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => setInT(tijd)}>Begin hier</button>
            <button className="btn btn-ghost" onClick={() => setOutT(tijd)}>Eind hier</button>
            <button className="btn btn-ghost" onClick={markeerKnip}>{markIn == null ? "Knip-begin" : "Knip tot hier"}</button>
            <button className="btn btn-ghost" onClick={() => { setInT(0); setOutT(duur); setCuts([]); setMarkIn(null); }}>Reset knip</button>
            <button className="btn btn-ghost" onClick={() => setThumbFrame(tijd)} title="Gebruik dit frame als omslag/thumbnail">
              📷 Omslag{thumbFrame != null ? ` · ${mmss(thumbFrame)}` : ""}
            </button>
          </div>
        </div>

        {/* ── Bedieningspaneel ───────────────────────────────────────── */}
        <div className="editor__panel">
          <div className="editor__tabs">
            {TABS.map((t) => (
              <button key={t.id} className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === "knippen" && (
            <>
              <p className="callout" style={{ marginTop: 0, marginBottom: 12 }}>
                Klik een {woordModus ? "woord" : "zin"} om die te knippen (of terug te zetten). Of gebruik <b>Knip-begin</b>/<b>Knip tot hier</b> onder de player.
              </p>
              {segments.length > 0 && (
                <label className="toggle" style={{ marginBottom: 10 }}>
                  <input type="checkbox" checked={woordModus} onChange={(e) => setWoordModus(e.target.checked)} /> Woord-niveau
                </label>
              )}
              {segments.length === 0 ? (
                <p className="muted" style={{ fontSize: 13 }}>Geen transcript.</p>
              ) : woordModus ? (
                segments.map((s, i) => (
                  <div key={i} style={{ padding: "8px 4px", borderBottom: "1px solid var(--line)" }}>
                    <button className="muted" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => seekNaar(s.start + 0.02)}>
                      <time style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--accent)" }}>{mmss(s.start)}</time>
                    </button>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
                      {woordSegmenten(s).map((w, j) => {
                        const weg = isBereikVerwijderd(w.start, w.end);
                        return (
                          <button
                            key={j}
                            onClick={() => toggleWoord(w)}
                            title={weg ? "Terugzetten" : "Knippen"}
                            style={{
                              padding: "2px 7px",
                              borderRadius: 6,
                              fontSize: 13,
                              border: "1px solid var(--line)",
                              background: weg ? "transparent" : "var(--panel2)",
                              color: weg ? "var(--muted2)" : "var(--text)",
                              textDecoration: weg ? "line-through" : "none",
                              cursor: "pointer",
                            }}
                          >
                            {w.woord}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              ) : (
                segments.map((s, i) => {
                  const weg = isVerwijderd(s);
                  return (
                    <div key={i} className="seg" style={{ gridTemplateColumns: "52px 1fr auto" }}>
                      <button className="muted" style={{ background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer" }} onClick={() => seekNaar(s.start)}>
                        <time>{mmss(s.start)}</time>
                      </button>
                      <p style={{ margin: 0, fontSize: 13.5, opacity: weg ? 0.45 : 1, textDecoration: weg ? "line-through" : "none" }}>{s.text}</p>
                      <button onClick={() => toggleZin(s)} title={weg ? "Terugzetten" : "Knippen"} style={{ background: "none", border: 0, cursor: "pointer", color: weg ? "var(--ok)" : "var(--rec)", fontSize: 16 }}>
                        {weg ? "↩" : "✕"}
                      </button>
                    </div>
                  );
                })
              )}
            </>
          )}

          {tab === "zoom" && (
            <>
              <p className="callout" style={{ marginTop: 0, marginBottom: 12 }}>
                <b>Klik op wat je wilt uitlichten.</b> Dubbelklik in de video voor een zoompunt, of teken een kader rond het gebied. Versleep het kader en trek aan de hoeken om bij te stellen. Druk op <b>▶</b> om het resultaat te zien.
              </p>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button className="btn btn-primary" onClick={zoomToevoegen}>+ Zoom toevoegen</button>
                <button className="btn btn-ghost" onClick={autoZoomToevoegen} disabled={clicks.length === 0} title={clicks.length === 0 ? "Geen klikken vastgelegd" : "Maak automatisch zooms uit je klikken"}>
                  ✨ Auto-zoom ({clicks.length})
                </button>
              </div>

              {zoom.length === 0 && <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>Nog geen zooms. Klik “+ Zoom toevoegen” of dubbelklik in de video.</p>}

              {zoom.map((k, i) => (
                <div key={i} className="kf" data-sel={zoomSel === i}>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <button className="muted" style={{ background: "none", border: 0, cursor: "pointer", textAlign: "left" }} onClick={() => { setZoomSel(i); setToonResultaat(false); seekNaar(k.tStart + 0.05); }}>
                      <time style={{ fontFamily: "var(--mono)", color: "var(--accent)" }}>{mmss(k.tStart)}–{mmss(k.tEnd)}</time> · {k.scale.toFixed(1)}×
                    </button>
                    <div className="row" style={{ gap: 10 }}>
                      <button onClick={() => dupliceerZoom(i)} title="Kopiëren" style={{ background: "none", border: 0, cursor: "pointer", fontSize: 14 }}>⎘</button>
                      <button onClick={() => verwijderZoom(i)} title="Verwijderen" style={{ background: "none", border: 0, color: "var(--rec)", cursor: "pointer", fontSize: 15 }}>✕</button>
                    </div>
                  </div>
                  {zoomSel === i && (
                    <div style={{ marginTop: 10, display: "grid", gap: 8, fontSize: 12 }}>
                      <label>Duur tot {mmss(k.tEnd)}<input type="range" min={k.tStart + 0.5} max={duur} step={0.1} value={k.tEnd} onChange={(e) => updateZoom(i, { tEnd: +e.target.value })} style={{ width: "100%" }} /></label>

                      <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px", justifySelf: "start" }} onClick={() => setGeavanceerd((v) => !v)}>
                        {geavanceerd ? "▾ Geavanceerde instellingen" : "▸ Geavanceerde instellingen"}
                      </button>
                      {geavanceerd && (
                        <div style={{ display: "grid", gap: 6, paddingLeft: 4, borderLeft: "2px solid var(--line)" }}>
                          <label>Schaal {k.scale.toFixed(1)}×<input type="range" min={MIN_SCALE} max={3} step={0.1} value={k.scale} onChange={(e) => updateZoom(i, { scale: +e.target.value })} style={{ width: "100%" }} /></label>
                          <label>Centrum X {Math.round(k.cx * 100)}%<input type="range" min={0} max={1} step={0.01} value={k.cx} onChange={(e) => updateZoom(i, { cx: +e.target.value })} style={{ width: "100%" }} /></label>
                          <label>Centrum Y {Math.round(k.cy * 100)}%<input type="range" min={0} max={1} step={0.01} value={k.cy} onChange={(e) => updateZoom(i, { cy: +e.target.value })} style={{ width: "100%" }} /></label>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          {tab === "camera" && (
            !hasWebcam || !webcam ? (
              <p className="muted" style={{ fontSize: 13 }}>Deze opname heeft geen webcam-track.</p>
            ) : (
              <div style={{ display: "grid", gap: 12, fontSize: 13 }}>
                <p className="callout" style={{ marginTop: 0 }}>Versleep de webcam in de video; trek aan de hoeken om te schalen.</p>
                <label className="toggle"><input type="checkbox" checked={webcam.visible} onChange={(e) => setWebcam({ ...webcam, visible: e.target.checked })} /> Webcam tonen</label>
                <div>Snelle plek:
                  <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                    {([["Linksonder", 0.04, 0.7], ["Rechtsonder", 0.74, 0.7], ["Linksboven", 0.04, 0.04], ["Rechtsboven", 0.74, 0.04]] as const).map(([lbl, x, y]) => (
                      <button key={lbl} className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px" }} onClick={() => setWebcam({ ...webcam, x, y })}>{lbl}</button>
                    ))}
                  </div>
                </div>
                <label className="toggle"><input type="checkbox" checked={webcam.shape === "circle"} onChange={(e) => setWebcam({ ...webcam, shape: e.target.checked ? "circle" : "rounded" })} /> Rond</label>
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px", justifySelf: "start" }} onClick={() => setGeavanceerd((v) => !v)}>
                  {geavanceerd ? "▾ Geavanceerd" : "▸ Geavanceerd"}
                </button>
                {geavanceerd && <label>Grootte {Math.round(webcam.size * 100)}%<input type="range" min={0.1} max={0.5} step={0.01} value={webcam.size} onChange={(e) => setWebcam({ ...webcam, size: +e.target.value })} style={{ width: "100%" }} /></label>}
              </div>
            )
          )}

          {tab === "achtergrond" && (
            <div style={{ display: "grid", gap: 12, fontSize: 13 }}>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-ghost" aria-selected={bg.type === "none"} onClick={() => setBg({ ...bg, type: "none" })}>Geen</button>
                <button className="btn btn-ghost" aria-selected={bg.type === "color"} onClick={() => setBg({ ...bg, type: "color" })}>Kleur</button>
              </div>
              {bg.type === "color" && (
                <>
                  <label className="row" style={{ gap: 10 }}>Kleur <input type="color" value={bg.value} onChange={(e) => setBg({ ...bg, value: e.target.value })} /></label>
                  <label>Marge {Math.round(bg.padding * 100)}%<input type="range" min={0} max={0.15} step={0.01} value={bg.padding} onChange={(e) => setBg({ ...bg, padding: +e.target.value })} style={{ width: "100%" }} /></label>
                </>
              )}
            </div>
          )}

          {tab === "captions" && (
            <div style={{ display: "grid", gap: 12, fontSize: 13 }}>
              {segments.length === 0 ? (
                <p className="muted">Geen transcript → geen captions.</p>
              ) : (
                <>
                  <label className="toggle"><input type="checkbox" checked={captions.enabled} onChange={(e) => setCaptions({ ...captions, enabled: e.target.checked })} /> Captions tonen (preview)</label>
                  <label>Tekstgrootte {captions.size}px<input type="range" min={10} max={48} step={1} value={captions.size} onChange={(e) => setCaptions({ ...captions, size: +e.target.value })} style={{ width: "100%" }} /></label>
                  <label className="row" style={{ gap: 10 }}>Tekstkleur <input type="color" value={captions.color} onChange={(e) => setCaptions({ ...captions, color: e.target.value })} /></label>
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn btn-ghost" aria-selected={captions.positie === "onder"} onClick={() => setCaptions({ ...captions, positie: "onder" })}>Onderaan</button>
                    <button className="btn btn-ghost" aria-selected={captions.positie === "boven"} onClick={() => setCaptions({ ...captions, positie: "boven" })}>Bovenaan</button>
                  </div>
                  <p className="muted" style={{ fontSize: 12 }}>Op de site staan captions standaard uit; kijkers zetten ze aan met de CC-knop — met deze stijl.</p>
                </>
              )}
            </div>
          )}

          {tab === "overlays" && (
            <>
              <p className="callout" style={{ marginTop: 0, marginBottom: 12 }}>
                {plaatsType ? <><b>Klik in de video</b> om je {plaatsType === "text" ? "tekst" : plaatsType === "box" ? "kader" : "pijl"} te plaatsen.</> : <>Kies een type en klik in de video om het te plaatsen — daarna versleep en schaal je het.</>}
              </p>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-ghost" aria-selected={plaatsType === "text"} onClick={() => startPlaatsen("text")}>+ Tekst</button>
                <button className="btn btn-ghost" aria-selected={plaatsType === "box"} onClick={() => startPlaatsen("box")}>+ Kader</button>
                <button className="btn btn-ghost" aria-selected={plaatsType === "arrow"} onClick={() => startPlaatsen("arrow")}>+ Pijl</button>
              </div>
              {overlays.length === 0 && <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>Nog geen overlays.</p>}
              {overlays.map((o, i) => (
                <div key={o.id} className="kf" data-sel={overlaySel === i}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <button className="muted" style={{ background: "none", border: 0, cursor: "pointer", textTransform: "capitalize" }} onClick={() => { setOverlaySel(i); seekNaar(o.tStart + 0.05); }}>{o.type} · {mmss(o.tStart)}–{mmss(o.tEnd)}</button>
                    <button onClick={() => { setOverlays((v) => v.filter((_, idx) => idx !== i)); setOverlaySel(-1); }} style={{ background: "none", border: 0, color: "var(--rec)", cursor: "pointer" }}>✕</button>
                  </div>
                  {overlaySel === i && (
                    <div style={{ marginTop: 8, display: "grid", gap: 8, fontSize: 12 }}>
                      {o.type === "text" && <label>Tekst<input type="text" value={o.text ?? ""} onChange={(e) => updateOverlay(i, { text: e.target.value })} /></label>}
                      <label className="row" style={{ gap: 10 }}>Kleur <input type="color" value={o.color} onChange={(e) => updateOverlay(i, { color: e.target.value })} /></label>
                      <label>Tot {mmss(o.tEnd)}<input type="range" min={o.tStart + 0.5} max={duur} step={0.1} value={o.tEnd} onChange={(e) => updateOverlay(i, { tEnd: +e.target.value })} style={{ width: "100%" }} /></label>
                      <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px", justifySelf: "start" }} onClick={() => setGeavanceerd((v) => !v)}>
                        {geavanceerd ? "▾ Positie (geavanceerd)" : "▸ Positie (geavanceerd)"}
                      </button>
                      {geavanceerd && (
                        <div style={{ display: "grid", gap: 6, paddingLeft: 4, borderLeft: "2px solid var(--line)" }}>
                          <label>X<input type="range" min={0} max={1} step={0.01} value={o.x} onChange={(e) => updateOverlay(i, { x: +e.target.value })} style={{ width: "100%" }} /></label>
                          <label>Y<input type="range" min={0} max={1} step={0.01} value={o.y} onChange={(e) => updateOverlay(i, { y: +e.target.value })} style={{ width: "100%" }} /></label>
                          <label>Breedte<input type="range" min={0.05} max={1} step={0.01} value={o.w} onChange={(e) => updateOverlay(i, { w: +e.target.value })} style={{ width: "100%" }} /></label>
                          <label>Hoogte<input type="range" min={0.05} max={1} step={0.01} value={o.h} onChange={(e) => updateOverlay(i, { h: +e.target.value })} style={{ width: "100%" }} /></label>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          {tab === "blur" && (
            <>
              <p className="callout" style={{ marginTop: 0, marginBottom: 12 }}>Sleep het kader over gevoelige info (BSN, IBAN, bedragen).</p>
              <button className="btn btn-ghost" onClick={blurToevoegen}>+ Blur-regio</button>
              {blurRegios.length === 0 && <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>Nog geen blur-regio's.</p>}
              {blurRegios.map((s, i) => (
                <div key={s.id} className="kf" data-sel={blurSel === i}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <button className="muted" style={{ background: "none", border: 0, cursor: "pointer" }} onClick={() => { setBlurSel(i); seekNaar(s.tStart + 0.05); }}>Blur · {mmss(s.tStart)}–{mmss(s.tEnd)}</button>
                    <button onClick={() => { setBlurRegios((v) => v.filter((_, idx) => idx !== i)); setBlurSel(-1); }} style={{ background: "none", border: 0, color: "var(--rec)", cursor: "pointer" }}>✕</button>
                  </div>
                  {blurSel === i && (
                    <div style={{ marginTop: 8, display: "grid", gap: 8, fontSize: 12 }}>
                      <label>Sterkte {s.intensiteit}px<input type="range" min={3} max={30} step={1} value={s.intensiteit} onChange={(e) => updateBlur(i, { intensiteit: +e.target.value })} style={{ width: "100%" }} /></label>
                      <label>Tot {mmss(s.tEnd)}<input type="range" min={s.tStart + 0.5} max={duur} step={0.1} value={s.tEnd} onChange={(e) => updateBlur(i, { tEnd: +e.target.value })} style={{ width: "100%" }} /></label>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* ── Actie-footer (volledige breedte, binnen de stage) ─────────── */}
      <div className="editor__foot">
        <button className="btn btn-ghost" onClick={onTerug} disabled={bezig}>← Terug</button>
        <button className="btn btn-primary" onClick={publiceer} disabled={bezig}>
          {bezig ? "Publiceren…" : "Publiceren met bewerking"}
        </button>
      </div>
    </div>
  );
}
