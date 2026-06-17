"use client";

import { useState } from "react";
import { SegmentGroup } from "@/lib/types";
import { dlog, summarize } from "@/lib/debug";

interface Props {
  segments: SegmentGroup[];
  filePath: string;
  bcamPath: string;
  ccamPath: string;
  lav1Path: string;
  lav2Path: string;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function isFiller(title: string): boolean {
  return /^\s*filler\b/i.test(title);
}

interface SegmentResult {
  index: number;
  available: string[];
  error?: string;
}

export default function SegmentExportStep({ segments, filePath, bcamPath, ccamPath, lav1Path, lav2Path }: Props) {
  // Which clips the user has ticked for export. Defaults to every non-filler clip.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(
    () => new Set(segments.filter((s) => !isFiller(s.title)).map((s) => s.id)),
  );

  const [mcLoading, setMcLoading] = useState(false);
  const [mcError, setMcError] = useState<string | null>(null);
  const [mcStatus, setMcStatus] = useState("");
  const [mcOffsetB, setMcOffsetB] = useState<number | null>(null);
  const [mcOffsetC, setMcOffsetC] = useState<number | null>(null);
  const [mcOffsetLav1, setMcOffsetLav1] = useState<number | null>(null);
  const [mcOffsetLav2, setMcOffsetLav2] = useState<number | null>(null);
  const [mcSegResults, setMcSegResults] = useState<SegmentResult[]>([]);
  const [mcValidation, setMcValidation] = useState<string | null>(null);

  const exportable = segments.filter((s) => selectedIds.has(s.id));

  const toggleSegment = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectAll = () => setSelectedIds(new Set(segments.map((s) => s.id)));
  const selectNone = () => setSelectedIds(new Set());

  const hasB = !!bcamPath;
  const hasC = !!ccamPath;
  const hasLav1 = !!lav1Path;
  const hasLav2 = !!lav2Path;
  const multicamEnabled = hasB || hasC || hasLav1 || hasLav2;

