# 🎬 SEGMENTER

AI-powered video segmentation tool. Upload an MP4, transcribe the mono audio, let Claude identify segments, then adjust boundaries manually.

## What it does

1. **Select** your final MP4 from your local filesystem
2. **Configure** how to segment — use the default coaching-show prompt or write your own
3. **Transcribe + Segment** — Deepgram transcribes with word-level timestamps, then Claude identifies segment boundaries
4. **Edit** — adjust segment boundaries in the transcript: split with ✂️, merge with ✕, rename by clicking the title
5. **Export** — stream-copy each kept segment to its own MP4 with ~5s of pre/post-roll padding (cuts snap to keyframes; clips may overlap). Near-instant; intended as rough footage for downstream NLE trimming. Delivered as a zip. Filler segments are excluded by default (toggle via checkbox).

> For project architecture, conventions, and invariants, see [`CLAUDE.md`](./CLAUDE.md) (auto-loaded by Claude Code).

## Requirements

- Node.js 18+
- Python 3.9+
- ffmpeg

## Setup

### 1. Install dependencies

```bash
npm install
python3 -m venv .venv
.venv/bin/pip install 'deepgram-sdk>=6.0.0'
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

Open [http://localhost:3000](http://localhost:3000).

---

## Notes

- Video files are read directly from your local filesystem — nothing is uploaded to external storage
- API calls go to Deepgram (transcription) and Anthropic (segmentation)
