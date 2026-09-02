import { useEffect, useState } from "react";
import type { SourceInfo } from "../env";

// Eigen bronkiezer: schermen en vensters met thumbnails. Vervangt de
// (niet altijd werkende) native macOS-picker.
export default function SourcePicker({ onChoose }: { onChoose: (s: SourceInfo) => void }) {
  const [bronnen, setBronnen] = useState<SourceInfo[]>([]);
  const [tab, setTab] = useState<"screen" | "window">("screen");
  const [laden, setLaden] = useState(true);
  const [fout, setFout] = useState<string | null>(null);

  async function laad() {
    setLaden(true);
    setFout(null);
    try {
      const lijst = await window.api.listSources();
      setBronnen(lijst);
      if (lijst.length === 0) {
        setFout(
          "Geen schermen/vensters gevonden. Sta op macOS ‘Schermopname’ toe voor Afgevinkt Recorder " +
            "(Systeeminstellingen → Privacy & beveiliging → Schermopname) en herstart de app.",
        );
      }
    } catch {
      setFout(
        "Kon bronnen niet ophalen. Waarschijnlijk staat ‘Schermopname’ nog niet aan: " +
          "Systeeminstellingen → Privacy & beveiliging → Schermopname → Afgevinkt Recorder aanzetten, daarna de app herstarten.",
      );
    } finally {
      setLaden(false);
    }
  }

  useEffect(() => {
    laad();
  }, []);

  const zichtbaar = bronnen.filter((b) => b.type === tab);

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "screen"}
            className="tab"
            onClick={() => setTab("screen")}
          >
            Volledig scherm
          </button>
          <button
            role="tab"
            aria-selected={tab === "window"}
            className="tab"
            onClick={() => setTab("window")}
          >
            Venster
          </button>
        </div>
        <button className="btn btn-ghost" onClick={laad}>
          Vernieuwen
        </button>
      </div>

      {laden ? (
        <p className="muted">Bronnen laden…</p>
      ) : fout ? (
        <p className="error">{fout}</p>
      ) : zichtbaar.length === 0 ? (
        <p className="muted">Geen {tab === "screen" ? "schermen" : "vensters"} gevonden.</p>
      ) : (
        <div className="sources">
          {zichtbaar.map((b) => (
            <button key={b.id} className="source" onClick={() => onChoose(b)} title={b.naam}>
              {b.thumbnail ? (
                <img className="source__thumb" src={b.thumbnail} alt="" />
              ) : (
                <span className="source__thumb" />
              )}
              <span className="source__meta">
                {b.appIcon && <img className="source__icon" src={b.appIcon} alt="" />}
                <span className="source__name">{b.naam}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