  const handleExportMulticam = async () => {
    setMcLoading(true);
    setMcError(null);
    setMcStatus("Starting…");
    setMcOffsetB(null);
    setMcOffsetC(null);
    setMcOffsetLav1(null);
    setMcOffsetLav2(null);
    setMcSegResults([]);
    setMcValidation(null);

    const payload = {
      acamPath: filePath,
      bcamPath: hasB ? bcamPath : undefined,
      ccamPath: hasC ? ccamPath : undefined,
      lav1Path: hasLav1 ? lav1Path : undefined,
      lav2Path: hasLav2 ? lav2Path : undefined,
      segments: exportable.map((s) => ({ title: s.title, start: s.start, end: s.end })),
    };

    try {
      dlog("segmenter:multicam", "export request → /api/segmenter/multicam-export", {
        acamPath: payload.acamPath,
        bcamPath: payload.bcamPath,
        ccamPath: payload.ccamPath,
        lav1Path: payload.lav1Path,
        lav2Path: payload.lav2Path,
        segments: summarize(payload.segments),
      });
      const res = await fetch("/api/segmenter/multicam-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let downloadTriggered = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const msg = JSON.parse(raw);
            dlog("segmenter:multicam", `SSE ${msg.status ?? (msg.error ? "error" : msg.stderr ? "stderr" : "?")}`, summarize(msg));
            if (msg.error) { setMcError(msg.error); return; }
            if (msg.stderr) continue;

            switch (msg.status) {
              case "probed_sources":
                setMcStatus(`Probed sources (A=${msg.a_duration?.toFixed?.(1) ?? "?"}s, ${msg.a_fps} fps)`);
                break;
              case "estimating_offset_coarse":
                setMcStatus(`Estimating ${msg.cam}-cam offset (coarse pass)…`);
                break;
              case "estimating_offset_fine":
                setMcStatus(`Refining ${msg.cam}-cam offset…`);
                break;
              case "estimating_offset_fine_done":
              case "estimating_offset_coarse_done":
                break;
              case "offsets_rounded":
                if (typeof msg.b_offset === "number") setMcOffsetB(msg.b_offset);
                if (typeof msg.c_offset === "number") setMcOffsetC(msg.c_offset);
                if (typeof msg.lav1_offset === "number") setMcOffsetLav1(msg.lav1_offset);
                if (typeof msg.lav2_offset === "number") setMcOffsetLav2(msg.lav2_offset);
                setMcStatus("Offsets locked. Cutting segments…");
                break;
              case "segment_cut":
                setMcSegResults((prev) => [
                  ...prev,
                  { index: msg.index, available: msg.available ?? [] },
                ]);
                setMcStatus(`Cut segment ${msg.index + 1} / ${exportable.length}`);
                break;
              case "segment_skipped":
              case "segment_failed":
                setMcSegResults((prev) => [
                  ...prev,
                  { index: msg.index, available: [], error: msg.reason ?? msg.error ?? "skipped" },
                ]);
                break;
              case "validation_passed":
                setMcValidation(
                  `Sync OK (${msg.validation?.method ?? "?"}, tolerance ${msg.validation?.tolerance_seconds ?? "?"}s)`,
                );
                setMcStatus("Validating sync…");
                break;
              case "validation_failed":
                setMcValidation(`Sync failed: ${JSON.stringify(msg.validation)}`);
                break;
              case "validation_skipped":
                setMcValidation("Sync validation skipped");
                break;
              case "zipping":
                setMcStatus("Zipping output…");
                break;
              case "zipped":
                setMcStatus("Zip complete. Preparing download…");
                break;
              case "done":
                setMcStatus("Pipeline finished.");
                break;
              case "ready":
                if (msg.downloadId && !downloadTriggered) {
                  downloadTriggered = true;
                  setMcStatus("Downloading…");
                  window.location.href = `/api/segmenter/multicam-download/${msg.downloadId}`;
                }
                break;
            }
          } catch { /* ignore non-JSON */ }
        }
      }
    } catch (e) {
      setMcError(e instanceof Error ? e.message : String(e));
    } finally {
      setMcLoading(false);
    }
  };

  const allSelected = selectedIds.size === segments.length && segments.length > 0;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-1">Export</h2>
        <p className="text-neutral-400 text-sm">
          {exportable.length} clip{exportable.length !== 1 ? "s" : ""} ready to render as individual MP4s.
        </p>
        <p className="text-xs text-neutral-500 mt-1">
          Each export includes ~5s padding before and after for safe trimming in your NLE.
        </p>
      </div>

      <div className="mb-8 rounded-xl border border-neutral-800 bg-neutral-900/30 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800">
          <span className="text-xs text-neutral-500 uppercase tracking-wider font-medium">
            Segments
            <span className="ml-2 text-neutral-600 normal-case tracking-normal">
              {selectedIds.size} of {segments.length} selected
            </span>
          </span>
          <div className="flex items-center gap-3 text-xs">
            <button
              onClick={selectAll}
              disabled={allSelected}
              className="text-neutral-400 hover:text-cyan-300 disabled:opacity-30 disabled:cursor-default transition-colors"
            >
              Select all
            </button>
            <span className="text-neutral-700">·</span>
            <button
              onClick={selectNone}
              disabled={selectedIds.size === 0}
              className="text-neutral-400 hover:text-cyan-300 disabled:opacity-30 disabled:cursor-default transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
        <div className="divide-y divide-neutral-800">
          {segments.map((seg, i) => {
            const filler = isFiller(seg.title);
            const willExport = selectedIds.has(seg.id);
            return (
              <label
                key={seg.id}
                className={`flex items-center justify-between px-4 py-1.5 cursor-pointer hover:bg-neutral-800/30 transition-colors ${willExport ? "" : "opacity-40"}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <input
                    type="checkbox"
                    checked={willExport}
                    onChange={() => toggleSegment(seg.id)}
                    className="accent-cyan-500 shrink-0"
                  />
                  <span className="text-xs text-neutral-600 font-mono w-5 text-right shrink-0">{i + 1}</span>
                  <span className={`text-xs truncate ${filler ? "text-neutral-500 italic" : "text-neutral-200"}`}>
                    {seg.title}
                  </span>
                </div>
                <span className="text-xs text-neutral-500 font-mono shrink-0 ml-3">
                  {fmtTime(seg.start)} → {fmtTime(seg.end)}
                  <span className="text-neutral-700 ml-2">({Math.round(seg.end - seg.start)}s)</span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <button
        onClick={handleExportMulticam}
        disabled={mcLoading || !filePath || exportable.length === 0 || !multicamEnabled}
        title={!multicamEnabled ? "Select a B-cam, C-cam, or Lav in Step 1 to enable multicam export." : undefined}
        className="w-full flex items-center justify-between px-5 py-4 rounded-xl border border-cyan-500/50 bg-cyan-950/30 hover:bg-cyan-950/50 hover:border-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all group"
      >
        <div className="text-left">
          <p className="text-sm font-semibold text-cyan-200">
            {mcLoading ? "Running multicam pipeline…" : "Export Multicam (zip)"}
          </p>
          <p className="text-xs text-cyan-400/70 mt-0.5">
            {multicamEnabled
              ? `A${hasB ? " + B" : ""}${hasC ? " + C" : ""}${hasLav1 ? " + L1" : ""}${hasLav2 ? " + L2" : ""} · audio sync · frame-accurate re-encode`
              : "Add B-cam, C-cam, or a Lav in Step 1"}
          </p>
        </div>
        <span className="text-cyan-400 group-hover:text-cyan-200 transition-colors text-lg">
          {mcLoading ? "⏳" : "⬇"}
        </span>
      </button>

      {(mcLoading || mcStatus || mcError || mcValidation || mcSegResults.length > 0) && (
        <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900/30 p-4 space-y-3">
          {mcStatus && (
            <div className="flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${mcError ? "bg-red-500" : mcLoading ? "bg-cyan-500 animate-pulse" : "bg-green-500"}`} />
              <span className="text-sm text-neutral-200 flex-1">{mcStatus}</span>
            </div>
          )}
          {(mcOffsetB !== null || mcOffsetC !== null || mcOffsetLav1 !== null || mcOffsetLav2 !== null) && (
            <div className="text-xs text-neutral-400 font-mono pl-5 flex flex-wrap gap-x-4 gap-y-1">
              {mcOffsetB !== null && <span>B offset: {mcOffsetB.toFixed(3)}s</span>}
              {mcOffsetC !== null && <span>C offset: {mcOffsetC.toFixed(3)}s</span>}
              {mcOffsetLav1 !== null && <span>L1 offset: {mcOffsetLav1.toFixed(3)}s</span>}
              {mcOffsetLav2 !== null && <span>L2 offset: {mcOffsetLav2.toFixed(3)}s</span>}
            </div>
          )}
          {mcSegResults.length > 0 && (
            <div className="text-xs space-y-1 pl-5 max-h-40 overflow-y-auto">
              {mcSegResults.map((r) => (
                <div key={r.index} className="flex items-center gap-2 font-mono">
                  <span className="text-neutral-500 w-10">#{r.index + 1}</span>
                  {r.error ? (
                    <span className="text-amber-400">skipped — {r.error}</span>
                  ) : (
                    <span className="text-neutral-300">
                      {r.available.map((c) => c.toUpperCase()).join(" + ") || "none"}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {mcValidation && (
            <p className="text-xs text-cyan-400/80 pl-5">{mcValidation}</p>
          )}
          {mcError && (
            <p className="text-sm text-red-400 mt-2 p-3 bg-red-950/20 border border-red-900/30 rounded-lg">
              {mcError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
