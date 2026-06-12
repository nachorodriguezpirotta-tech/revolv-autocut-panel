#!/usr/bin/env python3
"""
Revolv AutoCut — detector de silencios por PALABRAS (no por dB).

Pipeline:
  1. Extrae el audio del video con ffmpeg (WAV 16kHz mono)
  2. Transcribe con faster-whisper (word-level timestamps)
  3. Silencio = hueco entre el final de una palabra y el inicio de la
     siguiente. Esto es lo que un umbral de dB no puede hacer: una "s"
     que decae, ruido de fondo o una respiración no lo engañan.
  4. A cada silencio le recorta `padding` segundos de cada lado
     (default 0.2s) para nunca comerse el ataque/cola de una palabra.

Salida (stdout): JSON {"gaps":[{"start","end"}], ...} en segundos del
ARCHIVO fuente. El panel los convierte a tiempo de timeline.
Progreso (stderr): líneas "PROGRESS:<pct>:<mensaje>".
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile


def progress(pct, msg):
    print(f"PROGRESS:{pct}:{msg}", file=sys.stderr, flush=True)


def find_ffmpeg():
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        shutil.which("ffmpeg"),
        # El instalador de Windows deja ffmpeg.exe junto a este script
        os.path.join(here, "ffmpeg.exe"),
        os.path.join(here, "ffmpeg"),
        os.path.expanduser("~/bin/ffmpeg"),
        os.path.expanduser("~/bin/ffmpeg.exe"),
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return None


def extract_audio(ffmpeg, video_path, wav_path):
    cmd = [
        ffmpeg, "-y",
        "-i", video_path,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        "-threads", "0",
        wav_path,
    ]
    subprocess.run(cmd, capture_output=True, check=True, timeout=1800)


def transcribe(wav_path, language, model_size):
    from faster_whisper import WhisperModel

    model = WhisperModel(
        model_size,
        device="cpu",
        compute_type="int8",
        cpu_threads=os.cpu_count() or 2,
    )
    progress(30, "Escuchando palabras…")

    segments_iter, info = model.transcribe(
        wav_path,
        language=language,
        word_timestamps=True,
        beam_size=1,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=400),
    )

    words = []
    total = info.duration or 1
    for segment in segments_iter:
        if segment.words:
            for w in segment.words:
                words.append({"start": round(w.start, 3), "end": round(w.end, 3)})
        pct = 30 + min(60, int(60 * segment.end / total))
        progress(pct, f"Transcribiendo… {int(segment.end)}s / {int(total)}s")

    return words, info.duration


def detect_gaps(words, duration, min_silence, pad_out, pad_in, word_tail=0.12):
    """Huecos entre palabras, con padding ASIMÉTRICO:
      pad_out — aire que se deja después de la última palabra (cierre
                natural de la frase, default 0.2s)
      pad_in  — aire antes de la próxima palabra (default 0.05s: jump
                cut al toque, sin espacio muerto antes de hablar)
    word_tail compensa que Whisper suele subestimar el final de
    fricativas ('s', 'f') — sin esto, a veces corta media consonante."""
    if not words:
        return []

    gaps = []

    # Silencio antes de la primera palabra
    first = words[0]["start"]
    if first - pad_in >= min_silence:
        gaps.append({"start": 0.0, "end": round(first - pad_in, 3)})

    # Huecos entre palabras consecutivas
    for i in range(len(words) - 1):
        speech_end = words[i]["end"] + word_tail
        speech_next = words[i + 1]["start"]
        gap_start = speech_end + pad_out
        gap_end = speech_next - pad_in
        if gap_end - gap_start >= min_silence:
            gaps.append({"start": round(gap_start, 3), "end": round(gap_end, 3)})

    # Silencio después de la última palabra
    last = words[-1]["end"] + word_tail
    if duration and duration - (last + pad_out) >= min_silence:
        gaps.append({"start": round(last + pad_out, 3), "end": round(duration, 3)})

    return gaps


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video", help="Path del archivo de video/audio fuente")
    ap.add_argument("--min-silence", type=float, default=0.7,
                    help="Duración mínima del silencio a cortar (post-padding), en segundos")
    ap.add_argument("--padding-out", type=float, default=0.2,
                    help="Aire después de la última palabra antes del corte")
    ap.add_argument("--padding-in", type=float, default=0.05,
                    help="Aire antes de que arranque la próxima palabra")
    ap.add_argument("--language", default="es")
    ap.add_argument("--model", default="base",
                    help="Modelo whisper: tiny/base/small (más grande = más preciso y lento)")
    args = ap.parse_args()

    if not os.path.exists(args.video):
        print(json.dumps({"error": f"No existe el archivo: {args.video}"}))
        sys.exit(1)

    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        print(json.dumps({"error": "No encontré ffmpeg. Instalalo o ponelo en ~/bin/ffmpeg"}))
        sys.exit(1)

    progress(5, "Extrayendo audio…")
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "audio.wav")
        try:
            extract_audio(ffmpeg, args.video, wav)
        except subprocess.CalledProcessError as e:
            print(json.dumps({"error": "ffmpeg falló extrayendo el audio"}))
            sys.exit(1)

        progress(20, "Cargando modelo de voz…")
        try:
            words, duration = transcribe(wav, args.language, args.model)
        except Exception as e:
            print(json.dumps({"error": f"Whisper falló: {e}"}))
            sys.exit(1)

    progress(92, "Calculando cortes…")
    gaps = detect_gaps(words, duration, args.min_silence, args.padding_out, args.padding_in)
    total_cut = round(sum(g["end"] - g["start"] for g in gaps), 1)

    progress(100, "Listo")
    print(json.dumps({
        "gaps": gaps,
        "words": len(words),
        "duration": round(duration or 0, 2),
        "total_silence": total_cut,
    }))


if __name__ == "__main__":
    main()
