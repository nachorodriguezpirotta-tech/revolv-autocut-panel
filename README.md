# ✂️ Revolv AutoCut — Panel de Premiere Pro

Corta automáticamente las pausas de un clip de talking-head, directo en el
timeline de Premiere. El video queda pegado, sin silencios, listo para
retocar a mano si hace falta.

## Por qué es mejor que los autocut comunes

Los autocut típicos detectan silencio por **volumen** (umbral de dB): cuando
el audio baja de cierto nivel, asumen que no hay habla. Eso falla con ruido
de fondo, respiraciones, una "s" que decae lento, aire acondicionado, etc.

Este panel transcribe el audio con **faster-whisper** (timestamps por
palabra) y define silencio como **el hueco entre una palabra y la
siguiente**. Si no hay palabras, es pausa — sin importar el volumen.

## Cómo se usa

1. Tirá el crudo al timeline.
2. Click sobre el clip para seleccionarlo.
3. Abrí el panel: `Window → Extensions → Revolv AutoCut` y apretá **AutoCut**.
4. Esperá (un video de 10 min tarda ~1-2 min en analizarse).
5. El clip queda cortado con 0.2s de aire en cada corte.

Si un corte quedó mal: **Cmd+Z** deshace los cortes uno por uno.

**Importante:** corré el AutoCut *antes* de meter música u otros tracks —
el corte ripplea todos los tracks de la secuencia para mantener el sync.

## Instalación

**Windows:** doble click en `instalar-windows.bat`, reiniciar Premiere.
**Mac:** click derecho → Abrir sobre `instalar-mac.command`, reiniciar Premiere.

El instalador resuelve solo las dependencias si faltan: Python (en Windows
lo instala con winget si no está), `faster-whisper` y `ffmpeg` (en Windows
descarga `ffmpeg.exe` dentro de la propia extensión).

La primera vez que se usa el botón, whisper descarga su modelo (~150MB,
una sola vez) — esa primera corrida tarda un poco más.

## Ajustes

| Ajuste | Default | Qué hace |
|---|---|---|
| Pausa mínima | 0.7s | Pausas más cortas se dejan como están |
| Aire en cada corte | 0.2s | Margen antes/después de cada palabra |
| Precisión | base | tiny = más rápido, small = más preciso |

## Actualizaciones

El panel se actualiza solo: al abrirse chequea `version.json` en el repo
de GitHub (`nachorodriguezpirotta-tech/revolv-autocut-panel`). Si hay
versión nueva, se descarga y sobreescribe — el editor solo ve un aviso
de "reiniciá Premiere". No hay que mandar zips de nuevo.

**Para publicar una actualización** (esto lo hace Claude):
1. Editar los archivos en `~/Documents/Claude/revolv-autocut-panel/`
2. Subir la versión en DOS lugares: `VERSION` en `js/main.js` y `version.json`
3. `git commit` + `git push`

## Arquitectura

```
index.html + js/main.js   Panel CEP (UI, orquesta todo)
jsx/host.jsx              ExtendScript: lee el clip seleccionado y hace
                          los cortes (setInPoint/setOutPoint + qe.extract,
                          de atrás hacia adelante)
helper/detect_silences.py ffmpeg extrae audio → faster-whisper transcribe
                          → gaps entre palabras → JSON
```

El panel corre el helper con el Node integrado de CEP (`--enable-nodejs`
en el manifest). Los gaps vienen en segundos del archivo fuente y el panel
los convierte a tiempo de timeline usando `start`/`inPoint` del clip
(funciona aunque el clip ya esté recortado o no empiece en 0).
