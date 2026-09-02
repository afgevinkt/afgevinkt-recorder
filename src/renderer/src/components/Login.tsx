import { useState } from "react";
import type { DesktopUser } from "../env";
import Logo from "./Logo";

// Login met team-credentials. v1 = e-mail + wachtwoord → Bearer-token (in main).
// Toekomst (tech-debt #14): browser-based device-auth i.p.v. wachtwoord hier.
export default function Login({
  baseUrl,
  onIngelogd,
}: {
  baseUrl: string;
  onIngelogd: (user: DesktopUser, baseUrl: string) => void;
}) {
  const [url, setUrl] = useState(baseUrl);
  const [email, setEmail] = useState("");
  const [wachtwoord, setWachtwoord] = useState("");
  const [totp, setTotp] = useState("");
  const [vraagCode, setVraagCode] = useState(false);
  const [toonWw, setToonWw] = useState(false);
  const [serverOpen, setServerOpen] = useState(false);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBezig(true);
    setFout(null);
    const res = await window.api.login(url, email, wachtwoord, vraagCode ? totp : undefined);
    if (res.ok) {
      onIngelogd(res.user, url);
      return;
    }
    // 2FA-signalen van de server → codeveld tonen of naar de browser sturen.
    if (res.code === "TOTP_VEREIST") {
      setVraagCode(true);
      // Eerste keer: geen rode fout, alleen het veld tonen. Al zichtbaar = leeg gelaten.
      setFout(vraagCode ? "Voer je verificatiecode in." : null);
    } else if (res.code === "TOTP_ONGELDIG") {
      setVraagCode(true);
      setTotp("");
      setFout("Ongeldige verificatiecode. Probeer opnieuw (of gebruik een back-upcode).");
    } else if (res.code === "TOTP_SETUP_VEREIST") {
      setVraagCode(false);
      setFout(res.fout || "Stel eerst tweestapsverificatie in via de portal (Beveiliging) in je browser.");
    } else {
      setVraagCode(false);
      setFout(res.fout);
    }
    setBezig(false);
  }

  return (
    <form className="login panel" onSubmit={submit}>
      <Logo />
      <div className="stage__head" style={{ marginTop: 18, marginBottom: 0 }}>
        <span className="eyebrow">Inloggen</span>
        <h1 style={{ fontSize: 20 }}>Welkom terug</h1>
        <p className="sub">Gebruik je Afgevinkt!-teamaccount.</p>
      </div>

      <div className="field">
        <label htmlFor="email">E-mail</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={!!fout}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="ww">Wachtwoord</label>
        <div className="input-affix">
          <input
            id="ww"
            type={toonWw ? "text" : "password"}
            autoComplete="current-password"
            value={wachtwoord}
            onChange={(e) => setWachtwoord(e.target.value)}
            aria-invalid={!!fout}
            required
          />
          <button
            type="button"
            className="input-affix__btn"
            onClick={() => setToonWw((v) => !v)}
            aria-label={toonWw ? "Wachtwoord verbergen" : "Wachtwoord tonen"}
            title={toonWw ? "Verbergen" : "Tonen"}
          >
            {toonWw ? "Verberg" : "Toon"}
          </button>
        </div>
      </div>

      {vraagCode && (
        <div className="field">
          <label htmlFor="totp">Verificatiecode</label>
          <input
            id="totp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            placeholder="6-cijferige code of back-upcode"
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
            aria-invalid={!!fout}
            required
          />
          <p className="sub" style={{ marginTop: 6 }}>
            Uit je authenticator-app (Microsoft/Google Authenticator). Geen toegang? Gebruik een back-upcode.
          </p>
        </div>
      )}

      {fout && <p className="error" role="alert">{fout}</p>}

      <button className="btn btn-primary" type="submit" disabled={bezig} style={{ width: "100%", justifyContent: "center", marginTop: 20 }}>
        {bezig ? "Bezig…" : vraagCode ? "Verifiëren" : "Inloggen"}
      </button>

      <button
        type="button"
        className="link-knop"
        onClick={() => setServerOpen((v) => !v)}
      >
        {serverOpen ? "▾ Server" : "▸ Server (geavanceerd)"}
      </button>
      {serverOpen && (
        <div className="field" style={{ marginTop: 8 }}>
          <label htmlFor="url">Server-URL</label>
          <input id="url" type="text" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
      )}
    </form>
  );
}
