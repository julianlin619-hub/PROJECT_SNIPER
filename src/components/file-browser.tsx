"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { TranscriptEntry, SegmentGroup } from "@/lib/types";

interface BrowseEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
}

interface Props {
  onComplete: (
    transcript: TranscriptEntry[],
    segments: SegmentGroup[],
    videoPath: string,
    bcamPath: string,
    ccamPath: string,
  ) => void;
}

type SlotKey = "a" | "b" | "c";

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"];

function isVideo(name: string): boolean {
  return VIDEO_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}

type Phase = "browse" | "transcribing" | "segmenting";
type TxStatus = "extracting_audio" | "chunking_audio" | "transcribing" | "done" | "error";

const DEFAULT_SEGMENT_PROMPT =
  "This is a coaching show where guests pitch their business to a host. Segment based on each new guest's CONVERSATION with the host.\n\n" +
  "A guest segment STARTS at the exact word where the host first directly addresses the guest by name " +
  "(e.g. 'Hey Alex', 'Welcome Sarah', 'Alright Sebastian'), OR at the guest's first word if the host doesn't address them by name first. " +
  "Use word-level precision — pick the EXACT word from the [WORDS] data.\n\n" +
  "Inside the guest segment, the conversation typically follows the pattern: guest introduces themselves ('my name is X', 'I own a Y business', " +
  "'I'm doing Z in revenue', 'what's stopping me is B'), host coaches them, then they wrap up.\n\n" +
  "A guest segment ENDS at the LAST word of the wrap-up exchange — phrases like 'thank you so much', 'rock and roll', 'go crush it', " +
  "'appreciate you'. Trailing banter or transition to the next guest is NOT part of this segment.\n\n" +
  "Everything between guest conversations is filler — including host pump-up ('alright let's rock', 'let's slay the day'), " +
  "calling for the next guest ('Jamie, pull him up'), technical setup ('can you hear me', 'unmute yourself' before the guest actually replies), " +
  "reading prep notes about the next guest, ad reads, and banter. Each filler stretch gets its OWN segment with title prefixed 'Filler – ' " +
  "(e.g. 'Filler – Pre-Sebastian transition'). Do NOT include any filler at the start or end of a guest segment.\n\n" +
  "Label each guest segment with the guest's name if mentioned, otherwise a short description of their business " +
  "(e.g. 'Sebastian – Netherlands relocation services').";

