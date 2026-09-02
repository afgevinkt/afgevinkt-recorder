import { useEffect, useState } from "react";
import type { DesktopUser } from "./env";
import Login from "./components/Login";
import Studio from "./Studio";

export default function App() {
  const [laden, setLaden] = useState(true);
  const [user, setUser] = useState<DesktopUser | null>(null);
  // Wordt direct overschreven door de echte baseUrl uit de sessie (main);
  // dit is enkel de eerste render vóór die binnen is.
  const [baseUrl, setBaseUrl] = useState("https://afgevinkt.nl");

  async function ververs() {
    const s = await window.api.getSession();
    setBaseUrl(s.baseUrl);
    setUser(s.loggedIn ? s.user : null);
    setLaden(false);
  }

  useEffect(() => {
    ververs();
  }, []);

  async function logout() {
    await window.api.logout();
    setUser(null);
  }

  if (laden) {
    return (
      <div className="login-wrap">
        <p className="muted">Laden…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="login-wrap">
        <Login
          baseUrl={baseUrl}
          onIngelogd={(u, url) => {
            setUser(u);
            setBaseUrl(url);
          }}
        />
      </div>
    );
  }

  return <Studio user={user} onLogout={logout} onSessieVerlopen={() => setUser(null)} />;
}
