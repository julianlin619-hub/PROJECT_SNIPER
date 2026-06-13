"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { TranscriptEntry, SegmentGroup } from "@/lib/types";

interface Props {
  onComplete: (
    transcript: TranscriptEntry[],
    segments: SegmentGroup[],
    videoPath: string,
    bcamPath: string,
    ccamPath: string,
    lav1Path: string,
    lav2Path: string,
  ) => void;
}

type SlotKey = "a" | "b" | "c" | "lav1" | "lav2";

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
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
  const [videoPath, setVideoPath] = useState("");
  const [videoName, setVideoName] = useState("");

  const [bcamPath, setBcamPath] = useState("");
  const [bcamName, setBcamName] = useState("");
  const [ccamPath, setCcamPath] = useState("");
  const [ccamName, setCcamName] = useState("");
  const [lav1Path, setLav1Path] = useState("");
  const [lav1Name, setLav1Name] = useState("");
  const [lav2Path, setLav2Path] = useState("");
  const [lav2Name, setLav2Name] = useState("");

  const [pickingSlot, setPickingSlot] = useState<SlotKey | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("browse");

  const [txStatus, setTxStatus] = useState<TxStatus>("extracting_audio");
  const [txStatusText, setTxStatusText] = useState("");
  const [txProgress, setTxProgress] = useState(0);
  const [txError, setTxError] = useState<string | null>(null);

  const [segError, setSegError] = useState<string | null>(null);

  const SLOT_LABELS: Record<SlotKey, string> = {
    a: "A-cam", b: "B-cam", c: "C-cam", lav1: "Lav 1", lav2: "Lav 2",
  };

  const pickFileFor = async (slot: SlotKey) => {
    if (pickingSlot) return;
    setPickingSlot(slot);
    setPickError(null);
    const isAudioSlot = slot === "lav1" || slot === "lav2";
    try {
      const res = await fetch("/api/segmenter/pick-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Pick ${isAudioSlot ? "audio" : "video"} for ${SLOT_LABELS[slot]}`,
          kind: isAudioSlot ? "audio" : "video",
        }),
      });
      const data = await res.json();
      if (data.canceled) return;
      if (data.error) { setPickError(data.error); return; }
      if (slot === "a") { setVideoPath(data.path); setVideoName(data.name); }
      else if (slot === "b") { setBcamPath(data.path); setBcamName(data.name); }
      else if (slot === "c") { setCcamPath(data.path); setCcamName(data.name); }
      else if (slot === "lav1") { setLav1Path(data.path); setLav1Name(data.name); }
      else { setLav2Path(data.path); setLav2Name(data.name); }
    } catch (e: unknown) {
      setPickError(e instanceof Error ? e.message : "Picker failed");
    } finally {
      setPickingSlot(null);
    }
  };

  const videoSelected = !!videoPath;

  const runSegmentation = async (t: TranscriptEntry[]) => {
    setPhase("segmenting");
    setSegError(null);
    let segs: SegmentGroup[] = [];
    try {
      const res = await fetch("/api/segmenter/segment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: t, prompt: DEFAULT_SEGMENT_PROMPT }),
      });
      const data = await res.json();
      if (data.error) setSegError(data.error);
      else segs = data.segments ?? [];
    } catch (e: unknown) {
      setSegError(e instanceof Error ? e.message : "Segmentation failed");
    }
    onComplete(t, segs, videoPath, bcamPath, ccamPath, lav1Path, lav2Path);
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
      const res = await fetch("/api/segmenter/transcribe", {
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

  return (
    <div className="max-w-2xl mx-auto">

      {/* ── BROWSE PHASE ── */}
      {phase === "browse" && (
        <>
          <div className="mb-6">
            <h2 className="text-2xl font-bold">Select File</h2>
          </div>

          {/* Camera slots: click a slot to open the native macOS file picker. */}
          <div className="mb-6 space-y-2">
            {([
              { key: "a" as SlotKey, label: "A-cam", subtitle: "Final MP4 (master)", path: videoPath, name: videoName, clear: () => { setVideoPath(""); setVideoName(""); }, required: true },
              { key: "b" as SlotKey, label: "B-cam", subtitle: "Alternate angle", path: bcamPath, name: bcamName, clear: () => { setBcamPath(""); setBcamName(""); }, required: false },
              { key: "c" as SlotKey, label: "C-cam", subtitle: "Alternate angle", path: ccamPath, name: ccamName, clear: () => { setCcamPath(""); setCcamName(""); }, required: false },
              { key: "lav1" as SlotKey, label: "Lav 1", subtitle: "Lavalier audio", path: lav1Path, name: lav1Name, clear: () => { setLav1Path(""); setLav1Name(""); }, required: false },
              { key: "lav2" as SlotKey, label: "Lav 2", subtitle: "Lavalier audio", path: lav2Path, name: lav2Name, clear: () => { setLav2Path(""); setLav2Name(""); }, required: false },
            ]).map((slot) => {
              const hasFile = !!slot.path;
              const isPicking = pickingSlot === slot.key;
              const borderClass = hasFile
                ? "border-cyan-500 bg-cyan-950/20"
                : isPicking
                ? "border-amber-500/70 bg-amber-950/10"
                : "border-dashed border-neutral-700 bg-neutral-900/30 hover:border-neutral-600 hover:bg-neutral-900/60";
              return (
                <button
                  key={slot.key}
                  onClick={() => pickFileFor(slot.key)}
                  disabled={!!pickingSlot && !isPicking}
                  className={`w-full text-left rounded-lg border-2 px-3 py-2 transition-colors disabled:opacity-50 ${borderClass}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-base shrink-0">
                      {hasFile ? (slot.key.startsWith("lav") ? "🎙️" : "🎬") : "📂"}
                    </span>
                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400 shrink-0">
                          {slot.label}{slot.required ? "" : " (opt)"}
                        </span>
                        <span className="text-[11px] text-neutral-500 truncate">{slot.subtitle}</span>
                      </div>
                      {hasFile ? (
                        <span className="text-xs text-cyan-300 font-mono truncate">{slot.name}</span>
                      ) : (
                        <span className="text-[11px] text-neutral-600">No file selected</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!hasFile && !isPicking && (
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Click to browse</span>
                      )}
                      {isPicking && (
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">Picker open…</span>
                      )}
                      {hasFile && (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); slot.clear(); }}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); slot.clear(); } }}
                          className="text-neutral-500 hover:text-neutral-300 text-xs cursor-pointer px-1"
                          aria-label={`Clear ${slot.label}`}
                        >
                          ✕
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {pickError && (
            <div className="mb-4 text-red-400 text-sm p-3 bg-red-950/20 border border-red-900/30 rounded-lg">
              {pickError}
            </div>
          )}

          {videoSelected && (
            <div className="mb-6">
              <Button
                onClick={startTranscription}
                className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-semibold"
              >
                Transcribe + Segment →
              </Button>
            </div>
          )}

          {!videoSelected && (
            <div className="mb-6">
              <div className="w-full rounded-xl border border-dashed border-neutral-700 px-5 py-3 text-center text-sm text-neutral-600">
                Pick an MP4 in the A-cam slot to continue
              </div>
            </div>
          )}
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
