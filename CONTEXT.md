# CONTEXT — Afgevinkt Recorder (glossarium)

Alleen een glossarium. De domeintaal is gedeeld met de site `afgevinkt-app`
(zie `../afgevinkt-app/CONTEXT.md`). Architectuurbeslissingen staan als ADR's in
`../afgevinkt-app/docs/adr/`.

- **Opname** — één vastgelegde schermopname met metadata; de kernentiteit.
- **Opname-project** — de lokale, non-destructieve map op de machine van het team-lid:
  `screen.webm`, optionele `webcam.webm`, `pointer.json` (cursor-/klik-timeline) en `project.json`.
  Opgeslagen onder Electron `userData/opnames/<timestamp>/`.
- **Capture-engine** — de uitwisselbare opname-laag (`CaptureEngine`). v1 =
  `MediaRecorderCaptureEngine`; later inplugbaar een native FFmpeg-engine (ADR 5).
- **Klik-/cursor-timeline** — `pointer.json`: globale cursorposities tijdens de opname
  (gepolld via `screen.getCursorScreenPoint()`). Voedt later auto-zoom. Echte klik-detectie
  is een follow-up (global input hook).
- **Team-lid** — ingelogde gebruiker (Afgevinkt!-teamaccount). Eigenaar van de opname.
