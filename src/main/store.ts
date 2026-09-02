import { app, safeStorage } from "electron";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

// Sessie van de desktop-app: het Bearer-token (versleuteld met safeStorage),
// de baseUrl van de site, en wat user-info voor de UI. Bestand staat in userData.
// Toekomst (tech-debt #14): vervang wachtwoord-login door browser-based device-auth.

export interface DesktopUser {
  id: string;
  naam: string;
  initialen: string;
  rol: string;
}

export interface Session {
  baseUrl: string;
  token: string;
  user: DesktopUser;
}

interface StoredSession {
  baseUrl: string;
  tokenEnc: string; // base64 van safeStorage-encryptie (of plaintext-fallback)
  encrypted: boolean;
  user: DesktopUser;
}

function bestand(): string {
  return join(app.getPath("userData"), "session.json");
}

export function saveSession(s: Session): void {
  const canEncrypt = safeStorage.isEncryptionAvailable();
  const tokenEnc = canEncrypt
    ? safeStorage.encryptString(s.token).toString("base64")
    : Buffer.from(s.token, "utf8").toString("base64");
  const data: StoredSession = {
    baseUrl: s.baseUrl,
    tokenEnc,
    encrypted: canEncrypt,
    user: s.user,
  };
  writeFileSync(bestand(), JSON.stringify(data), { mode: 0o600 });
}

export function loadSession(): Session | null {
  try {
    if (!existsSync(bestand())) return null;
    const data = JSON.parse(readFileSync(bestand(), "utf8")) as StoredSession;
    const buf = Buffer.from(data.tokenEnc, "base64");
    const token = data.encrypted ? safeStorage.decryptString(buf) : buf.toString("utf8");
    return { baseUrl: data.baseUrl, token, user: data.user };
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    if (existsSync(bestand())) rmSync(bestand());
  } catch {
    /* best-effort */
  }
}
