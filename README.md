# 🎯 PROJECT SNIPER

An AI video pipeline with three tools that share one UI. Pick a tool from the landing page,
or toggle between them in the top nav.

- **🎬 SEGMENTER (Part 1)** — rough-cut long footage into clips. Transcribe, let Claude
  identify segments, adjust boundaries, and export stream-copied MP4 clips (single or
  multicam) as a zip for downstream trimming.
- **✂️ CLIPPER (Part 2)** — refine a clip into a polished cut. Transcribe, let the LLM cut
  filler at the word level, fine-tune in the word editor, and export an FCPXML timeline for
  Final Cut Pro.
- **🔍 FRAME.IO REVIEW** — a standalone QC pass (not a pipeline stage). Scan an MP4 for
  on-screen text errors — typos, spelling, grammar, broken formatting — and review the
  flagged timestamps next to a video player.

The typical workflow: run a long recording through **SEGMENTER** to get clips, then run each
clip through **CLIPPER** to polish it. (For now you move files between the two manually — a
direct handoff is a future addition.)

## What each tool does

### SEGMENTER (`/segmenter`)
1. **Select** your MP4 (and optional B/C-cam + lav tracks) from your local filesystem
2. **Configure** how to segment — default coaching-show prompt or your own
3. **Transcribe + Segment** — Deepgram transcribes with word-level timestamps, then Claude identifies segment boundaries
4. **Edit** — adjust boundaries: split with ✂️, merge with ✕, rename by clicking the title
5. **Export** — stream-copy each kept segment to its own MP4 with ~5s pre/post-roll padding (cuts snap to keyframes; clips may overlap). Near-instant rough footage, delivered as a zip. Multicam export syncs B/C-cam + lav and re-encodes frame-accurately.

### CLIPPER (`/clipper`)
1. **Select** a clip (single-cam, or A+B pre-synced dual-cam)
2. **Transcribe** — Deepgram with word-level timestamps (stereo-channel isolation + diarization when applicable)
3. **Clip** — Claude marks filler/fluff to cut at the utterance level
4. **Edit** — fine-tune at the word level in the editor
5. **Export** — generate an FCPXML timeline for Final Cut Pro 10.6+

### FRAME.IO REVIEW (`/frameio-review`)
1. **Select** an MP4 from your local filesystem
2. **Configure** — selection mode, frames/sec, an optional max-representatives cap for a cheap test run, the dedup threshold, and the model (Sonnet for quality, Haiku for cheaper passes)
3. **Run** — ffmpeg extracts frames, then one **representative per on-screen state** is picked (see modes below) and sent to Claude's vision API to flag on-screen text errors. You're asked to confirm before any run over 200 API calls.
4. **Review** — flagged timestamps stream into a sortable list next to the player; click a flag to seek there, filter out low-confidence hits, and read the exact text seen + suggested fix. Consecutive same-text verdicts (fade-in variants, repeated slides) are collapsed into one finding using Claude's own transcription. A `results.json` and a standalone `report.html` (opens with no server running) are written next to your video.

**Selection modes** (how the one frame per on-screen state is chosen):
- **Visual** (default) — perceptual-hash groups near-identical frames and keeps the *settled* frame of each run (the modal pHash, not the first), so a half-rendered fade-in frame isn't mistaken for a typo. Works on any footage, including text composited over moving video.
- **OCR text** — groups frames by tesseract text (rapidfuzz). Only suitable for clean, static slideware; on stylized text over moving video, OCR is too noisy to group reliably.

> ⚠️ Unlike SEGMENTER/CLIPPER (which only send audio + transcript text off the machine), FRAME.IO REVIEW sends **still frame images** to the Anthropic vision API — that's how it reads on-screen text. The full video is never uploaded. (Tesseract, in OCR mode, runs locally and is never sent anywhere — it only chooses which frames to send.)

The Python pipeline is also runnable on its own:
```bash
# full visual pass
.venv/bin/python3 -m scripts.frameio.review --input clip.mp4
# cheap test: cap representatives sent to Claude
.venv/bin/python3 -m scripts.frameio.review --input clip.mp4 --max-reps 15
# inspect the representatives for free (no Claude call), e.g. OCR mode
.venv/bin/python3 -m scripts.frameio.review --input clip.mp4 --mode ocr --fuzz 90 --select-only
```

> For project architecture, conventions, and invariants, see [`CLAUDE.md`](./CLAUDE.md) (auto-loaded by Claude Code).

## Requirements

- Node.js 18+
- Python 3.9+
- ffmpeg (+ ffprobe, included with ffmpeg)
- tesseract — only for FRAME.IO REVIEW's optional `--mode ocr`; the default visual mode does not need it
- macOS — file selection uses a native macOS picker (`osascript`); the app won't be able to pick files on other platforms yet

## Setup

### 1. Install dependencies

```bash
npm install
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

The Next.js API routes auto-detect `.venv/bin/python3` and fall back to system `python3` if no venv is present.

### 2. Install ffmpeg

```bash
# macOS
brew install ffmpeg
brew install tesseract        # only needed for FRAME.IO REVIEW --mode ocr

# Ubuntu/Debian
sudo apt install ffmpeg
sudo apt install tesseract-ocr # only needed for FRAME.IO REVIEW --mode ocr
```

### 3. Configure environment

Copy `.env.local` and fill in your API keys:

| Key | Where to get it |
|-----|----------------|
| `DEEPGRAM_API_KEY` | [console.deepgram.com](https://console.deepgram.com) |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |

### 4. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and pick SEGMENTER or CLIPPER.

---

## Notes

- Video files are read directly from your local filesystem — nothing is uploaded to external storage
- API calls go to Deepgram (transcription) and Anthropic (segmentation / editing)
