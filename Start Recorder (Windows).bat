@echo off
REM Afgevinkt Recorder — opname-app starten (Windows).
REM Dubbelklik dit bestand. Het opnamevenster opent zo vanzelf.
REM Stoppen: druk op Ctrl + C of sluit dit venster.

cd /d "%~dp0"

echo ================================================
echo   Afgevinkt Recorder - opname-app starten
echo   Stoppen: Ctrl + C of dit venster sluiten
echo ================================================
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo FOUT: Node.js / npm is niet gevonden.
  echo Installeer Node.js ^(https://nodejs.org^) en probeer opnieuw.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Eerste keer opstarten - onderdelen installeren ^(even geduld^)...
  call npm install || (echo Installeren mislukt. & pause & exit /b 1)
  echo.
)

echo LET OP: zorg dat de Afgevinkt!-site draait op http://localhost:3000
echo (Start Afgevinkt ^(Windows^).bat in de map afgevinkt-app), anders kun je
echo niet inloggen of uploaden.
echo.

echo Opnamevenster wordt geopend...
echo.

call npm run dev
