#!/usr/bin/env python3
"""Transcribe owner-shared video or audio LOCALLY — no key, no upload.

The vendored `/watch` skill (.claude/skills/watch) extracts frames without a key, but
its transcript path POSTs the audio to Groq or OpenAI under a paid key. This repository
does not send owner media to a third party by default (DR-040), so the transcript comes
from this script instead: ffmpeg (the imageio-ffmpeg wheel) turns the file into 16 kHz
mono, faster-whisper runs on the CPU, and the only network event is the one-time model
download on first use. The audio never leaves the machine.

Run it from a virtual environment OUTSIDE the repository — anything written inside the
tree flips `provenance.workingTreeClean` on every later sim result:

    python3 -m venv "$HOME/.cache/signalgrid-whisper"
    "$HOME/.cache/signalgrid-whisper/bin/pip" install faster-whisper imageio-ffmpeg
    "$HOME/.cache/signalgrid-whisper/bin/python" transcribe-local.py <video> --out <dir>

Output: `<dir>/<source-name>.txt`, one `[start-end] text` line per segment, with a header
naming the source, its duration, the detected language and its probability. Measured on
2026-09-12 (cloud lane, Linux, CPU int8, model `small`): a 70.61 s clip took 43.3 s of
cold model load plus 19.4 s of transcription and produced 35 segments.

Determinism: `beam_size=5`, VAD on, language pinned (default `en`). The output is a
transcript, i.e. model output — it is evidence to QUOTE in an intake row, never a
fixture, a decision input, or a doc figure.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile


def repo_root_of(path: str) -> str | None:
    """Walk up from `path` to the nearest directory holding a `.git` entry, if any."""
    cur = os.path.abspath(path)
    while True:
        if os.path.exists(os.path.join(cur, ".git")):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            return None
        cur = parent


def main() -> int:
    ap = argparse.ArgumentParser(description="Local, key-free transcription with faster-whisper.")
    ap.add_argument("sources", nargs="+", help="video or audio files (local paths only)")
    ap.add_argument("--out", default=None, help="directory for <name>.txt (default: beside the source)")
    ap.add_argument("--model", default="small", help="faster-whisper model size (default: small)")
    ap.add_argument("--language", default="en", help="language code to pin (default: en)")
    args = ap.parse_args()

    try:
        import imageio_ffmpeg  # type: ignore
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError as exc:  # fail closed, with the exact fix
        print(f"missing dependency: {exc}", file=sys.stderr)
        print(
            "install into a venv outside the repository:\n"
            '  python3 -m venv "$HOME/.cache/signalgrid-whisper"\n'
            '  "$HOME/.cache/signalgrid-whisper/bin/pip" install faster-whisper imageio-ffmpeg',
            file=sys.stderr,
        )
        return 2

    script_repo = repo_root_of(os.path.dirname(__file__))
    rc = 0
    model = None
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    for src in args.sources:
        if not os.path.isfile(src):
            print(f"missing: {src}", file=sys.stderr)
            rc = 1
            continue
        out_dir = os.path.abspath(args.out) if args.out else os.path.dirname(os.path.abspath(src))
        if script_repo and (out_dir == script_repo or out_dir.startswith(script_repo + os.sep)):
            print(
                f"refusing to write inside the repository ({script_repo}): a transcript in the tree is an "
                "untracked file, and untracked files flip provenance.workingTreeClean. Pass --out <dir> outside it.",
                file=sys.stderr,
            )
            return 3
        os.makedirs(out_dir, exist_ok=True)
        if model is None:
            model = WhisperModel(args.model, device="cpu", compute_type="int8")
        with tempfile.TemporaryDirectory(prefix="sg-transcribe-") as tmp:
            wav = os.path.join(tmp, "audio.wav")
            subprocess.run(
                [ffmpeg, "-y", "-loglevel", "error", "-i", src, "-ac", "1", "-ar", "16000", wav],
                check=True,
            )
            segments, info = model.transcribe(wav, language=args.language, vad_filter=True, beam_size=5)
            out_path = os.path.join(out_dir, os.path.basename(src) + ".txt")
            count = 0
            with open(out_path, "w", encoding="utf-8") as fh:
                fh.write(
                    f"# {os.path.basename(src)}  duration={info.duration:.0f}s  "
                    f"lang={info.language} p={info.language_probability:.2f}  model={args.model}\n"
                )
                for seg in segments:
                    fh.write(f"[{seg.start:7.1f}-{seg.end:7.1f}] {seg.text.strip()}\n")
                    count += 1
        print(f"wrote {out_path} duration={info.duration:.0f}s segments={count} lang={info.language}")
    return rc


if __name__ == "__main__":
    sys.exit(main())
