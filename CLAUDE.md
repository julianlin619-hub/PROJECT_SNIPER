# CLAUDE.md — PROJECT SNIPER

Next.js 16 + Python video pipeline bundling three tools that share one shell:

- **SEGMENTER** (Part 1, `/segmenter`) — long MP4 → Deepgram transcript → Claude picks
  segments → ffmpeg **stream-copies** rough clips (single or multicam) → zip for NLE trimming.
- **CLIPPER** (Part 2, `/clipper`) — a clip → Deepgram transcript → Claude cuts filler at the
  word level → word-level editor → **FCPXML** timeline export for Final Cut Pro.
- **FRAME.IO REVIEW** (auxiliary QC, `/frameio-review`) — an MP4 → ffmpeg extracts 1 frame/sec →
  perceptual-hash **dedup** → Claude **vision** flags on-screen text errors (typos/spelling/
  grammar/formatting) → in-tab player + sortable flag list, plus `results.json` + standalone
  `report.html`. It is a standalone QC pass, **not** a pipeline stage — rendered as a smaller
  secondary nav tab (set apart from the three numbered stages).

The flows are independent (no automated handoff yet). The landing page `/` picks a pipeline
tool; `(tools)/layout.tsx` adds a shared toggle nav across all of them.

See @README.md for user-facing setup. This file is for things Claude can't infer by reading the code.

## Layout

