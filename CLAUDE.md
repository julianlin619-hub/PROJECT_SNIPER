# CLAUDE.md — SEGMENTER-X

Next.js 16 + Python video segmentation tool. MP4 → Deepgram transcript → Claude picks segments → ffmpeg stream-copies clips → zip.

See @README.md for user-facing setup. This file is for things Claude can't infer by reading the code.

## Build, lint, run

```bash
npm install
python3 -m venv .venv
.venv/bin/pip install 'deepgram-sdk>=6.0.0'   # used by scripts/transcribe.py
.venv/bin/pip install numpy scipy             # used only by scripts/multicam_pipeline.py

npm run dev      # Next 16 + Turbopack, http://localhost:3000
npm run build
npm run lint     # ESLint via next config — there is no test suite
```

`ffmpeg` and `ffprobe` must be on PATH. The Next API routes auto-detect `.venv/bin/python3` via `src/app/api/_lib/spawn-python.ts` and fall back to system `python3`.

## Environment (`.env.local`)

- `ANTHROPIC_API_KEY` — required (`src/app/api/segment/route.ts`)
- `DEEPGRAM_API_KEY` — required (`scripts/transcribe.py`)
- `ANTHROPIC_MODEL` — optional override; default `claude-sonnet-4-6` (`src/app/api/segment/route.ts:9`)

## Invariants — DO NOT "fix" these

- **Model pin.** The `claude-sonnet-4-6` default at `src/app/api/segment/route.ts:9` is intentional. YOU MUST NOT bump the default model in code without an explicit request.
- **ffmpeg export is stream-copy, not re-encode** (`scripts/export_mp4.py`). `-ss` BEFORE `-i` is input-side fast seek; clips snap to the nearest keyframe at-or-before the padded start, so adjacent clips may overlap. This is intentional — output is rough footage for NLE trimming. YOU MUST NOT switch to re-encode, move `-ss` after `-i`, or "tighten" boundaries to make cuts exact. (Scope: this invariant applies ONLY to `scripts/export_mp4.py`. `scripts/multicam_pipeline.py` intentionally re-encodes with libx264 CRF 18 because frame accuracy is required for multicam editing.)
- **Temp files are owned by their producer.** `/tmp/clipper-audio-*.mp3`, `/tmp/clipper-chunks-*/`, and `<tmpdir>/clipper-export-*.zip` are cleaned by `scripts/transcribe.py`, the export route, and `TemporaryDirectory()` respectively. Do not add manual cleanup elsewhere or move it.
- **Only audio + transcript text leaves the machine.** Video bytes are read locally. Mono audio (or 10-min chunks) goes to Deepgram; transcript text goes to Anthropic. IMPORTANT: do not route raw video to any third party or cloud storage.
- **No on-disk app state between steps.** Transcript and segments live in React state in `src/app/page.tsx`. Do not add a DB, file cache, or localStorage unless explicitly asked.
- **Python launcher reuse.** API routes that shell to Python MUST import `spawnPython` / `pythonInterpreter` from `src/app/api/_lib/spawn-python.ts`. Do not hardcode interpreter paths.

## Code style

- TypeScript strict. Shared shapes (`TranscriptEntry`, `SegmentGroup`, `WordTiming`) live in `src/lib/types.ts` — update there first when changing transcript/segment shape; routes and components import from it.
- Segmentation system prompt: `src/prompts/segment-system.ts`. Route-side user-message structure (numbered `[LINE i]` + per-word timestamps): `src/app/api/segment/route.ts`.
- UI: Tailwind v4 + shadcn/ui primitives in `src/components/ui/`. Only `badge`, `button`, `progress`, `scroll-area`, `textarea` are wired up — add others via `npx shadcn add <name>` rather than hand-writing.

## Verification

There is no test suite. After non-trivial changes, run `npm run dev` and walk the 3-step UI flow (Transcribe → Edit Segments → Export) against a short MP4. If a change can't be verified that way (e.g. server-only refactor), say so explicitly instead of claiming success.
