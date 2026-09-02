import { useEffect, useRef, useState } from "react";
import Viewfinder from "./Viewfinder";
import { mmss } from "../lib/format";

// Live opname: scherm-preview met framing brackets, lopende mono-timer en
// (optioneel) webcam-PiP. De kleur is coral zolang er wordt opgenomen.
export default function RecordingStage({
  screenStream,
  webcamStream,
  webcamGevraagd = false,
  webcamFout = null,
  micActief,
  bronNaam,
  onStop,
}: {
  screenStream: MediaStream | null;
  webcamStream: MediaStream | null;
  webcamGevraagd?: boolean;
  webcamFout?: string | null;
  micActief: boolean;
  bronNaam: string;
  onStop: () => void;
}) {
  const screenRef = useRef<HTMLVideoElement | null>(null);
  const camRef = useRef<HTMLVideoElement | null>(null);
  const [sec, setSec] = useState(0);

  useEffect(() => {
    if (screenRef.current && screenStream) {
      screenRef.current.srcObject = screenStream;
      screenRef.current.muted = true;
      screenRef.current.play().catch(() => {});
    }
  }, [screenStream]);

  useEffect(() => {
    if (camRef.current && webcamStream) {
      camRef.current.srcObject = webcamStream;
      camRef.current.muted = true;
      camRef.current.play().catch(() => {});
    }
  }, [webcamStream]);

  useEffect(() => {
    const id = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="stage">
      <div className="stage__head">
        <span className="eyebrow">Stap 02 — Opnemen</span>
        <h1>Aan het opnemen</h1>
        <p className="sub">Bron: {bronNaam}. Stop wanneer je klaar bent.</p>
      </div>

      {webcamGevraagd && !webcamStream && (
        <p className="error" role="alert" style={{ marginTop: 0, marginBottom: 14 }}>
          ⚠️ {webcamFout ?? "Webcam niet beschikbaar — de opname loopt zonder camera."}
        </p>
      )}

      <Viewfinder live badge={mmss(sec)}>
        <video ref={screenRef} className="vf__media" style={{ aspectRatio: "16 / 9" }} playsInline />
        {webcamStream && (
          <video
            ref={camRef}
            playsInline
            style={{
              position: "absolute",
              right: 16,
              bottom: 16,
              width: "15%",
              aspectRatio: "1 / 1",
              objectFit: "cover",
              borderRadius: "50%",
              border: "2px solid rgba(255,255,255,0.85)",
              zIndex: 2,
              background: "#000",
            }}
          />
        )}
      </Viewfinder>

      <div className="row" style={{ marginTop: 18, justifyContent: "space-between" }}>
        <div className="readouts">
          <div className="readout rec">
            <b>{mmss(sec)}</b>
            <span>Tijd</span>
          </div>
          <div className="readout">
            <b style={{ color: webcamStream ? "var(--accent)" : "var(--muted2)" }}>
              {webcamStream ? "AAN" : "UIT"}
            </b>
            <span>Webcam</span>
          </div>
          <div className="readout">
            <b style={{ color: micActief ? "var(--accent)" : "var(--muted2)" }}>
              {micActief ? "MIC" : "UIT"}
            </b>
            <span>Audio</span>
          </div>
        </div>
        <button className="btn btn-rec" onClick={onStop}>
          ◼ Opname stoppen
        </button>
      </div>
    </div>
  );
}