export default function FileBrowser({ onComplete }: Props) {
  const [dir, setDir] = useState("");
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [parent, setParent] = useState("");
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);

  const [videoPath, setVideoPath] = useState("");
  const [videoName, setVideoName] = useState("");

  const [bcamPath, setBcamPath] = useState("");
  const [bcamName, setBcamName] = useState("");
  const [ccamPath, setCcamPath] = useState("");
  const [ccamName, setCcamName] = useState("");
  const [targetSlot, setTargetSlot] = useState<SlotKey>("a");

  const [phase, setPhase] = useState<Phase>("browse");

  const [txStatus, setTxStatus] = useState<TxStatus>("extracting_audio");
  const [txStatusText, setTxStatusText] = useState("");
  const [txProgress, setTxProgress] = useState(0);
  const [txError, setTxError] = useState<string | null>(null);

  // Segment prompt
  const [promptMode, setPromptMode] = useState<"default" | "custom">("default");
  const [customPrompt, setCustomPrompt] = useState("");
  const [segError, setSegError] = useState<string | null>(null);

  const browse = async (targetDir?: string) => {
    setBrowseLoading(true);
    setBrowseError(null);
    try {
      const params = targetDir ? `?dir=${encodeURIComponent(targetDir)}` : "";
      const res = await fetch(`/api/browse${params}`);
      const data = await res.json();
      if (data.error) setBrowseError(data.error);
      else {
        setDir(data.dir);
        setParent(data.parent);
        setEntries(data.entries || []);
      }
    } catch (e: unknown) {
      setBrowseError(e instanceof Error ? e.message : "Browse failed");
    } finally {
      setBrowseLoading(false);
    }
  };

  useEffect(() => { browse(); }, []);

  const handleFileClick = (entry: BrowseEntry) => {
    if (!isVideo(entry.name)) return;
    if (targetSlot === "a") { setVideoPath(entry.path); setVideoName(entry.name); }
    else if (targetSlot === "b") { setBcamPath(entry.path); setBcamName(entry.name); }
    else { setCcamPath(entry.path); setCcamName(entry.name); }
  };

  const slotOf = (path: string): SlotKey | null => {
    if (path && path === videoPath) return "a";
    if (path && path === bcamPath) return "b";
    if (path && path === ccamPath) return "c";
    return null;
  };

  const activePrompt = promptMode === "default" ? DEFAULT_SEGMENT_PROMPT : customPrompt;
  const videoSelected = !!videoPath;

  const runSegmentation = async (t: TranscriptEntry[]) => {
    setPhase("segmenting");
    setSegError(null);
    let segs: SegmentGroup[] = [];
    try {
      const res = await fetch("/api/segment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: t, prompt: activePrompt }),
      });
      const data = await res.json();
      if (data.error) setSegError(data.error);
      else segs = data.segments ?? [];
    } catch (e: unknown) {
      setSegError(e instanceof Error ? e.message : "Segmentation failed");
    }
    onComplete(t, segs, videoPath, bcamPath, ccamPath);
  };

  const startTranscription = async () => {
    setPhase("transcribing");
    setTxStatus("extracting_audio");
    setTxStatusText("Extracting audio from video...");
    setTxProgress(10);
    setTxError(null);

    let receivedDone = false;
    const stderrChunks: string[] = [];

    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: videoPath }),
      });
      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const msg = JSON.parse(raw);
            console.log("[transcribe]", msg);
            if (msg.error) { setTxStatus("error"); setTxError(msg.error); return; }
            if (msg.stderr) {
              stderrChunks.push(msg.stderr);
              continue;
            }
            if (msg.status === "extracting_audio") {
              setTxStatus("extracting_audio"); setTxStatusText("Extracting audio..."); setTxProgress(20);
            } else if (msg.status === "audio_extracted") {
              setTxStatusText(`Audio extracted (${msg.size_mb} MB)`); setTxProgress(35);
            } else if (msg.status === "chunking_audio") {
              setTxStatus("chunking_audio"); setTxStatusText("Splitting into chunks..."); setTxProgress(40);
            } else if (msg.status === "chunking_complete") {
              setTxStatusText(`Split into ${msg.chunks} chunks`); setTxProgress(45);
            } else if (msg.status === "transcribing_chunk") {
              setTxStatus("transcribing");
              const pct = msg.total > 1 ? Math.round(45 + (msg.chunk / msg.total) * 45) : 60;
              setTxProgress(pct);
              setTxStatusText(msg.total > 1 ? `Transcribing chunk ${msg.chunk} / ${msg.total}...` : "Transcribing with Deepgram nova-3...");
            } else if (msg.status === "done" && msg.transcript) {
              receivedDone = true;
              setTxStatus("done"); setTxProgress(100);
              const t: TranscriptEntry[] = msg.transcript;
              const d = typeof msg.duration === "number" && msg.duration > 0 ? msg.duration : t.length > 0 ? t[t.length - 1].end : 0;
              setTxStatusText(`Done — ${t.length} utterances, ${formatTime(d)}`);
              if (t.length === 0) {
                setTxStatus("error");
                setTxError("Transcription returned 0 utterances. Check that the source video has audible speech.");
                return;
              }
              await runSegmentation(t);
            }
          } catch { /* ignore non-JSON */ }
        }
      }

      if (!receivedDone) {
        setTxStatus("error");
        const tail = stderrChunks.join("\n").slice(-1000).trim();
        console.error("[transcribe] stream ended without done. stderr:\n", tail || "(empty)");
        setTxError(
          `Transcription stream ended before completing. ${tail ? `Last stderr:\n${tail}` : "No stderr output — check the dev server logs."}`,
        );
      }
    } catch (e: unknown) {
      setTxStatus("error");
      setTxError(e instanceof Error ? e.message : "Transcription failed");
    }
  };

  const videoFiles = entries.filter((e) => e.type === "file" && isVideo(e.name));
  const dirs = entries.filter((e) => e.type === "directory" && !e.name.startsWith("."));
  const hasRelevantFiles = videoFiles.length > 0 || dirs.length > 0;

  return (
    <div className="max-w-2xl mx-auto">

      {/* ── BROWSE PHASE ── */}
      {phase === "browse" && (
        <>
          <div className="mb-6">
            <h2 className="text-2xl font-bold mb-1">Select File</h2>
            <p className="text-neutral-400 text-sm">Select the final MP4, then configure how to segment.</p>
          </div>

          {/* Camera slots: A required, B/C optional. Click a slot to make it the
              target, then click a file below to populate it. */}
          <div className="mb-6 space-y-3">
            {([
              { key: "a" as SlotKey, label: "A-cam", subtitle: "Final MP4 (master — transcribed and segmented)", path: videoPath, name: videoName, clear: () => { setVideoPath(""); setVideoName(""); }, required: true },
              { key: "b" as SlotKey, label: "B-cam", subtitle: "Alternate angle (optional, sync'd to A)", path: bcamPath, name: bcamName, clear: () => { setBcamPath(""); setBcamName(""); }, required: false },
              { key: "c" as SlotKey, label: "C-cam", subtitle: "Alternate angle (optional, sync'd to A)", path: ccamPath, name: ccamName, clear: () => { setCcamPath(""); setCcamName(""); }, required: false },
            ]).map((slot) => {
              const isTarget = targetSlot === slot.key;
              const hasFile = !!slot.path;
              const borderClass = hasFile
                ? "border-cyan-500 bg-cyan-950/20"
                : isTarget
                ? "border-amber-500/70 bg-amber-950/10"
                : "border-dashed border-neutral-700 bg-neutral-900/30";
              return (
                <button
                  key={slot.key}
                  onClick={() => setTargetSlot(slot.key)}
                  className={`w-full text-left rounded-xl border-2 p-4 transition-colors ${borderClass}`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                      {slot.label}{slot.required ? "" : " (optional)"}
                    </span>
                    <div className="flex items-center gap-2">
                      {isTarget && !hasFile && (
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">Target — pick a file below</span>
                      )}
                      {hasFile && (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); slot.clear(); }}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); slot.clear(); } }}
                          className="text-neutral-500 hover:text-neutral-300 text-xs cursor-pointer"
                          aria-label={`Clear ${slot.label}`}
                        >
                          ✕
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-neutral-500 mb-3">{slot.subtitle}</p>
                  {hasFile ? (
                    <div className="flex items-center gap-2"><span className="text-lg">🎬</span><span className="text-xs text-cyan-300 font-mono truncate">{slot.name}</span></div>
                  ) : (
                    <div className="flex items-center gap-2 text-neutral-600"><span className="text-lg">🎬</span><span className="text-xs">No file selected</span></div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Segment prompt — appears when video selected */}
          {videoSelected && (
            <div className="mb-6 rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
              <p className="text-sm font-semibold text-white mb-3">Segmentation Prompt</p>
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setPromptMode("default")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${promptMode === "default" ? "bg-cyan-600 text-white" : "bg-neutral-800 text-neutral-400 hover:text-white"}`}
                >
                  Default
                </button>
                <button
                  onClick={() => setPromptMode("custom")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${promptMode === "custom" ? "bg-cyan-600 text-white" : "bg-neutral-800 text-neutral-400 hover:text-white"}`}
                >
                  Custom
                </button>
              </div>

              {promptMode === "default" ? (
                <div className="bg-neutral-950 border border-neutral-700 rounded-lg p-3 mb-4 max-h-[120px] overflow-y-auto">
                  <p className="text-xs text-neutral-400 leading-relaxed">{DEFAULT_SEGMENT_PROMPT}</p>
                </div>
              ) : (
                <Textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="Describe how to segment this video — e.g. split by topic, by speaker, by caller..."
                  className="min-h-[100px] bg-neutral-950 border-neutral-700 text-white placeholder:text-neutral-600 mb-4 text-sm"
                />
              )}

              <Button
                onClick={startTranscription}
                disabled={promptMode === "custom" && !customPrompt.trim()}
                className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-semibold disabled:opacity-40"
              >
                Transcribe + Segment →
              </Button>
            </div>
          )}

          {!videoSelected && (
            <div className="mb-6">
              <div className="w-full rounded-xl border border-dashed border-neutral-700 px-5 py-3 text-center text-sm text-neutral-600">
                Select a file above to continue
              </div>
            </div>
          )}

          {/* File browser */}
          <div className="border border-neutral-800 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-neutral-900/60 border-b border-neutral-800">
              <span className="text-xs text-neutral-500 font-mono truncate flex-1">{dir || "Loading..."}</span>
              {parent && parent !== dir && (
                <button onClick={() => browse(parent)} disabled={browseLoading} className="text-xs text-neutral-400 hover:text-white shrink-0">↑ Up</button>
              )}
            </div>
            {browseError && <div className="text-red-400 text-xs p-4 bg-red-950/20">{browseError}</div>}
            {browseLoading && <div className="text-neutral-500 text-sm py-10 text-center">Loading...</div>}
            {!browseLoading && (
              <div className="divide-y divide-neutral-800/50">
                {dirs.map((entry) => (
                  <button key={entry.path} onClick={() => browse(entry.path)} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/40 transition-colors text-left">
                    <span className="text-base">📁</span>
                    <span className="flex-1 text-sm text-neutral-300 truncate">{entry.name}</span>
                    <span className="text-neutral-600 text-xs">›</span>
                  </button>
                ))}
                {videoFiles.map((entry) => {
                  const inSlot = slotOf(entry.path);
                  return (
                    <button key={entry.path} onClick={() => handleFileClick(entry)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 transition-all text-left ${inSlot ? "bg-cyan-950/30 hover:bg-cyan-950/50" : "hover:bg-neutral-800/40"}`}>
                      <span className="text-base">🎬</span>
                      <span className="flex-1 text-sm text-white truncate">{entry.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {inSlot
                          ? <span className="text-xs text-cyan-400">{inSlot.toUpperCase()}-cam ✓</span>
                          : <Badge variant="outline" className="text-xs border-cyan-800/50 text-cyan-500 bg-cyan-950/20">MP4</Badge>}
                        {entry.size && <span className="text-xs text-neutral-500">{formatSize(entry.size)}</span>}
                      </div>
                    </button>
                  );
                })}
                {!hasRelevantFiles && <div className="text-neutral-600 text-sm py-10 text-center">No relevant files here</div>}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── TRANSCRIBING PHASE ── */}
      {phase === "transcribing" && (
        <>
          <div className="mb-8">
            <h2 className="text-2xl font-bold mb-1">Transcribing</h2>
            <p className="text-neutral-400 text-sm">Deepgram nova-3 · word-level timestamps</p>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-5 mb-4">
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${txStatus === "done" ? "bg-green-500" : txStatus === "error" ? "bg-red-500" : "bg-cyan-500 animate-pulse"}`} />
              <span className="text-sm text-neutral-200 flex-1">{txStatusText}</span>
            </div>
            {txStatus !== "error" && <Progress value={txProgress} className="h-1.5" />}
            {txStatus === "error" && txError && (
              <div className="text-red-400 text-sm mt-2 p-3 bg-red-950/20 border border-red-900/30 rounded-lg">{txError}</div>
            )}
          </div>

          <div className="rounded-lg border border-neutral-800 px-3 py-2 flex items-center gap-2 text-xs text-neutral-500">
            <span>🎬</span><span className="truncate font-mono">{videoName}</span>
          </div>
        </>
      )}

      {/* ── SEGMENTING PHASE ── */}
      {phase === "segmenting" && (
        <>
          <div className="mb-8">
            <h2 className="text-2xl font-bold mb-1">Segmenting</h2>
            <p className="text-neutral-400 text-sm">Claude is identifying segments based on your prompt...</p>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-5">
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-cyan-500 animate-pulse shrink-0" />
              <span className="text-sm text-neutral-200">Analyzing transcript...</span>
            </div>
          </div>
          {segError && (
            <div className="text-red-400 text-sm mt-3 p-3 bg-red-950/20 border border-red-900/30 rounded-lg">{segError}</div>
          )}
        </>
      )}
    </div>
  );
}
