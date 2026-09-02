// CaptureEngine — de uitwisselbare opname-laag (ADR 5).
// v1 = MediaRecorderCaptureEngine. De rest van de app praat ALLEEN met deze
// interface, zodat later een native (FFmpeg) engine inplugbaar is zonder de
// aanroepende code te wijzigen (4K / multi-monitor / lange opnames / hoge fps).
//
// De globale klik-/cursor-timeline hoort NIET bij de engine: die wordt globaal
// in het main-proces vastgelegd (screen.getCursorScreenPoint). De engine doet
// puur beeld + geluid.

export interface CaptureOptions {
  /** Webcam als aparte track meenemen? (optioneel, standaard uit). */
  webcam: boolean;
  /** Doel-bitrate voor de scherm-video (bits/sec). Bepaalt grootte vs scherpte;
   *  weggelaten = browser-default. */
  videoBitsPerSecond?: number;
  /** Wordt aangeroepen als de OS-balk "stop delen" de scherm-track beëindigt. */
  onEnded?: () => void;
}

export interface CaptureResult {
  /** Scherm-opname (incl. microfoon-audio; GEEN ingebrande webcam meer). */
  screen: Blob;
  /** Aparte webcam-track (video-only), of null als webcam uit stond. */
  webcam: Blob | null;
  /** Stond de webcam aan? (Aparte track aanwezig.) */
  heeftWebcam: boolean;
  /** Lengte in seconden. */
  durationSec: number;
  /** MIME-type van de opnames (bijv. video/webm;codecs=vp9,opus). */
  mimeType: string;
}

export interface CaptureEngine {
  readonly name: string;
  /** Kan deze engine in de huidige omgeving opnemen? */
  isSupported(): boolean;
  /** Start de opname; resolve zodra alles loopt. */
  start(options: CaptureOptions): Promise<void>;
  /** Stop en lever de opnames op. */
  stop(): Promise<CaptureResult>;
  /** Live scherm-stream voor preview (of null vóór start). */
  getScreenStream(): MediaStream | null;
  /** Live webcam-stream voor preview (of null). */
  getWebcamStream(): MediaStream | null;
  /** Is er een actieve microfoon-track? (false = mic geweigerd/afwezig.) */
  hasMic(): boolean;
  /** Stopt alle tracks/timers zonder op te leveren (bij afbreken/fout). */
  cleanup(): void;
}
