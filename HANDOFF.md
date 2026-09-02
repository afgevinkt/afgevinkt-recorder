# Handoff — Afgevinkt Recorder (Electron)

> Cross-machine context (Windows ↔ Mac). Laatst bijgewerkt: 2026-06-23.
> Repo: `afgevinkt/afgevinkt-recorder`. Aparte repo/map naast `afgevinkt-app`.

## 🔗 Relatie met de web-app
- De recorder logt in via **`POST {baseUrl}/api/desktop/login`** en bewaart een **Bearer-token** (versleuteld met Electron `safeStorage`, in `src/main/store.ts`). Uploads gaan met dat token; de renderer raakt het token nooit aan.
- De web-app serveert de installers via de **Installeren-knop** op `/opnames` ([InstalleerKnop.tsx](../afgevinkt-app/app/(dashboard)/opnames/InstalleerKnop.tsx)):
  - Win: `NEXT_PUBLIC_RECORDER_WIN_URL` → fallback `/downloads/Afgevinkt-Recorder-win.exe`
  - Mac: `NEXT_PUBLIC_RECORDER_MAC_URL` → fallback `/downloads/Afgevinkt-Recorder-mac.dmg`
- Die bestanden staan in **`afgevinkt-app/public/downloads/`** en zijn **gitignored** (te groot). Ze komen dus **niet** via de git-deploy mee → na een nieuwe build moet het bestand **handmatig naar de Hostinger-server** (of naar externe hosting + env-URL zetten). Zie "Release" onder.

## ✅ Stand: 2FA-ondersteuning (v0.2.0, 2026-06-23) — Windows gedaan
De desktop-login ondersteunt nu **tweestapsverificatie (TOTP)**. Doorgevoerd in:
- `src/renderer/src/components/Login.tsx` — verificatiecode-veld dat verschijnt zodra de server erom vraagt (6-cijferige code óf back-upcode).
- `src/preload/index.ts` + `src/renderer/src/env.d.ts` — `login(baseUrl, email, wachtwoord, totp?)` + retour `{ ok:false, fout, code? }`.
- `src/main/index.ts` (`auth:login`) — stuurt `totp` mee en geeft het machine-`error`-veld door als `code`.

**Contract (web-app `app/api/desktop/login/route.ts`):**
| Situatie | HTTP | body |
|---|---|---|
| 2FA actief, `totp` ontbreekt | 401 | `{ error: "TOTP_VEREIST" }` → toon codeveld |
| Code fout | 401 | `{ error: "TOTP_ONGELDIG" }` → opnieuw (telt mee in lockout) |
| 2FA verplicht maar niet ingesteld | 403 | `{ error: "TOTP_SETUP_VEREIST" }` → eerst in browser (portal → Beveiliging) |
| OK | 200 | `{ token, user }` |

`totp` accepteert zowel een 6-cijferige TOTP-code als een back-upcode.

## 🍎 TODO op de Mac: nieuwe **macOS**-build (v0.2.0) uitbrengen
De codewijziging is platform-onafhankelijk en staat al in de repo — je hoeft **alleen te bouwen + uitbrengen** op een Mac:
1. Zorg dat OneDrive de map heeft gesynct zodat je de v0.2.0-code hebt (deze map is **geen git-repo** — sync loopt via OneDrive; check `package.json` → `"version": "0.2.0"`).
2. `rm -rf node_modules && npm install` (native modules machine-specifiek).
3. `npm run typecheck` → moet groen zijn.
4. **Bouwen:** `npm run dist:mac` → levert in `release/`:
   `Afgevinkt-Recorder-0.2.0-mac-arm64.dmg` en `…-x64.dmg`.
   - **Codesigning/notarisatie** (aanbevolen, anders Gatekeeper-waarschuwing): zet in `electron-builder.yml` onder `mac:` `notarize: true` en exporteer `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` (of de API-key-variant) + `CSC_LINK`/`CSC_KEY_PASSWORD`. Zonder certificaat laat je `notarize: false` (ongetekend).
5. **Release:** kopieer de gewenste `.dmg` naar `afgevinkt-app/public/downloads/Afgevinkt-Recorder-mac.dmg` (stabiele naam, zonder versie — dat is wat de knop verwacht). Meestal wil je de **arm64**-dmg (Apple Silicon); voor Intel-Macs eventueel een aparte URL.
6. **Naar productie:** upload dat bestand naar de Hostinger-server op hetzelfde pad (`public/downloads/…`), want het is gitignored. Alternatief: host 'm extern (Supabase Storage / GitHub Release) en zet `NEXT_PUBLIC_RECORDER_MAC_URL` in de Hostinger-env.
7. Test: installeer, log in met een 2FA-account → codeveld hoort te verschijnen → code → binnen.

Startzin voor de Mac-sessie:
> "Lees videorecording-app/HANDOFF.md. Bouw de macOS-recorder v0.2.0 (dist:mac) en leg 'm klaar in afgevinkt-app/public/downloads. Niets deployen zonder het te zeggen."

## 🏗️ Build/release-commando's (naslag)
- `npm run dev` — lokaal draaien (electron-vite).
- `npm run typecheck` — `tsc --noEmit`.
- `npm run dist:win` (op Windows) / `npm run dist:mac` (op macOS) → `release/`.
- Config: `electron-builder.yml` (`appId: nl.afgevinkt.recorder`, `output: release`, `npmRebuild: false` — native prebuilds, geen node-gyp).
- Bump `package.json` → `version` bij elke uitgebrachte build.

## ⚠️ Valkuilen
- Native modules (`onnxruntime-node`, `uiohook-napi`, `@huggingface/transformers`) blijven **buiten de asar** (`asarUnpack` in de config) — niet aanpassen.
- Installers zijn groot (~165-185 MB) en **gitignored**; commit ze nooit.
- OneDrive-map met spaties: doe een schone `npm install` per machine.
