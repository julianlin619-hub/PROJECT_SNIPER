# CLAUDE.md — PROJECT SNIPER

Next.js 16 + Python video pipeline bundling two tools that share one shell:

- **SEGMENTER** (Part 1, `/segmenter`) — long MP4 → Deepgram transcript → Claude picks
  segments → ffmpeg **stream-copies** rough clips (single or multicam) → zip for NLE trimming.
- **CLIPPER** (Part 2, `/clipper`) — a clip → Deepgram transcript → Claude cuts filler at the
  word level → word-level editor → **FCPXML** timeline export for Final Cut Pro.

The two are independent flows for now (no automated SEGMENTER→CLIPPER handoff yet). The
landing page `/` picks a tool; `(tools)/layout.tsx` adds a shared toggle nav across both.

See @README.md for user-facing setup. This file is for things Claude can't infer by reading the code.

## Layout

- Route group `src/app/(tools)/` holds both tool pages: `segmenter/page.tsx`,
  `clipper/page.tsx` (+ `clipper/actions/validate-assembly.ts` server action). URLs stay
  `/segmenter` and `/clipper` (route groups don't affect the path).
- API is namespaced: `src/app/api/segmenter/*` (`segment`, `transcribe`, `export-mp4`,
  `multicam-export`, `multicam-download/[id]`, `pick-file`) and `src/app/api/clipper/*`
  (`clip-preview`, `transcribe`, `native-pick`, `video`). Shared helpers live in
  `src/app/api/_lib/` (`spawn-python.ts`, `multicam-store.ts`).
  - `pick-file` / `native-pick` open a **macOS-only** `osascript` file dialog and return an
    absolute local path (no upload). `api/clipper/video` streams that local file to the
    browser editor with HTTP range support — still local, nothing is uploaded.
- Components: `src/components/segmenter/*`, `src/components/clipper/*`, shared shadcn
  primitives in `src/components/ui/`, shared `src/components/shared/nav.tsx`.
- Libs/prompts: SEGMENTER uses `src/lib/types.ts` + `src/prompts/segment-system.ts`. CLIPPER
  is self-contained under `src/lib/clipper/*` (incl. `editor/`) + `src/prompts/clipper/*`.
  CLIPPER's `types.ts` is kept separate (its `WordTiming` carries an extra `speaker` field).

## Build, lint, run

```bash
npm install
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt   # deepgram-sdk, numpy, scipy

npm run dev      # Next 16 + Turbopack, http://localhost:3000
npm run build
npm run lint     # ESLint via next config — there is no test suite
```

`ffmpeg` and `ffprobe` must be on PATH. The Next API routes auto-detect `.venv/bin/python3` via `src/app/api/_lib/spawn-python.ts` and fall back to system `python3`.

## Environment (`.env.local`)

- `ANTHROPIC_API_KEY` — required (SEGMENTER `api/segmenter/segment/route.ts`; CLIPPER `api/clipper/clip-preview/route.ts`)
- `DEEPGRAM_API_KEY` — required (`scripts/transcribe.py`, `scripts/clipper_transcribe.py`)
- `ANTHROPIC_MODEL` — optional override; default `claude-sonnet-4-6`. **SEGMENTER only** (`api/segmenter/segment/route.ts`); CLIPPER's `clip-preview` and `validate-assembly` are pinned to `claude-sonnet-4-6` in code (see Invariants), not env-overridable.
- `CLIPPER_DUMP_FIXTURE=1` — optional dev flag; dumps `clip-preview`'s LLM tool-call JSON to a fixture for prompt iteration.

## Invariants — DO NOT "fix" these

- **Model pin.** The `claude-sonnet-4-6` default in SEGMENTER's `api/segmenter/segment/route.ts` AND CLIPPER's `api/clipper/clip-preview/route.ts` (and the `validate-assembly` action) is intentional. YOU MUST NOT bump the default model in code without an explicit request.
- **SEGMENTER export is stream-copy, not re-encode** (`scripts/export_mp4.py`). `-ss` BEFORE `-i` is input-side fast seek; clips snap to the nearest keyframe at-or-before the padded start, so adjacent clips may overlap. This is intentional — output is rough footage for NLE trimming. YOU MUST NOT switch to re-encode, move `-ss` after `-i`, or "tighten" boundaries to make cuts exact. (Scope: ONLY `scripts/export_mp4.py`.) `scripts/multicam_pipeline.py` intentionally re-encodes with libx264 CRF 18, and **CLIPPER's FCPXML path is frame-accurate by design** — both require frame accuracy, so don't "optimize" them to stream-copy.
- **Two transcribe workers.** `scripts/transcribe.py` (SEGMENTER) and `scripts/clipper_transcribe.py` (CLIPPER) are distinct; CLIPPER's adds stereo-channel isolation + diarization. Don't merge them.
- **Temp files are owned by their producer.** CLIPPER's audio temps — `/tmp/clipper-audio-*.mp3` (mono extract), `/tmp/clipper-chunks-*/` (10-min chunks), `/tmp/clipper-ch{1,2}-*.mp3` (isolated stereo channels) — are all cleaned by `clipper_transcribe.py`'s `finally` blocks. SEGMENTER's multicam export zip is held in `multicam-store.ts` (1-hour TTL) and deleted by `multicam-download/[id]` after it's sent. CLIPPER export writes **no** server temp — the FCPXML and example `.txt` are built and downloaded client-side. Do not add manual cleanup elsewhere or move it.
- **Only audio + transcript text leaves the machine.** Video bytes are read locally (CLIPPER's editor plays the source via `api/clipper/video`, which streams the local file to the browser — still local). Mono audio (or 10-min chunks / isolated channels) goes to Deepgram; transcript text goes to Anthropic. IMPORTANT: do not route raw video to any third party or cloud storage.
- **No on-disk app state between steps.** Transcript, segments, and edit state live in React state in the tool pages. Do not add a DB, file cache, or localStorage unless explicitly asked.
- **Python launcher reuse.** API routes that shell to Python MUST import `spawnPython` / `pythonInterpreter` / `SCRIPTS_DIR` from `src/app/api/_lib/spawn-python.ts`. Do not hardcode interpreter paths.

## Code style

- TypeScript strict. SEGMENTER shapes (`TranscriptEntry`, `SegmentGroup`, `WordTiming`) live in `src/lib/types.ts`; CLIPPER shapes (`LineDecision`, `EditableWord`, `Source`, `SpeakerMap`, `AppStep`, …) live in `src/lib/clipper/types.ts`. Update the relevant one first when changing a transcript/segment shape.
- SEGMENTER segmentation prompt: `src/prompts/segment-system.ts` (route user-message structure in `api/segmenter/segment/route.ts`). CLIPPER edit prompt: `src/prompts/clipper/default-edit.ts`.
- UI: Tailwind v4 + shadcn/ui primitives in `src/components/ui/` (`badge`, `button`, `card`, `dialog`, `input`, `progress`, `scroll-area`, `separator`, `tabs`, `textarea`). Add others via `npx shadcn add <name>` rather than hand-writing. `lucide-react` is available for icons.

## Verification

There is no test suite. After non-trivial changes, run `npm run dev` and walk the relevant flow against a short MP4: SEGMENTER (Transcribe → Edit Segments → Export zip) and/or CLIPPER (Transcribe → Clip → Edit → Export FCPXML). `npm run build` + `npm run lint` must pass clean (the build is the surest check that import/fetch paths across the two namespaces still resolve). If a change can't be verified that way (e.g. server-only refactor), say so explicitly instead of claiming success.
