@echo off
REM Instalador del panel "Revolv AutoCut" para Premiere Pro (Windows).
REM Doble click y listo. Despues reinicia Premiere.

setlocal enabledelayedexpansion
set DEST=%APPDATA%\Adobe\CEP\extensions\com.revolv.autocut

echo Instalando Revolv AutoCut...

REM ── 1. Copiar el panel ──────────────────────────────────────────
if exist "%DEST%" rmdir /S /Q "%DEST%"
mkdir "%DEST%"
xcopy /E /I /Y "%~dp0CSXS" "%DEST%\CSXS" >nul
xcopy /E /I /Y "%~dp0js" "%DEST%\js" >nul
xcopy /E /I /Y "%~dp0jsx" "%DEST%\jsx" >nul
xcopy /E /I /Y "%~dp0helper" "%DEST%\helper" >nul
copy /Y "%~dp0index.html" "%DEST%\" >nul

REM ── 2. Habilitar paneles sin firma (modo developer) ─────────────
for %%v in (9 10 11 12) do (
  reg add HKCU\SOFTWARE\Adobe\CSXS.%%v /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
)

REM ── 3. Python ───────────────────────────────────────────────────
set PYCMD=
py -3 -c "exit()" >nul 2>nul && set PYCMD=py -3
if not defined PYCMD python -c "exit()" >nul 2>nul && set PYCMD=python

if not defined PYCMD (
  echo.
  echo [!] No encontre Python. Intentando instalarlo con winget...
  winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
  echo.
  echo Si winget no funciono: instala Python desde python.org
  echo IMPORTANTE: marca la casilla "Add Python to PATH" al instalarlo.
  echo Despues volve a correr este instalador.
  echo.
  pause
  exit /b 1
)

REM ── 4. faster-whisper (deteccion de palabras) ───────────────────
%PYCMD% -c "import faster_whisper" >nul 2>nul
if errorlevel 1 (
  echo Instalando faster-whisper - una sola vez, puede tardar unos minutos...
  %PYCMD% -m pip install --user faster-whisper
)

REM ── 5. ffmpeg ───────────────────────────────────────────────────
where ffmpeg >nul 2>nul
if %errorlevel%==0 goto ffmpeg_ok
if exist "%DEST%\helper\ffmpeg.exe" goto ffmpeg_ok

echo Descargando ffmpeg - una sola vez, ~80MB...
curl -L -o "%TEMP%\ffmpeg-rv.zip" "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip"
if errorlevel 1 (
  echo [!] No pude bajar ffmpeg. Bajalo de gyan.dev/ffmpeg y copia ffmpeg.exe a:
  echo     %DEST%\helper\
  goto ffmpeg_done
)
tar -xf "%TEMP%\ffmpeg-rv.zip" -C "%TEMP%"
copy /Y "%TEMP%\ffmpeg-master-latest-win64-gpl\bin\ffmpeg.exe" "%DEST%\helper\ffmpeg.exe" >nul
del "%TEMP%\ffmpeg-rv.zip" >nul 2>nul
rmdir /S /Q "%TEMP%\ffmpeg-master-latest-win64-gpl" >nul 2>nul
if exist "%DEST%\helper\ffmpeg.exe" (
  echo ffmpeg instalado OK
) else (
  echo [!] Algo fallo con ffmpeg. Bajalo de gyan.dev/ffmpeg y copia ffmpeg.exe a:
  echo     %DEST%\helper\
)
:ffmpeg_ok
:ffmpeg_done

echo.
echo ============================================
echo  Listo.
echo  1. Cerra y volve a abrir Premiere Pro
echo  2. Window (Ventana) - Extensions - Revolv AutoCut
echo ============================================
echo.
pause
