# Afgevinkt Recorder

Schermopname-tool (desktop) voor de **Opnames**-functie van Afgevinkt!. Kies een scherm of venster,
neem op (+ microfoon, optionele webcam-track, cursor-timeline), krijg een **lokaal gegenereerd
transcript** (Whisper, WASM), en upload naar de site `afgevinkt-app` waar ingelogde team-leden de
opname terugkijken onder **Opnames** — met captions en een interactieve transcript.

Dit dekt **Fase 1 (capture + upload)** en **Fase 2 (lokale transcriptie)**, plus een eigen
bronkiezer en een herontworpen UI. Zie het plan en de ADR's in `../afgevinkt-app/docs/adr/`.

## Architectuur

- **Electron + React + TypeScript** (electron-vite).
- **Main-proces** doet login én upload (Node `fetch`) → geen CORS, en het Bearer-token blijft
  buiten de renderer (`src/main`). Sessie versleuteld via `safeStorage`.
- **Renderer** neemt op via de uitwisselbare `CaptureEngine` (v1: `MediaRecorderCaptureEngine`).
- **Cursor-timeline** wordt globaal in main gepolld (`screen.getCursorScreenPoint`).
- Het ruwe **Opname-project** wordt lokaal bewaard onder `userData/opnames/<timestamp>/`.

## Vereisten

- Node 18+ en de site `afgevinkt-app` lokaal draaiend (`npm run dev`, standaard `http://localhost:3000`).
- In Supabase: migratie `011_opnames.sql` toegepast + een **privé** bucket `opnames`.

## Draaien (development)

```bash
npm install
npm run dev
```

Log in met een Afgevinkt!-teamaccount, kies eventueel "Webcam meenemen", klik **Scherm opnemen**,
neem op, **Stoppen**, geef een titel en **Uploaden**. De opname verschijnt onder **Opnames** in de site.

## Scripts

- `npm run dev` — start de app in development.
- `npm run build` — bouwt main/preload/renderer naar `out/`.
- `npm run typecheck` — TypeScript-check zonder build.

## Transcriptie (lokaal)

Na het stoppen draait Whisper (`Xenova/whisper-base`) lokaal in het **main-proces** via
`@huggingface/transformers` met de **native onnxruntime-node**-backend (geen WASM/threads/CSP — veel
betrouwbaarder in Electron). De renderer decodeert alleen de audio (Web Audio API) en stuurt 16kHz
mono PCM via IPC naar main. De audio verlaat de machine niet; alleen het model wordt **éénmalig** van
Hugging Face gedownload (~150MB, internet nodig) en daarna lokaal gecached in `userData/models` —
daarna werkt het offline.

## Buiten scope (latere fasen)

Systeemaudio (alleen microfoon), editor/render (Fase 4–5), zoeken in transcripties (Fase 3),
resumable uploads, en echte klik-detectie (nu cursor-positie). Zie de roadmap in het plan.
