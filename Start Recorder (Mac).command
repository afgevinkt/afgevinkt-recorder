#!/bin/bash
# Afgevinkt Recorder — opname-app starten (macOS).
# Dubbelklik dit bestand in Finder. Het opnamevenster opent zo vanzelf.
# Stoppen: druk op Ctrl + C of sluit dit venster.

# Ga naar de map waar dit bestand staat (de projectmap).
cd "$(dirname "$0")" || exit 1

echo "================================================"
echo "  Afgevinkt Recorder — opname-app starten"
echo "  Stoppen: Ctrl + C of dit venster sluiten"
echo "================================================"
echo

# Node aanwezig?
if ! command -v npm >/dev/null 2>&1; then
  echo "FOUT: Node.js / npm is niet gevonden."
  echo "Installeer Node.js (https://nodejs.org) en probeer opnieuw."
  echo
  read -n 1 -s -r -p "Druk op een toets om te sluiten..."
  exit 1
fi

# Eerste keer: dependencies installeren (kan een paar minuten duren).
if [ ! -d "node_modules" ]; then
  echo "Eerste keer opstarten — onderdelen installeren (even geduld)..."
  npm install || { echo "Installeren mislukt."; read -n 1 -s -r -p "Druk op een toets om te sluiten..."; exit 1; }
  echo
fi

# Waarschuw als de site (afgevinkt-app) nog niet draait op poort 3000.
# Inloggen en uploaden werkt pas als die server aan staat.
if ! lsof -ti tcp:3000 >/dev/null 2>&1; then
  echo "LET OP: de Afgevinkt!-site lijkt nog niet te draaien op http://localhost:3000."
  echo "Start eerst 'Start Afgevinkt (Mac).command' in de map afgevinkt-app,"
  echo "anders kun je niet inloggen of uploaden."
  echo
fi

echo "Opnamevenster wordt geopend..."
echo

# Start de Electron-app (blijft draaien tot je stopt).
npm run dev
