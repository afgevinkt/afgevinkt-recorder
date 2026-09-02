import { useCallback, useEffect, useState } from "react";
import type { OpnameItem } from "../env";
import { mmss, bytes } from "../lib/format";

// Lokale opnamen-bibliotheek: toont alle non-destructief bewaarde opname-
// projecten (userData/opnames). Vanaf hier kun je afspelen, de map openen,
// opnieuw publiceren (handig na een verlopen sessie) en verwijderen.

function datumLabel(ms: number): string {
  try {
    return new Date(ms).toLocaleString("nl-NL", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export default function OpnamenPage({
  onTerug,
  onSessieVerlopen,
  onBewerk,
}: {
  onTerug: () => void;
  onSessieVerlopen: () => void;
  onBewerk: (id: string) => void;
}) {
  const [items, setItems] = useState<OpnameItem[] | null>(null);
  const [bezigId, setBezigId] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [melding, setMelding] = useState<string | null>(null);

  const laad = useCallback(async () => {
    setFout(null);
    try {
      setItems(await window.api.listOpnamen());
    } catch (e) {
      setItems([]);
      setFout(e instanceof Error ? e.message : "Kon opnamen niet laden");
    }
  }, []);

  useEffect(() => {
    laad();
  }, [laad]);

  async function afspelen(id: string) {
    const r = await window.api.playOpname(id);
    if (!r.ok) setFout(r.fout);
  }

  async function mapOpenen(id: string) {
    const r = await window.api.openOpname(id);
    if (!r.ok) setFout(r.fout);
  }

  async function opnieuwPubliceren(item: OpnameItem) {
    setBezigId(item.id);
    setFout(null);
    setMelding(null);
    try {
      const r = await window.api.reuploadOpname(item.id);
      if (r.ok) {
        setMelding(`“${item.titel}” is gepubliceerd — terug te zien onder ‘Opnames’ in Afgevinkt!`);
        await laad();
      } else if (r.needsLogin) {
        onSessieVerlopen();
      } else {
        setFout(r.fout);
      }
    } finally {
      setBezigId(null);
    }
  }

  async function verwijderen(item: OpnameItem) {
    const ok = window.confirm(
      `“${item.titel}” definitief van deze computer verwijderen?\n\nDe lokale video en bewerkingen gaan verloren. Een al gepubliceerde opname op de site blijft staan.`,
    );
    if (!ok) return;
    setBezigId(item.id);
    setFout(null);
    try {
      const r = await window.api.deleteOpname(item.id);
      if (r.ok) {
        setMelding(`“${item.titel}” verwijderd.`);
        await laad();
      } else {
        setFout(r.fout);
      }
    } finally {
      setBezigId(null);
    }
  }

  return (
    <div className="stage">
      <div className="stage__head">
        <span className="eyebrow">Bibliotheek</span>
        <h1>Mijn opnamen</h1>
        <p className="sub">
          Alles wat je opneemt wordt lokaal bewaard op deze computer. Hier kun je terugkijken en
          opnieuw publiceren.
        </p>
      </div>

      <div className="row" style={{ marginBottom: 18 }}>
        <button className="btn btn-ghost" onClick={onTerug}>
          ← Nieuwe opname
        </button>
        <button className="btn btn-ghost" onClick={laad}>
          Vernieuwen
        </button>
      </div>

      {melding && <p className="ok" style={{ marginBottom: 14 }}>{melding}</p>}
      {fout && <p className="error" style={{ marginBottom: 14 }}>{fout}</p>}

      {items === null && <p className="muted">Laden…</p>}

      {items !== null && items.length === 0 && (
        <div className="panel" style={{ maxWidth: 560 }}>
          <p className="muted" style={{ margin: 0 }}>
            Nog geen opnamen. Maak een opname via <strong>Nieuwe opname</strong> — die verschijnt
            daarna hier.
          </p>
        </div>
      )}

      {items && items.length > 0 && (
        <ul className="opn-grid">
          {items.map((item) => {
            const bezig = bezigId === item.id;
            return (
              <li key={item.id} className="opn-card">
                <div className="opn-thumb">
                  {item.thumbnail ? (
                    <img src={item.thumbnail} alt="" />
                  ) : (
                    <span className="opn-thumb__leeg">Geen voorbeeld</span>
                  )}
                  <span className="opn-duur">{mmss(item.durationSec)}</span>
                </div>

                <div className="opn-body">
                  <div className="opn-titel" title={item.titel}>
                    {item.titel}
                  </div>
                  <div className="opn-meta">
                    {datumLabel(item.gemaaktOp)} · {bytes(item.grootteBytes)}
                    {item.heeftWebcam ? " · webcam" : ""}
                  </div>
                  <div className="opn-badges">
                    {item.gepubliceerd ? (
                      <span className="badge badge--ok">Gepubliceerd</span>
                    ) : (
                      <span className="badge badge--wacht">Niet gepubliceerd</span>
                    )}
                  </div>
                </div>

                <div className="opn-acties">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => afspelen(item.id)}
                    disabled={!item.speelbaar || bezig}
                  >
                    Afspelen
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => onBewerk(item.id)}
                    disabled={!item.speelbaar || bezig}
                  >
                    Bewerken
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => mapOpenen(item.id)}
                    disabled={bezig}
                  >
                    Map openen
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => opnieuwPubliceren(item)}
                    disabled={!item.speelbaar || bezig}
                  >
                    {bezig ? "Bezig…" : item.gepubliceerd ? "Opnieuw publiceren" : "Publiceren"}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm btn-gevaar"
                    onClick={() => verwijderen(item)}
                    disabled={bezig}
                  >
                    Verwijderen
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