- Route group `src/app/(tools)/` holds all tool pages: `segmenter/page.tsx`,
  `clipper/page.tsx` (+ `clipper/actions/validate-assembly.ts` server action),
  `frameio-review/page.tsx`. URLs stay `/segmenter`, `/clipper`, `/frameio-review` (route
  groups don't affect the path).
- API is namespaced: `src/app/api/segmenter/*` (`segment`, `transcribe`, `export-mp4`,
  `multicam-export`, `multicam-download/[id]`, `pick-file`), `src/app/api/clipper/*`
  (`clip-preview`, `transcribe`, `native-pick`, `video`), and `src/app/api/frameio-review/*`
  (`pick-file`, `review`, `video`, `frame`). Shared helpers live in `src/app/api/_lib/`
  (`spawn-python.ts`, `multicam-store.ts`).
  - `pick-file` / `native-pick` open a **macOS-only** `osascript` file dialog and return an
    absolute local path (no upload). `api/clipper/video` and `api/frameio-review/video` stream
    that local file to the browser with HTTP range support — still local, nothing is uploaded.
  - `api/frameio-review/review` is an **SSE** route that spawns `scripts/frameio/review.py
    --server` and forwards its NDJSON events as-is. `api/frameio-review/frame` serves extracted
    thumbnail JPGs, restricted to files under `<tmpdir>/frameio-*` ending in `.jpg` (no
    traversal) — not a generic local-file read primitive.
- Components: `src/components/segmenter/*`, `src/components/clipper/*`,
  `src/components/frameio-review/*` (`file-browser`, `config-step`, `review-workspace`),
  shared shadcn primitives in `src/components/ui/`, shared `src/components/shared/nav.tsx`
  (FRAME.IO REVIEW lives in that file's `UTILS` array, separate from the numbered `TOOLS`).
- Libs/prompts: SEGMENTER uses `src/lib/types.ts` + `src/prompts/segment-system.ts`. CLIPPER
  is self-contained under `src/lib/clipper/*` (incl. `editor/`) + `src/prompts/clipper/*`.
  CLIPPER's `types.ts` is kept separate (its `WordTiming` carries an extra `speaker` field).
  FRAME.IO REVIEW shapes live in `src/lib/frameio/types.ts`; its prompt + model constant live
  in the Python `scripts/frameio/claude_client.py` (the vision call is Python-side, not a TS route).
- FRAME.IO REVIEW Python lives in a package, not a flat script: `scripts/frameio/` with one
  concern per file — `extract.py` (ffmpeg → 1 JPG/sec named by timestamp), `dedup.py`
  (imagehash pHash dedup; each kept frame carries its visible time range and the
  representative is the **settled** frame of the run — modal pHash, tie-break middle-by-time,
  NOT the first frame, so a mid-fade-in frame isn't picked), `ocr_dedup.py` (alternate
  selector for `--mode ocr`: groups frames by tesseract text via rapidfuzz token_set_ratio,
  modal rep per run, fade-fragment merge, empty-OCR fallback), `claude_client.py` (anthropic
  vision, forced-JSON tool, 429/529 backoff), `review.py` (orchestrator: CLI with
  `results.json`/`report.html` AND `--server` NDJSON mode for the tab), `util.py` (stderr log).
- **Selection is `--mode` (default `visual`).** `visual` = pHash settled-frame (works on any
  footage, incl. text over moving video); `ocr` = tesseract-text grouping (clean slideware
  only — OCR is too noisy on stylized/moving footage, validated). `--select-only` prints the
  representative table and exits before any Claude call (free). `--max-reps N` caps reps sent
  (cheap test runs; default none). Before flags are emitted, `review.py` **drops no-op flags**
  (`exact_text_seen` == `suggested_fix`) and **downgrades self-identified cut-off/incomplete
  flags to low confidence** (`_clean_errors`). After judging, `review.py` runs a **verdict-dedup**:
  consecutive flags whose Claude `exact_text_seen` is fuzzy-equal (token_set_ratio ≥ 90) are
  collapsed to one finding (`merged_count`), folding fade-variants/repeats using the model's
  own transcription rather than pHash/tesseract. The tab swaps its live raw flags for this
  deduped `done.flags` set on completion.

## Build, lint, run

```bash
npm install
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt   # deepgram-sdk, numpy, scipy, Pillow, imagehash, anthropic, pytesseract, rapidfuzz

npm run dev      # Next 16 + Turbopack, http://localhost:3000
npm run build
npm run lint     # ESLint via next config — there is no test suite
```

`ffmpeg` and `ffprobe` must be on PATH. `tesseract` must also be on PATH **only** for FRAME.IO REVIEW's `--mode ocr` (the default `visual` mode doesn't need it). The Next API routes auto-detect `.venv/bin/python3` via `src/app/api/_lib/spawn-python.ts` and fall back to system `python3`.

## Environment (`.env.local`)

- `ANTHROPIC_API_KEY` — required (SEGMENTER `api/segmenter/segment/route.ts`; CLIPPER `api/clipper/clip-preview/route.ts`; FRAME.IO REVIEW `scripts/frameio/claude_client.py`, read from the environment, never hardcoded)
- `DEEPGRAM_API_KEY` — required for SEGMENTER + CLIPPER transcription (`scripts/transcribe.py`, `scripts/clipper_transcribe.py`). FRAME.IO REVIEW does **not** use Deepgram (vision-only).
- `ANTHROPIC_MODEL` — optional override; default `claude-sonnet-4-6`. **SEGMENTER only** (`api/segmenter/segment/route.ts`); CLIPPER's `clip-preview` and `validate-assembly` are pinned to `claude-sonnet-4-6` in code (see Invariants), not env-overridable.
- `NEXT_PUBLIC_SNIPER_DEBUG` / `SNIPER_DEBUG` — debug tracing, **ON by default**. `NEXT_PUBLIC_SNIPER_DEBUG=0` silences the TS `dlog`/`derror` (client + server, `src/lib/debug.ts`); `SNIPER_DEBUG=0` silences the Python workers' `[SNIPER:*]` stderr. CLIPPER and FRAME.IO REVIEW forward client `dlog`s to their `debug-log` route so the whole flow (browser + server + python) shows in the `npm run dev` terminal. FRAME.IO REVIEW additionally surfaces the same trace **in the tab** — `api/frameio-review/review` forwards each python stderr line over SSE as a `log` event, rendered in the review view's collapsible **Diagnostics** panel (with copy-to-clipboard).
- `CLIPPER_DUMP_FIXTURE=1` — optional dev flag; dumps `clip-preview`'s LLM tool-call JSON to a fixture for prompt iteration.
- `MULTICAM_DEBUG=1` — optional dev flag; `scripts/multicam_pipeline.py` writes verbose per-step tracing (every ffmpeg/ffprobe command + timing, keyframe/smartcut decisions, per-clip method + fallback reasons, seam-validation results, per-segment padding) to **stderr**. The multicam-export route mirrors stderr live to the `npm run dev` console. Run `MULTICAM_DEBUG=1 npm run dev` (or add it to `.env.local`) to capture a full render log.

## Invariants — DO NOT "fix" these

- **Model pin.** The `claude-sonnet-4-6` default in SEGMENTER's `api/segmenter/segment/route.ts` AND CLIPPER's `api/clipper/clip-preview/route.ts` (and the `validate-assembly` action) is intentional. YOU MUST NOT bump the default model in code without an explicit request. FRAME.IO REVIEW's `MODEL = "claude-sonnet-4-6"` constant in `scripts/frameio/claude_client.py` is the same intentional default — user-swappable to `claude-haiku-4-5` via the UI model picker or `review.py --model`, but don't change the code default.
- **SEGMENTER export is stream-copy, not re-encode** (`scripts/export_mp4.py`). `-ss` BEFORE `-i` is input-side fast seek; clips snap to the nearest keyframe at-or-before the padded start, so adjacent clips may overlap. This is intentional — output is rough footage for NLE trimming. YOU MUST NOT switch to re-encode, move `-ss` after `-i`, or "tighten" boundaries to make cuts exact. (Scope: ONLY `scripts/export_mp4.py`.) **CLIPPER's FCPXML path is frame-accurate by design** — don't "optimize" it to stream-copy.
- **Multicam cuts are frame-accurate standalone clips, default cut method `smartcut`** (`scripts/multicam_pipeline.py`). Each source is cut to the same padded window (`PAD_SECONDS = 5.0`) translated by its xcorr offset, so angles line up on their own with no NLE alignment. The **video** sources (A/B/C) define the common pre/post-roll (each must cover the segment core, else it's dropped — video can't be fabricated); **audio** sources (lavs) adapt to that window — a small shortfall (≤ `AUDIO_SILENCE_PAD_MAX`, 0.5s) is filled with silence on the short end via `cut_audio_segment_window` (real samples keep their timeline position; status `audio_padded`) and only a larger gap drops the track (status `source_dropped`). **Per-segment audio drift correction is ON by default** (`--audio-drift-correction` / `--no-audio-drift-correction`): a single global xcorr offset is exact only where it was measured, so a separate recorder whose clock runs slightly fast/slow slides out of sync across a long take. Before cutting each lav for a segment, `refine_audio_offset` re-measures that lav's offset *locally* around the segment (seeded by the global offset, searching ±`--audio-drift-window`, default 2.0s, with a `--audio-drift-probe` default 15s window) and cuts with the refined offset (status `audio_drift_corrected`). It only trusts a refined offset when the normalized-correlation peak clears `AUDIO_DRIFT_MIN_CONFIDENCE` (0.10) and isn't at a search-window edge — otherwise it keeps the global offset (silence / non-matching audio / out-of-window drift never push a good track out of sync). This is what keeps lavs inside the strict `--tolerance-frames` (1.5) sync check; DO NOT replace it with a looser tolerance or a single global offset. `smartcut` re-encodes only the partial GOPs at each boundary (libx264 **CRF 18**) and stream-copies the whole GOPs between (H.264 sources only; TS-protocol concat; copy tail isn't frame-exact, so `smartcut_video` measures the copy's real length and re-encodes the remainder so head/copy/tail are contiguous). `validate_seam` checks the whole-clip frame count (packet count, no decode) and decodes only a ±`SEAM_PROBE_PAD` window around each splice junction (`smartcut_video` returns the seam positions; the copied middle is lossless so only junctions can glitch) — on any **decoder** error (the benign `non monotonically increasing dts to muxer` warning is ignored) or frame-count mismatch it auto-falls-back to `full_reencode_segment` (the legacy full libx264 CRF 18 path, also forced by `--cut-method reencode`). DO NOT make the smartcut middle stream-copy the boundary frames, "tighten" the measure-and-fill, switch off the H.264 gate, or remove the full-reencode fallback. Frame accuracy + clean seams are the point — don't trade them for speed (no VideoToolbox/`-c copy` of whole segments). Segments are cut concurrently (`--workers`, default `min(4, cpu)`); `log_status` is lock-serialized because each line is one SSE JSON object.
- **Two transcribe workers.** `scripts/transcribe.py` (SEGMENTER) and `scripts/clipper_transcribe.py` (CLIPPER) are distinct; CLIPPER's adds stereo-channel isolation + diarization. Don't merge them.
- **Temp files are owned by their producer.** CLIPPER's audio temps — `/tmp/clipper-audio-*.mp3` (mono extract), `/tmp/clipper-chunks-*/` (10-min chunks), `/tmp/clipper-ch{1,2}-*.mp3` (isolated stereo channels) — are all cleaned by `clipper_transcribe.py`'s `finally` blocks. SEGMENTER's multicam export zip is held in `multicam-store.ts` (1-hour TTL) and deleted by `multicam-download/[id]` after it's sent. CLIPPER export writes **no** server temp — the FCPXML and example `.txt` are built and downloaded client-side. FRAME.IO REVIEW's extracted frames live in `<tmpdir>/frameio-<sha1(input+mtime+fps)>/` — a **deterministic cache** so a "proceed anyway" re-run reuses them instead of re-extracting; they're intentionally NOT deleted at end-of-run (the in-tab thumbnails + `report.html` read them), and `review.py` sweeps any `frameio-*` dir older than 1h at the start of each run. Do not add manual cleanup elsewhere or move it. (`results.json` + standalone `report.html` are written next to the input video, or to `--out-dir`.)
- **Only audio + transcript text leaves the machine — EXCEPT FRAME.IO REVIEW.** For SEGMENTER + CLIPPER, video bytes are read locally (CLIPPER's editor plays the source via `api/clipper/video`, still local), mono audio goes to Deepgram, transcript text goes to Anthropic — do not route raw video to any third party or cloud storage. **FRAME.IO REVIEW is the deliberate exception** (this is the whole point of the tool, user-requested): it sends **still frame JPEGs** (one per kept/deduped second, base64) to the Anthropic vision API for text-error review. Frames are derived from the video but are stills, not the video stream, and only post-dedup frames are sent. The full MP4 is still only ever read locally (`api/frameio-review/video` streams it to the in-tab player). Keep it this way — don't widen the egress (no audio, no full video) and don't "fix" the tool to stop sending frames.
- **No on-disk app state between steps.** Transcript, segments, and edit state live in React state in the tool pages. Do not add a DB, file cache, or localStorage unless explicitly asked.
- **Python launcher reuse.** API routes that shell to Python MUST import `spawnPython` / `pythonInterpreter` / `SCRIPTS_DIR` from `src/app/api/_lib/spawn-python.ts`. Do not hardcode interpreter paths.

## Code style

- TypeScript strict. SEGMENTER shapes (`TranscriptEntry`, `SegmentGroup`, `WordTiming`) live in `src/lib/types.ts`; CLIPPER shapes (`LineDecision`, `EditableWord`, `Source`, `SpeakerMap`, `AppStep`, …) live in `src/lib/clipper/types.ts`. Update the relevant one first when changing a transcript/segment shape.
- SEGMENTER segmentation prompt: `src/prompts/segment-system.ts` (route user-message structure in `api/segmenter/segment/route.ts`). CLIPPER edit prompt: `src/prompts/clipper/default-edit.ts`.
- UI: Tailwind v4 + shadcn/ui primitives in `src/components/ui/` (`badge`, `button`, `card`, `dialog`, `input`, `progress`, `scroll-area`, `separator`, `tabs`, `textarea`). Add others via `npx shadcn add <name>` rather than hand-writing. `lucide-react` is available for icons.

## Verification

There is no test suite. After non-trivial changes, run `npm run dev` and walk the relevant flow against a short MP4: SEGMENTER (Transcribe → Edit Segments → Export zip), CLIPPER (Transcribe → Clip → Edit → Export FCPXML), and/or FRAME.IO REVIEW (Choose MP4 → Configure → Run → review flags). `npm run build` + `npm run lint` must pass clean (the build is the surest check that import/fetch paths across the namespaces still resolve). If a change can't be verified that way (e.g. server-only refactor), say so explicitly instead of claiming success.

FRAME.IO REVIEW's Python is independently runnable without the UI (modular per its spec): `.venv/bin/python3 -m scripts.frameio.review --input clip.mp4` extracts → selects representatives → prints the API-call estimate + rough cost (asks before >200) → analyzes → verdict-dedups → writes `results.json` + `report.html`. Use `--max-reps N` (cap reps sent) and/or `--max-frames`/`--fps` for a cheap test pass, `--select-only` to print the representative table for free (no Claude call), and `--mode ocr --fuzz N` for the tesseract selector. The `--server` flag switches it to the NDJSON event stream the tab consumes.
