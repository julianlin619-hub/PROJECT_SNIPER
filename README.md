# 🎯 PROJECT SNIPER

An AI video pipeline with two tools that share one UI. Pick a tool from the landing page,
or toggle between them in the top nav.

- **🎬 SEGMENTER (Part 1)** — rough-cut long footage into clips. Transcribe, let Claude
  identify segments, adjust boundaries, and export stream-copied MP4 clips (single or
  multicam) as a zip for downstream trimming.
- **✂️ CLIPPER (Part 2)** — refine a clip into a polished cut. Transcribe, let the LLM cut
  filler at the word level, fine-tune in the word editor, and export an FCPXML timeline for
  Final Cut Pro.

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

> For project architecture, conventions, and invariants, see [`CLAUDE.md`](./CLAUDE.md) (auto-loaded by Claude Code).

## Requirements

- Node.js 18+
- Python 3.9+
- ffmpeg (+ ffprobe, included with ffmpeg)
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

# Ubuntu/Debian
sudo apt install ffmpeg
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
