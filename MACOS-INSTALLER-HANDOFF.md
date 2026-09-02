# Handoff — macOS-installer bouwen (Afgevinkt Recorder)

> Voor een Claude-sessie op de **MacBook**. Dit bestand synct via OneDrive vanaf de
> Windows-machine. De memory-map (`~/.claude/...`) is per machine en bereikt de Mac
> niet — dáárom staat deze handoff in het project zelf.
>
> Laatst bijgewerkt: 2026-07-12 (vanaf Windows).

## ⚠️ UPDATE 2026-07-12 — mac .dmg opnieuw verouderd (versie 0.2.1)
Er is een fix na de arm64-build van 22-6. Publiceren gaf *"Ongeldig bestandstype
(alleen video)"*: MediaRecorder stuurt `video/webm;codecs=vp9,opus`, maar de site toetste
op de kale `video/webm`. Opgelost op **twee** plekken:
- **Recorder** (`src/main/index.ts`): nieuwe helper `baseMime()` stript de codec-parameters
  vóór de upload (live upload + `bouwOpnameForm`).
- **Site** (`afgevinkt-app/app/api/opnames/upload/route.ts`): toetst nu het basistype.
Versie is gebumpt naar **0.2.1**. De Windows-`.exe` is al herbouwd + geplaatst.

**Actie op de Mac:** bouw de arm64-`.dmg` **opnieuw** (versie 0.2.1) met de stappen hieronder
en overschrijf `afgevinkt-app/public/downloads/Afgevinkt-Recorder-mac.dmg`. (Als de site-fix
naar Hostinger is gedeployed werkt de oude .dmg óók weer, maar bouw 'm toch bij voor consistentie.)

## ✅ GEDAAN op de Mac (2026-06-22)
macOS **arm64** `.dmg` opnieuw gebouwd mét de nieuwe features (npm install + typecheck +
build groen; `npx electron-builder --mac --arm64 -c.directories.output=/tmp/afg-release`,
ongetekend). Gekopieerd naar `afgevinkt-app/public/downloads/Afgevinkt-Recorder-mac.dmg`
(176 MB). Geverifieerd: bundle-binary = **arm64**, checksum bron = kopie
(`60c5ace…`). Windows-`.exe` (159 MB) stond er al. **Nog open:** Intel-x64-dmg
(aparte build met x64-prebuilds). NB: `--arm64` beperkt de build niet i.c.m. de
config-arch-lijst — er wordt óók een x64-dmg gemaakt (met arm64-binaries → onbruikbaar);
gebruik alleen de `-mac-arm64.dmg`.

## Situatie
`videorecording-app` = de Electron-recorder. De site is de sibling `../afgevinkt-app`.
Op Windows zijn recent veel features toegevoegd (al in de code, gesynct). De
**Windows-installer is al opnieuw gebouwd en geplaatst**; de **macOS-installer is nog
oud** en moet opnieuw gebouwd worden mét de nieuwe features. Dat kan alleen op macOS.

## Wat er nieuw in de recorder zit (sinds de oude .dmg)
- **Kwaliteitskeuze** bij opnemen: Hoog / Gebalanceerd / Compact (begrenst `videoBitsPerSecond`).
- **"Mijn opnamen"-bibliotheek**: lijst van lokaal bewaarde opnames met afspelen, map openen,
  (opnieuw) publiceren en verwijderen. Railknop links.
- **Bewerken vanuit de bibliotheek**: opent een opgeslagen opname terug in de editor met
  herstel van de zooms/knips; publiceren werkt de bestaande map bij (geen dubbele kopie).
- Nieuwe IPC in `src/main/index.ts`: `opnames:list/open/play/reupload/delete/loadVoorEditor/updateEnPubliceer`.

## Taak op de Mac: bouw de .dmg en plaats 'm in /downloads/
1. `cd` naar `videorecording-app`.
2. `npm install` (zorgt voor electron-builder + typescript).
3. `npm run build` (electron-vite) — ververst `out/`.
4. `npm run typecheck` moet groen zijn.
5. Bouw **alleen arm64**, **naar /tmp** (buiten OneDrive):
   ```
   npx electron-builder --mac --arm64 -c.directories.output=/tmp/afg-release
   ```
   - **Naar /tmp**: in de OneDrive-map faalt `hdiutil detach` ("volume busy") → dmg-build mislukt.
   - **Alleen arm64**: de config heeft target arm64+x64, maar een x64-dmg krijgt arm64-binaries
     mee (onbruikbaar op Intel). Bouw host-arch. Intel-x64 is een aparte follow-up.
   - Ongetekend is OK: `notarize: false` staat onder `mac:` in `electron-builder.yml`,
     `npmRebuild: false` (de N-API native modules `onnxruntime-node`/`uiohook-napi` hebben prebuilds).
6. Kopieer het resultaat naar de download-map van de site (exact deze naam — de Installeren-knop
   op `/opnames` linkt naar `/downloads/Afgevinkt-Recorder-mac.dmg`):
   ```
   cp /tmp/afg-release/Afgevinkt-Recorder-*-mac-arm64.dmg \
      ../afgevinkt-app/public/downloads/Afgevinkt-Recorder-mac.dmg
   ```
7. Verifieer: bestand bestaat, ~170 MB.

## Status Windows-kant (al gedaan, niets te doen)
- Windows-installer gebouwd → `afgevinkt-app/public/downloads/Afgevinkt-Recorder-win.exe` (159 MB, ongetekend).

## Belangrijke context voor de site (afgevinkt-app), NIET nodig voor de Mac-installer
- Opname-**video's** gaan nu naar de **lokale schijf van Hostinger** i.p.v. Supabase Storage
  (Supabase 50 MB-limiet). Env: `OPNAMES_STORAGE=local` + `OPNAMES_STORAGE_DIR=/home/u510924188/opnames-data`
  (map BUITEN `public_html`). Metadata blijft in Supabase Postgres. Stream-route: `app/api/opnames/file`.
- Desktop-token is nu 24u; titel van een opname is bewerkbaar op `/opnames/[id]`.
- Deploy van `afgevinkt-app` naar Hostinger (Node.js) is nog te doen; maak daar de opslagmap aan.

## Openstaand / let op
- **Intel-Macs**: aparte x64-build met x64 native-module-prebuilds.
- Ongetekend → Gatekeeper waarschuwt; openen via rechtsklik → Openen, of
  `xattr -dr com.apple.quarantine "/Applications/Afgevinkt Recorder.app"`.
