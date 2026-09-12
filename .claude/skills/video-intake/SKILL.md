---
name: video-intake
description: Turn a video the owner shares (a phone clip, a talk, a screen recording) into evidence this repository can use — frames through the vendored /watch skill, a transcript produced locally with faster-whisper (no key, no upload), and an intake row. Use whenever the owner shares footage, pastes a video link, or asks to watch or transcribe a video. The footage itself never enters the tree.
---

# SignalGrid — Video intake

The owner shares videos and expects them absorbed the way every other resource is
(`docs/agent/RESOURCE_INTAKE.md`, rule 1: log it the day it arrives, evaluate it by
use). Two videos on 2026-09-12 produced DR-037 and three intake rows. This skill is
the repeatable form of what that took, built on two parts:

- **`/watch`** — `bradautomates/claude-video`, vendored unmodified at a pin under
  `.claude/skills/watch/` (DR-038). It extracts frames with `ffmpeg`, scene-aware,
  and hands them to `Read`. Its own transcript path is an UPLOAD: the only two
  endpoints in its code are Groq's and OpenAI's `/audio/transcriptions`, under a paid
  key. Owner media does not go to a third party by default, so that path stays off.
- **`scripts/transcribe-local.py`** in this directory — first-party, key-free:
  `ffmpeg` to 16 kHz mono, `faster-whisper` on the CPU, output beside the source.
  Measured 2026-09-12 against a 70.61 s owner clip: 43.3 s cold model load, 19.4 s of
  transcription, 1,806 characters in 35 timestamped segments. The same file through
  `/watch` without a key gave 58 frames and `Transcript: none available` — that is the
  division of labour, not a defect.

## Rules that bind this skill

1. **Footage stays outside the tree.** Third-party and owner footage is never
   committed, never re-hosted; `.claude/skills/watch/SKILL.md` writes its working
   directory under the system temp dir by default, and `transcribe-local.py` refuses
   to write inside the repository. An untracked file in the tree flips
   `provenance.workingTreeClean` on every later sim result (CLAUDE.md, "Simulation
   results — provenance is the product").
2. **No key by default.** A Whisper key in `~/.config/watch/.env` turns `/watch`'s
   transcript into an upload of the audio. That is the owner's decision to make per
   DR-038, never a session's; keys live outside the tree in any case (DR-029).
3. **A transcript is model output.** Quote it in an intake row or an evidence entry;
   never make it a fixture, a decision input, or a documented figure.
4. **Say what you did not watch.** A frame budget is a sample. State the detail
   level and the frame count with every answer.

## Procedure

**Step 1 — frames.** Follow `.claude/skills/watch/SKILL.md` with `SKILL_DIR` set to
that directory (the absolute path of `.claude/skills/watch` in this checkout). The
skill needs `ffmpeg` and `ffprobe` on `PATH` (`yt-dlp` too, only for URLs). On a Mac,
Homebrew provides them; on the cloud box neither is installed and none of the three
may be installed system-wide — put a pinned static build on `PATH` under the session
scratchpad instead (2026-09-12: `ffmpeg-release-amd64-static.tar.xz`, sha256
`abda8d77ce8309141f83ab8edf0596834087c52467f6badf376a6a2a4c87cf67`, reporting
`ffmpeg version 7.0.2-static`). Then:

```bash
python3 "${SKILL_DIR}/scripts/watch.py" "<video path>" --detail balanced --out-dir "<scratch dir>"
```

Keyless, the report ends with `Transcript: none available` and a hint to run its
installer for the Whisper fallback. Do not follow that hint (rule 2). Read every frame
the report lists with the `Read` tool.

**Step 2 — transcript, locally.** Once per machine, create a virtual environment
OUTSIDE the repository and install the two wheels; the first run downloads the model
(one network fetch of a model file, nothing of the owner's leaves the machine):

```bash
python3 -m venv "$HOME/.cache/signalgrid-whisper"
"$HOME/.cache/signalgrid-whisper/bin/pip" install faster-whisper imageio-ffmpeg
"$HOME/.cache/signalgrid-whisper/bin/python" .claude/skills/video-intake/scripts/transcribe-local.py "<video path>" --out "<scratch dir>"
```

The script prints `wrote <path> duration=… segments=… lang=…`; the file holds one
`[start-end] text` line per segment. Read it in full.

**Step 3 — answer and absorb.** Answer the owner's question from both streams,
naming timestamps. Then absorb by use: a row in `docs/agent/RESOURCE_INTAKE.md`
(what the video is, who shared it, what it changed, with the passages that changed it
quoted), an entry in `docs/agent/EVIDENCE.md` when a claim rests on it, and the
change itself — a decision record, a doc, a backlog item, a gate — in the same PR.
A row that says "watched, nothing changed" is allowed only when that is true and the
reason is stated.

**Step 4 — leave nothing behind.** The `/watch` working directory and the transcript
live under the scratchpad or the temp dir; the harness reclaims them. Do not delete
with a recursive remove — the deny list refuses it, and nothing here needs it.

## What this skill does not do

- It does not download from video platforms on its own initiative. A URL the owner
  pastes goes through `/watch`'s `yt-dlp` path; a local file is preferred.
- It does not run on the Mac tick. Transcription is a session activity; the venv path
  above is per machine and is created by hand once.
- It does not make the transcript authoritative. Where the video contradicts a doc,
  the doc changes only after the claim is checked the ordinary way.
