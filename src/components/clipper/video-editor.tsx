"use client";

import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { EditableWord } from "@/lib/clipper/types";
import { computeFinalClips, generateDebugTXT } from "@/lib/clipper/export";
import { downloadText } from "@/lib/clipper/download";
import { Button } from "@/components/ui/button";

interface Props {
  words: EditableWord[];
  onChange: (words: EditableWord[]) => void;
  onContinue: () => void;
  videoSrc?: string;
  fileName?: string;
  duration?: number;
}

interface WordGroup {
  utteranceIdx: number;
  speaker?: number | null;
  words: EditableWord[];
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export default function VideoEditor({ words, onChange, onContinue, videoSrc, fileName = "clip", duration = 0 }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playBoundaryRef = useRef<number | null>(null);
  const keptClipsRef = useRef<{ start: number; end: number }[]>([]);
  const playableClipsRef = useRef<{ start: number; end: number }[]>([]);

  // Drag selection state (refs to avoid stale closures in event handlers)
  const isDragging = useRef(false);
  const dragAnchorIdx = useRef<number>(-1);

  // Play from a given start time through all kept clips (skipping removed words)
  const playCurrentSegment = useCallback((fromTime?: number) => {
    const clips = keptClipsRef.current;
    const clipsFromHere = fromTime != null ? clips.filter((clip) => clip.end > fromTime) : clips;
    const start = fromTime != null
      ? Math.max(fromTime, clipsFromHere[0]?.start ?? fromTime)
      : (clips[0]?.start ?? 0);
    const end = clips[clips.length - 1]?.end ?? 0;
    if (start < end) playRange(start, end, clipsFromHere.length ? clipsFromHere : clips);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard: Backspace = cut, Escape = deselect, Cmd+Z handled by browser
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === " ") {
        e.preventDefault();
        if (videoRef.current?.paused === false) {
          videoRef.current.pause();
          playBoundaryRef.current = null;
        } else {
          // If a word is selected, play from that word's start time
          const selectedWords = words.filter((w) => selectedIds.has(w.id));
          const fromTime = selectedWords.length > 0
            ? Math.min(...selectedWords.map((w) => w.start))
            : undefined;
          playCurrentSegment(fromTime);
        }
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        cutSelection();
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        restoreSelection();
      } else if (e.key === "Escape") {
        setSelectedIds(new Set());
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, words, playCurrentSegment]);

  // rAF-based playback loop: skip removed regions + respect selection boundary
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const TOLERANCE = 0.05; // 50ms

    let rafId = 0;

    const tick = () => {
      if (!el.paused) {
        const t = el.currentTime;

        // ── Skip-removed (reads playableClipsRef set by caller) ──────────
        const clips = playableClipsRef.current;
        if (clips.length) {
          const inKept = clips.some((clip) => t >= clip.start - TOLERANCE && t < clip.end + TOLERANCE);
          if (!inKept) {
            const next = clips.find((clip) => clip.start > t + TOLERANCE);
            if (next) {
              // Re-check boundary before seeking to ensure we don't jump past it
              if (playBoundaryRef.current !== null && next.start >= playBoundaryRef.current - TOLERANCE) {
                el.pause();
                playBoundaryRef.current = null;
                rafId = requestAnimationFrame(tick);
                return;
              }
              el.currentTime = next.start;
            } else {
              el.pause();
              playBoundaryRef.current = null;
              rafId = requestAnimationFrame(tick);
              return;
            }
          }
        }

        // ── Boundary check (stop at segment/selection end) ────────────────
        if (playBoundaryRef.current !== null && t >= playBoundaryRef.current - TOLERANCE) {
          el.pause();
          playBoundaryRef.current = null;
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    const onPlay  = () => {
      // If no boundary set (native play button), use all kept clips
      if (playBoundaryRef.current === null) playableClipsRef.current = keptClipsRef.current;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(tick);
    };
    const onPause = () => { cancelAnimationFrame(rafId); };

    el.addEventListener("play",  onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("play",  onPlay);
      el.removeEventListener("pause", onPause);
      cancelAnimationFrame(rafId);
    };
  }, []);

  const seekTo = useCallback((time: number) => {
    const el = videoRef.current;
    if (el) el.currentTime = Math.max(0, time);
  }, []);

  const playRange = useCallback((startTime: number, endTime: number, clips?: { start: number; end: number }[]) => {
    const el = videoRef.current;
    if (!el) return;
    playBoundaryRef.current = endTime;
    playableClipsRef.current = clips ?? keptClipsRef.current;
    el.currentTime = Math.max(0, startTime);
    el.play().catch(() => {});
  }, []);

  const getTimeRangeForIds = useCallback((ids: Set<string>): { start: number; end: number } | null => {
    let start = Infinity;
    let end = -Infinity;
    for (const w of words) {
      if (ids.has(w.id)) {
        if (w.start < start) start = w.start;
        if (w.end > end) end = w.end;
      }
    }
    return start === Infinity ? null : { start, end };
  }, [words]);

  // Groups
  const groups = useMemo<WordGroup[]>(() => {
    const map = new Map<number, EditableWord[]>();
    for (const w of words) {
      if (!map.has(w.utteranceIdx)) map.set(w.utteranceIdx, []);
      map.get(w.utteranceIdx)!.push(w);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b).map(([utteranceIdx, ws]) => ({
      utteranceIdx, speaker: ws[0]?.speaker, words: ws,
    }));
  }, [words]);

  const exportDuration = useMemo(() => computeFinalClips(words).reduce((a, c) => a + (c.end - c.start), 0), [words]);

  // Build sorted kept clips directly — merge consecutive non-removed words,
  // splitting on any gap (removed word breaks the sequence).
  // Gap threshold: 50ms to tolerate minor timestamp imprecision.
  const keptClips = useMemo(() => {
    const GAP = 0.05;
    const kept = words.filter((w) => !w.removed).sort((a, b) => a.start - b.start);
    const clips: { start: number; end: number }[] = [];
    for (const w of kept) {
      const last = clips[clips.length - 1];
      if (last && w.start - last.end <= GAP) {
        last.end = w.end;
      } else {
        clips.push({ start: w.start, end: w.end });
      }
    }
    return clips;
  }, [words]);
  // Keep refs in sync so the rAF loop always sees latest clips without re-registering
  keptClipsRef.current = keptClips;
  // Only update playable if no active boundary (don't clobber a scoped playback)
  if (playBoundaryRef.current === null) playableClipsRef.current = keptClips;

  // ── Selection actions ─────────────────────────────────────────────────────

  const cutSelection = useCallback(() => {
    if (!selectedIds.size) return;
    onChange(words.map((w) => selectedIds.has(w.id) ? { ...w, removed: true } : w));
    setSelectedIds(new Set());
  }, [selectedIds, words, onChange]);

  const restoreSelection = useCallback(() => {
    if (!selectedIds.size) return;
    onChange(words.map((w) => selectedIds.has(w.id) ? { ...w, removed: false } : w));
    setSelectedIds(new Set());
  }, [selectedIds, words, onChange]);

  const selectionHasRemoved = useMemo(() =>
    selectedIds.size > 0 && words.some((w) => selectedIds.has(w.id) && w.removed),
    [selectedIds, words]
  );

  // ── Drag selection ────────────────────────────────────────────────────────

  const getIdxFromId = useCallback((id: string) => words.findIndex((w) => w.id === id), [words]);

  const buildRangeIds = (anchorIdx: number, currentIdx: number): Set<string> => {
    const [lo, hi] = anchorIdx <= currentIdx ? [anchorIdx, currentIdx] : [currentIdx, anchorIdx];
    return new Set(words.slice(lo, hi + 1).map((w) => w.id));
  };

  const onWordMouseDown = (e: React.MouseEvent, wordId: string) => {
    e.preventDefault();
    const idx = getIdxFromId(wordId);
    isDragging.current = true;
    dragAnchorIdx.current = idx;
    let newIds: Set<string>;
    if (e.shiftKey && selectedIds.size > 0) {
      const existingIdxes = Array.from(selectedIds).map(getIdxFromId).filter((i) => i >= 0);
      const anchorIdx = existingIdxes[0];
      newIds = buildRangeIds(anchorIdx, idx);
    } else {
      newIds = new Set([wordId]);
    }
    setSelectedIds(newIds);
    const range = getTimeRangeForIds(newIds);
    if (range) {
      // Build clips from just the selected non-removed words
      const selClips: { start: number; end: number }[] = [];
      for (const w of words) {
        if (!newIds.has(w.id) || w.removed) continue;
        const last = selClips[selClips.length - 1];
        if (last && w.start - last.end <= 0.05) { last.end = w.end; }
        else selClips.push({ start: w.start, end: w.end });
      }
      playRange(range.start, range.end, selClips.length ? selClips : undefined);
    }
  };

  const onWordMouseEnter = (_e: React.MouseEvent, wordId: string) => {
    if (!isDragging.current) return;
    setSelectedIds(buildRangeIds(dragAnchorIdx.current, getIdxFromId(wordId)));
  };

  useEffect(() => {
    const up = () => { isDragging.current = false; };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  return (
    <div className="flex flex-col select-none" style={{ height: "calc(100vh - 160px)" }}>

      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Stats */}
          <span className="text-sm text-neutral-400">Duration: ~{fmtDuration(exportDuration)}</span>

          <span className="text-neutral-700">·</span>

          {/* Shortcut hints */}
          <span className="flex items-center gap-1 text-xs text-neutral-600">
            <kbd className="px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 font-sans text-red-400">⌫</kbd>
            <span>Delete</span>
          </span>
          <span className="flex items-center gap-1 text-xs text-neutral-600">
            <kbd className="px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 font-sans text-green-400">R</kbd>
            <span>Restore</span>
          </span>
          <span className="flex items-center gap-1 text-xs text-neutral-600">
            <kbd className="px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 font-sans text-green-400">Speaker</kbd>
            <span>Toggle line</span>
          </span>
          <span className="flex items-center gap-1 text-xs text-neutral-600">
            <span>click word +</span>
            <kbd className="px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 font-sans text-neutral-400">Space</kbd>
            <span>= play from that point</span>
          </span>

          {/* Selection actions */}
          {selectedIds.size > 0 && (
            <>
              <span className="text-neutral-700">·</span>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={cutSelection}
                className="text-sm text-red-400 hover:text-red-300 transition-colors"
              >
                Delete
              </button>
              {selectionHasRemoved && (
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={restoreSelection}
                  className="text-sm text-green-400 hover:text-green-300 transition-colors"
                >
                  Restore
                </button>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            onClick={() => {
              const report = generateDebugTXT(words, fileName, duration);
              downloadText(report, `${fileName.replace(/\.[^.]+$/, "")}-debug.txt`);
            }}
            className="border-neutral-700 text-neutral-400 hover:text-white text-xs px-3"
            title="Download word-level debug transcript"
          >
            ↓ Debug TXT
          </Button>
          <Button onClick={onContinue} className="bg-violet-600 text-white hover:bg-violet-500 font-semibold">
            Export →
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex gap-4 flex-1 min-h-0">

        {/* Video panel */}
        {videoSrc && (
          <div className="w-[38%] shrink-0 sticky top-0 self-start space-y-2">
            <video
              ref={videoRef}
              src={videoSrc}
              controls
              className="w-full rounded-lg bg-black"
            />
            <button
              onClick={() => playCurrentSegment()}
              className="w-full py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors"
            >
              ▶ Play Clip
            </button>
            <button
              onClick={() => { videoRef.current?.pause(); playBoundaryRef.current = null; }}
              className="w-full py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-sm font-semibold transition-colors"
            >
              ⏸ Pause
            </button>
          </div>
        )}

        {/* Transcript */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">

          {/* Transcript scroll area */}
          <div
            ref={containerRef}
            className="overflow-y-auto bg-neutral-900/20 px-4 py-4 flex-1 cursor-text rounded-lg border border-neutral-800"
          >
            <div className="space-y-5">
              {groups.map((group) => {
                const groupStart = group.words[0]?.start ?? 0;
                const groupEnd = group.words[group.words.length - 1]?.end ?? 0;
                return (
                  <div
                    key={group.utteranceIdx}
                  >
                    {/* Timestamp + speaker label */}
                    <div className="flex items-center gap-2 mb-1">
                      <button
                        onClick={() => seekTo(groupStart)}
                        className="text-[11px] font-mono text-neutral-600 hover:text-neutral-400 transition-colors"
                      >
                        {fmt(groupStart)} – {fmt(groupEnd)}
                      </button>
                      {group.speaker != null && (
                        <button
                          onClick={() => {
                            const allKept = group.words.every((w) => !w.removed);
                            onChange(words.map((w) =>
                              group.words.some((gw) => gw.id === w.id)
                                ? { ...w, removed: allKept }
                                : w
                            ));
                          }}
                          className="text-[11px] text-neutral-700 hover:text-green-400 transition-colors"
                          title="Toggle entire utterance keep/remove"
                        >
                          Speaker {group.speaker}
                        </button>
                      )}
                    </div>

                    {/* Words */}
                    <div className="flex flex-wrap gap-x-[2px] gap-y-0.5 leading-relaxed">
                      {group.words.map((word) => {
                        const isSelected = selectedIds.has(word.id);
                        return (
                          <span
                            key={word.id}
                            onMouseDown={(e) => onWordMouseDown(e, word.id)}
                            onMouseEnter={(e) => onWordMouseEnter(e, word.id)}
                            className={`
                              px-[3px] py-[1px] rounded text-[15px] leading-7 transition-colors cursor-pointer
                              ${word.removed
                                ? isSelected
                                  ? "bg-red-500/20 text-neutral-400"
                                  : "text-neutral-400"
                                : isSelected
                                  ? "bg-violet-500/30 text-white"
                                  : "text-green-300 hover:bg-green-500/10"
                              }
                            `}
                          >
                            {word.text}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
