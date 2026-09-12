---
name: media-intake
description: Use when the owner shares a video, audio clip, screen recording or podcast link and asks for it to be used — before transcribing, before logging it, and before deciding where its substance goes.
---

# Media intake — transcribe locally, log the row, place the substance

Third-party footage is absorbed the same way any other shared resource is
(`docs/agent/RESOURCE_INTAKE.md`, "Rules for a new row"; DR-021): by use, the day
it arrives. The two differences are that it must be transcribed before it can be
read, and that neither the media nor the transcript may enter the tree.

## 1 — The publication boundary decides what may be committed

This repository is public. Owner-shared footage is somebody else's work and
carries no grant to republish, so:

- the media file stays OUT of the tree;
- the transcript stays OUT of the tree — it is a derivative of that footage;
- what may be committed is the intake row, and the SUBSTANCE re-expressed in this
  org's own words in the document it belongs to.

Keep both in the session scratchpad. `scripts/check-publication-boundary.mjs`
classifies every tracked path; the cheapest way to stay inside it is to track
neither file.

## 2 — Transcribe locally, on CPU, in a throwaway virtualenv

No cloud transcription service: uploading the owner's footage is sending data to
an external service, which CLAUDE.md makes an ask-first act. A local open-source
model is not.

```bash
python3 -m venv <scratchpad>/whisper-venv
<scratchpad>/whisper-venv/bin/pip install faster-whisper imageio-ffmpeg
<scratchpad>/whisper-venv/bin/python - <<'PY'
import imageio_ffmpeg, subprocess
from faster_whisper import WhisperModel
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-i", "<clip>", "-ac", "1",
                "-ar", "16000", "-y", "<scratchpad>/clip.wav"], check=True)
segments, info = WhisperModel("small", device="cpu", compute_type="int8").transcribe(
    "<scratchpad>/clip.wav")
for s in segments:
    print(f"[{s.start:7.2f}] {s.text.strip()}")
PY
```

`small` on CPU is the size that fits the runner; `imageio-ffmpeg` supplies the
ffmpeg binary so nothing has to be installed system-wide. Record the clip's
duration and the model used — a transcript with no provenance is an assertion.

## 3 — Log the row the day it arrives

One row in `docs/agent/RESOURCE_INTAKE.md`: what the clip was (duration, who is
speaking, in what capacity), the owner's directive in his own words, the
disposition, and the files it changed. Say in the row that the media and the
transcript were kept out of the tree, and why.

## 4 — Put the substance where it belongs, never in a memo

Each clip resolves to a document, not to a summary of the clip:

- **Buyer or market evidence** → a dated supporting paragraph in
  `docs/company/ICP_EVIDENCE.md`, under the finding it supports, with its
  LIMITATION stated first (one speaker, one company, not the target vertical).
  Quote the speaker's own vocabulary when it is better than ours.
- **A working practice** → an operating note in `docs/LANE_COORDINATION.md` or the
  relevant skill, written as what this lane does from now on.
- **Something to build** → a row in `docs/BUILD_BACKLOG.md`, phrased as the change
  and the check that would fail without it.

A clip that resolves to none of the three is logged and closed with that finding.

## Never

- Never commit the media or the transcript, and never paste a long transcript into
  a document.
- Never upload owner footage to a hosted transcription service.
- Never quote a clip as a claim about SignalGrid, and never let a speaker's
  enthusiasm become a capability sentence — the launch-claims gate and the launch
  profile govern what may be said to ship, whatever a video says.
- Never answer a shared clip with a memo of reasons; that is the posture DR-021
  replaced.
- Never attribute a private individual by name in a committed document.
