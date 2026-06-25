"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Copy, FileJson, FileText, Loader2, Terminal } from "lucide-react";
import {
  Confidence,
  FlagRow,
  KeptFrameInfo,
  ReviewConfig,
  ReviewEvent,
} from "@/lib/frameio/types";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { dlog, derror } from "@/lib/debug";

type Phase = "extracting" | "deduping" | "analyzing" | "needs_confirm" | "done" | "error";

type LogKind = "info" | "event" | "flag" | "stderr" | "error";
interface LogLine {
  t: string;
  kind: LogKind;
  text: string;
}

const CONF_RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

const LOG_KIND_CLASS: Record<LogKind, string> = {
  info: "text-signal",
  event: "text-foreground/80",
  flag: "text-emerald-400/90",
  stderr: "text-muted-foreground/70",
  error: "text-destructive",
};

function clockStamp(): string {
  try {
    return new Date().toISOString().slice(11, 23);
  } catch {
    return "--:--:--";
  }
}

function frameUrl(thumb: string) {
  return `/api/frameio-review/frame?path=${encodeURIComponent(thumb)}`;
}
function fmtClock(s: number) {
  const t = Math.floor(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

export default function ReviewWorkspace({
  filePath,
  fileName,
  config,
}: {
  filePath: string;
  fileName: string | null;
  config: ReviewConfig;
}) {
  const [phase, setPhase] = useState<Phase>("extracting");
  const [statusLine, setStatusLine] = useState("Extracting frames…");
  const [extractProg, setExtractProg] = useState({ done: 0, total: 0 });
  const [analyzeProg, setAnalyzeProg] = useState({ done: 0, total: 0 });
  const [estimate, setEstimate] = useState<number | null>(null);
  const [keptFrames, setKeptFrames] = useState<KeptFrameInfo[]>([]);
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [saved, setSaved] = useState<{ results: string; report: string } | null>(null);
  const [failures, setFailures] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [hideLow, setHideLow] = useState(true);
  const [sortBy, setSortBy] = useState<"timestamp" | "confidence" | "error_type">("timestamp");

  const [logs, setLogs] = useState<LogLine[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [showLogs, setShowLogs] = useState(true);
  const [copied, setCopied] = useState(false);

  const pushLog = useCallback((kind: LogKind, text: string) => {
    setLogs((prev) => [...prev, { t: clockStamp(), kind, text }]);
  }, []);

  const handleEvent = useCallback((ev: ReviewEvent) => {
    // Mirror every event into the in-tab Diagnostics log (and the dev terminal
    // via dlog → /api/frameio-review/debug-log). Noisy progress ticks are summarized.
    switch (ev.event) {
      case "log":
        pushLog("stderr", ev.text);
        break;
      case "extract_start":
        pushLog("info", `▶ run started — fps=${ev.fps}, max_frames=${ev.max_frames ?? "none"}`);
        break;
      case "extracted":
        pushLog("event", `extracted ${ev.frames} frame(s)`);
        break;
      case "dedup": {
        const crit = ev.mode === "ocr" ? `fuzz ≥ ${ev.fuzz}` : `hamming ≤ ${ev.threshold}`;
        pushLog("event", `select [${ev.mode ?? "visual"}]: ${ev.extracted} → ${ev.kept} representative(s) (${crit})`);
        break;
      }
      case "estimate":
        pushLog("event", `estimate: ${ev.api_calls} API call(s) after dedup`);
        break;
      case "needs_confirm":
        pushLog("info", `⚠ needs confirm: ${ev.api_calls} calls > ${ev.threshold} limit`);
        break;
      case "flag":
        for (const e of ev.errors) {
          pushLog(
            "flag",
            `flag @ ${ev.t_start}s [${e.confidence}] ${e.error_type}: "${e.exact_text_seen}" → "${e.suggested_fix}"`,
          );
        }
        break;
      case "done":
        pushLog(
          "info",
          `✓ done — ${ev.flag_count} flag(s) / ${ev.frames_analyzed} frame(s)` +
            (ev.frame_failures ? `, ${ev.frame_failures} failed` : ""),
        );
        break;
      case "error":
        pushLog("error", `✗ ${ev.message}`);
        break;
    }
    if (ev.event !== "log") dlog("frameio:review", `event:${ev.event}`);

    switch (ev.event) {
      case "log":
        return;
      case "extract_start":
        setPhase("extracting");
        setStatusLine("Extracting frames…");
        break;
      case "extract_progress":
        setExtractProg({ done: ev.done, total: ev.total });
        break;
      case "extracted":
        setStatusLine(`Extracted ${ev.frames} frame(s). Deduplicating…`);
        setPhase("deduping");
        break;
      case "dedup":
        setStatusLine(`${ev.extracted} frames → ${ev.kept} unique after dedup.`);
        break;
      case "frames":
        setKeptFrames(ev.items);
        break;
      case "estimate":
        setEstimate(ev.api_calls);
        setAnalyzeProg({ done: 0, total: ev.api_calls });
        break;
      case "needs_confirm":
        setPhase("needs_confirm");
        setStatusLine(`${ev.api_calls} API calls needed — over the ${ev.threshold} limit.`);
        break;
      case "analyze_progress":
        setPhase("analyzing");
        setAnalyzeProg({ done: ev.done, total: ev.total });
        setStatusLine(`Analyzing frames… ${ev.done}/${ev.total}`);
        break;
      case "flag":
        setFlags((prev) => [
          ...prev,
          ...ev.errors.map((err, i) => ({
            ...err,
            id: `${ev.t_start}-${i}-${prev.length}`,
            timestamp: ev.timestamp,
            t_start: ev.t_start,
            t_end: ev.t_end,
            thumb: ev.thumb,
          })),
        ]);
        break;
      case "done":
        setPhase("done");
        setFailures(ev.frame_failures);
        setSaved({ results: ev.results_path, report: ev.report_path });
        // Replace the live (raw, per-frame) flags with the final verdict-deduped
        // findings — consecutive same-text verdicts (fade variants, repeats) are
        // collapsed server-side, so the list shows one finding per real error.
        setFlags(
          ev.flags.map((f, i) => ({
            ...f,
            id: `done-${i}-${f.timestamp}`,
          })),
        );
        setStatusLine(
          `Done — ${ev.flag_count} finding(s) across ${ev.frames_analyzed} frame(s)` +
            (ev.frame_failures ? `, ${ev.frame_failures} frame(s) failed` : ""),
        );
        break;
      case "error":
        setPhase("error");
        setError(ev.message);
        break;
    }
  }, [pushLog]);

  const run = useCallback(
    async (confirm: boolean) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setError(null);
      if (confirm) {
        setPhase("extracting");
        setStatusLine("Re-running with confirmation…");
      }
      try {
        const res = await fetch("/api/frameio-review/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filePath,
            fps: config.fps,
            mode: config.mode,
            fuzz: config.fuzz,
            maxReps: config.maxReps,
            maxFrames: config.maxFrames,
            hamming: config.hamming,
            model: config.model,
            confirmThreshold: config.confirmThreshold,
            yes: confirm,
          }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) throw new Error(`Review request failed (${res.status})`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() || "";
          for (const chunk of chunks) {
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            const payload = line.slice(6).trim();
            if (!payload) continue;
            try {
              handleEvent(JSON.parse(payload) as ReviewEvent);
            } catch {
              /* keepalive / partial — ignore */
            }
          }
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        derror("frameio:review", "stream failed", e);
        setPhase("error");
        const msg = e instanceof Error ? e.message : "Review failed";
        setError(msg);
        pushLog("error", `✗ stream failed: ${msg}`);
      }
    },
    [filePath, config, handleEvent, pushLog],
  );

  // Kick off the run once on mount; abort the stream on unmount.
  useEffect(() => {
    dlog("frameio:review", "start run", { fileName, config });
    run(false);
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the diagnostics log pinned to the newest line while it's open.
  useEffect(() => {
    if (showLogs) logEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [logs, showLogs]);

  const copyLogs = async () => {
    const text = logs.map((l) => `[${l.t}] ${l.text}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  const seekTo = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    v.pause();
    v.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const visibleFlags = useMemo(() => {
    const rows = flags.filter((f) => !(hideLow && f.confidence === "low"));
    return [...rows].sort((a, b) =>
      sortBy === "confidence"
        ? CONF_RANK[a.confidence] - CONF_RANK[b.confidence]
        : sortBy === "error_type"
          ? a.error_type.localeCompare(b.error_type)
          : a.timestamp - b.timestamp,
    );
  }, [flags, hideLow, sortBy]);

  const running = phase === "extracting" || phase === "deduping" || phase === "analyzing";
  const extractPct = extractProg.total ? (extractProg.done / extractProg.total) * 100 : 0;
  const analyzePct = analyzeProg.total ? (analyzeProg.done / analyzeProg.total) * 100 : 0;

  return (
    <div className="rise-in">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Player + status */}
        <div className="space-y-4">
          <video
            ref={videoRef}
            src={`/api/frameio-review/video?path=${encodeURIComponent(filePath)}`}
            controls
            className="w-full rounded-lg border border-border bg-black"
          />

          <div className="rounded-lg border border-border bg-card/50 p-4">
            <div className="flex items-center gap-2">
              {running && <Loader2 className="size-4 animate-spin text-signal" />}
              <span className="text-sm text-foreground">{statusLine}</span>
            </div>

            {phase === "extracting" && extractProg.total > 0 && (
              <Progress value={extractPct} className="mt-3" />
            )}
            {(phase === "analyzing" || (phase === "done" && analyzeProg.total > 0)) && (
              <div className="mt-3">
                <Progress value={analyzePct} className="mb-1" />
                <div className="label text-muted-foreground/70">
                  {analyzeProg.done}/{analyzeProg.total} frames · {flags.length} flag(s)
                </div>
              </div>
            )}

            {phase === "needs_confirm" && (
              <ConfirmPanel
                estimate={estimate ?? 0}
                keptFrames={keptFrames}
                onProceed={() => run(true)}
              />
            )}

            {phase === "error" && (
              <p className="mt-2 flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {error}
              </p>
            )}

            {failures > 0 && phase === "done" && (
              <p className="mt-2 text-xs text-amber-400/90">
                {failures} frame(s) failed after retries and were skipped.
              </p>
            )}

            {saved && (
              <div className="mt-3 space-y-1 border-t border-border pt-3">
                <div className="label text-muted-foreground/70">Saved next to your video</div>
                <SavedPath icon={<FileJson className="size-3.5" />} path={saved.results} />
                <SavedPath icon={<FileText className="size-3.5" />} path={saved.report} />
              </div>
            )}
          </div>

          {/* Diagnostics — live event + python-stderr trace for this run. */}
          <div className="rounded-lg border border-border bg-card/50">
            <button
              onClick={() => setShowLogs((s) => !s)}
              className="flex w-full items-center justify-between px-4 py-2.5 text-left"
            >
              <span className="flex items-center gap-2">
                <Terminal className="size-3.5 text-muted-foreground" />
                <span className="label text-foreground">Diagnostics</span>
                <span className="label text-muted-foreground/60">({logs.length})</span>
              </span>
              <span className="label text-muted-foreground/60">{showLogs ? "hide" : "show"}</span>
            </button>

            {showLogs && (
              <div className="border-t border-border">
                <div className="flex items-center justify-between px-4 py-1.5">
                  <span className="label text-muted-foreground/50">
                    events + python stderr · also in the dev terminal
                  </span>
                  <button
                    onClick={copyLogs}
                    disabled={logs.length === 0}
                    className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                  >
                    <Copy className="size-3" />
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="max-h-56 overflow-y-auto px-4 pb-3 font-mono text-[11px] leading-relaxed">
                  {logs.length === 0 ? (
                    <div className="py-3 text-muted-foreground/50">Waiting for events…</div>
                  ) : (
                    logs.map((l, i) => (
                      <div key={i} className="flex gap-2 whitespace-pre-wrap break-words">
                        <span className="shrink-0 text-muted-foreground/40">{l.t}</span>
                        <span className={LOG_KIND_CLASS[l.kind]}>{l.text}</span>
                      </div>
                    ))
                  )}
                  <div ref={logEndRef} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Flag list */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="label text-foreground">
              Flags <span className="text-muted-foreground/60">({visibleFlags.length})</span>
            </h2>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={hideLow}
                  onChange={(e) => setHideLow(e.target.checked)}
                  className="accent-signal"
                />
                Hide low
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="h-7 rounded-md border border-border bg-card/60 px-2 text-xs text-foreground"
              >
                <option value="timestamp">Timestamp</option>
                <option value="confidence">Confidence</option>
                <option value="error_type">Error type</option>
              </select>
            </div>
          </div>

          {visibleFlags.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card/30 px-4 py-12 text-center text-sm text-muted-foreground">
              {running
                ? "Scanning… flags will appear here as they're found."
                : flags.length === 0
                  ? "No on-screen text errors found. 🎯"
                  : "No flags match the current filter."}
            </div>
          ) : (
            <ul className="space-y-2">
              {visibleFlags.map((f) => (
                <li key={f.id}>
                  <button
                    onClick={() => seekTo(f.timestamp)}
                    className="flex w-full gap-3 rounded-lg border border-border bg-card/50 p-3 text-left transition-colors hover:border-signal/50 hover:bg-card/80"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={frameUrl(f.thumb)}
                      alt=""
                      className="h-16 w-28 shrink-0 rounded border border-border object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs tabular-nums text-signal">
                          {fmtClock(f.timestamp)}
                          {f.t_end > f.t_start && `–${fmtClock(f.t_end)}`}
                        </span>
                        <ConfBadge c={f.confidence} />
                        <span className="label text-muted-foreground/70">{f.error_type}</span>
                        {f.merged_count && f.merged_count > 1 && (
                          <span className="label text-muted-foreground/50">×{f.merged_count}</span>
                        )}
                      </div>
                      <div className="mt-1 truncate text-sm">
                        <span className="text-muted-foreground line-through decoration-destructive/60">
                          {f.exact_text_seen}
                        </span>
                      </div>
                      <div className="truncate text-sm text-emerald-400/90">→ {f.suggested_fix}</div>
                      {f.note && (
                        <div className="mt-0.5 truncate text-xs text-muted-foreground/70">{f.note}</div>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfirmPanel({
  estimate,
  keptFrames,
  onProceed,
}: {
  estimate: number;
  keptFrames: KeptFrameInfo[];
  onProceed: () => void;
}) {
  return (
    <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="text-sm text-foreground">
        After dedup this is <span className="font-semibold text-amber-400">{estimate}</span>{" "}
        API calls — over the safety limit. Review the kept frames, then proceed.
      </p>
      {keptFrames.length > 0 && (
        <div className="mt-3 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
          {keptFrames.slice(0, 40).map((k) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={k.index}
              src={frameUrl(k.thumb)}
              alt=""
              title={`${k.t_start}s`}
              className="h-10 w-16 rounded border border-border object-cover"
            />
          ))}
        </div>
      )}
      <Button onClick={onProceed} size="sm" className="mt-3">
        Proceed — run {estimate} calls
      </Button>
    </div>
  );
}

function SavedPath({ icon, path }: { icon: React.ReactNode; path: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="text-signal">{icon}</span>
      <code className="truncate">{path}</code>
    </div>
  );
}

function ConfBadge({ c }: { c: Confidence }) {
  const cls =
    c === "high"
      ? "bg-destructive/15 text-destructive"
      : c === "medium"
        ? "bg-amber-500/15 text-amber-400"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}>
      {c}
    </span>
  );
}
