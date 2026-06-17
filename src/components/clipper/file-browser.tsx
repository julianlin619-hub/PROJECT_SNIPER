"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { TranscriptEntry, WordTiming, Source, TranscribeCompleteInfo } from "@/lib/clipper/types";
import { downloadText } from "@/lib/clipper/download";
import { dlog, dlogLocal, derror, summarize } from "@/lib/debug";

function getUtteranceSpeaker(words: WordTiming[] | undefined): number | null {
  const counts = new Map<number, number>();
  for (const w of words ?? []) {
    if (w.speaker != null) counts.set(w.speaker, (counts.get(w.speaker) ?? 0) + 1);
  }
  if (!counts.size) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

interface Props {
  onComplete: (
    transcript: TranscriptEntry[],
    source: Source,
    info: TranscribeCompleteInfo
  ) => void;
}

// Picker is organized "by person": Host (camera + mic) and Guest (camera + mic).
type SlotKey = "hostCam" | "guestCam" | "hostMic" | "guestMic";

type PickedFile = { path: string; name: string };

const VIDEO_EXT = /\.(mp4|mov|m4v|avi|mkv|mpg|mpeg|webm|wmv|flv)$/i;
const AUDIO_EXT = /\.(wav|mp3|m4a|aac|flac|ogg|opus|aif|aiff|caf|wma)$/i;

// Rank a filename so an obvious host file sorts before a guest file. Files with no
// hint keep their picked order. Lower score = host slot, higher = guest slot.
function personHintScore(name: string): number {
  const n = name.toLowerCase();
  if (/\bhost\b|\bh[\s_-]?cam\b|\bh[\s_-]?mic\b/.test(n)) return 0;
  if (/\bguest\b|\bg[\s_-]?cam\b|\bg[\s_-]?mic\b/.test(n)) return 1;
  return 0.5;
}

// Split a batch of picked files into the Host/Guest camera + mic slots by file
// type, refined by host/guest filename hints. Leftovers (extra files / unknown
// types) are returned so the UI can report them.
function autoAssign(files: PickedFile[]): {
  assigned: Partial<Record<SlotKey, PickedFile>>;
  leftovers: PickedFile[];
} {
  const videos = files.filter((f) => VIDEO_EXT.test(f.name));
  const audios = files.filter((f) => AUDIO_EXT.test(f.name));
  const unknown = files.filter((f) => !VIDEO_EXT.test(f.name) && !AUDIO_EXT.test(f.name));

  videos.sort((a, b) => personHintScore(a.name) - personHintScore(b.name) || a.name.localeCompare(b.name));
  audios.sort((a, b) => personHintScore(a.name) - personHintScore(b.name) || a.name.localeCompare(b.name));

  const assigned: Partial<Record<SlotKey, PickedFile>> = {};
  const camSlots: SlotKey[] = ["hostCam", "guestCam"];
  const micSlots: SlotKey[] = ["hostMic", "guestMic"];
  videos.slice(0, 2).forEach((f, i) => (assigned[camSlots[i]] = f));
  audios.slice(0, 2).forEach((f, i) => (assigned[micSlots[i]] = f));

  const leftovers = [...videos.slice(2), ...audios.slice(2), ...unknown];
  return { assigned, leftovers };
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type Phase = "browse" | "transcribing";
type TxStatus = "extracting_audio" | "chunking_audio" | "transcribing" | "done" | "error";

const SLOT_LABELS: Record<SlotKey, string> = {
  hostCam: "Host camera", guestCam: "Guest camera", hostMic: "Host mic", guestMic: "Guest mic",
};

export default function FileBrowser({ onComplete }: Props) {
  // Internal field names map to the Source model: host cam = primary angle A,
  // guest cam = stacked angle B, host mic = lav1 (speaker 0), guest mic = lav2 (speaker 1).
  const [aCamPath, setACamPath] = useState("");
  const [aCamName, setACamName] = useState("");
  const [bCamPath, setBCamPath] = useState("");
  const [bCamName, setBCamName] = useState("");
  const [lav1Path, setLav1Path] = useState("");
  const [lav1Name, setLav1Name] = useState("");
  const [lav2Path, setLav2Path] = useState("");
  const [lav2Name, setLav2Name] = useState("");

  const [pickingSlot, setPickingSlot] = useState<SlotKey | null>(null);
  const [pickingMulti, setPickingMulti] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [autoNotice, setAutoNotice] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("browse");

  const [txStatus, setTxStatus] = useState<TxStatus>("extracting_audio");
  const [txStatusText, setTxStatusText] = useState("");
  const [txProgress, setTxProgress] = useState(0);
  const [txError, setTxError] = useState<string | null>(null);

  const [isStereo, setIsStereo] = useState(false);
  const [isLavMode, setIsLavMode] = useState(false);
  const [leftChState, setLeftChState] = useState<"idle" | "extracting" | "transcribing" | "done">("idle");
  const [rightChState, setRightChState] = useState<"idle" | "extracting" | "transcribing" | "done">("idle");

  const [pendingComplete, setPendingComplete] = useState<{
    transcript: TranscriptEntry[];
    duration: number;
    fps: number;
    stereo: boolean;
    lavMode: boolean;
  } | null>(null);

  // Two-track display (stereo channels OR two lav mics). Label of speaker 1 differs:
  // a caller for isolated stereo, the guest for lav mics.
  const twoTrack = isStereo || isLavMode;
  const secondLabel = isLavMode ? "Guest" : "Caller";
  const labelFor = (spk: number | null): string =>
    spk === 0 ? "Host" : spk === 1 ? secondLabel : spk != null ? `Speaker ${spk}` : "Speaker";

  const applyToSlot = (slot: SlotKey, file: PickedFile) => {
    if (slot === "hostCam") { setACamPath(file.path); setACamName(file.name); }
    else if (slot === "guestCam") { setBCamPath(file.path); setBCamName(file.name); }
    else if (slot === "hostMic") { setLav1Path(file.path); setLav1Name(file.name); }
    else { setLav2Path(file.path); setLav2Name(file.name); }
  };

  const clearSlot = (slot: SlotKey) => {
    if (slot === "hostCam") { setACamPath(""); setACamName(""); }
    else if (slot === "guestCam") { setBCamPath(""); setBCamName(""); }
    else if (slot === "hostMic") { setLav1Path(""); setLav1Name(""); }
    else { setLav2Path(""); setLav2Name(""); }
  };

  const pickFileFor = async (slot: SlotKey) => {
    if (pickingSlot) return;
    setPickingSlot(slot);
    setPickError(null);
    const isAudioSlot = slot === "hostMic" || slot === "guestMic";
    try {
      const res = await fetch("/api/clipper/native-pick", {
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
      dlog("clipper:pick", `picked ${SLOT_LABELS[slot]}`, { path: data.path });
      applyToSlot(slot, { path: data.path, name: data.name });
    } catch (e: unknown) {
      setPickError(e instanceof Error ? e.message : "Picker failed");
      derror("clipper:pick", "single pick failed", e);
    } finally {
      setPickingSlot(null);
    }
  };

  // Open the native picker in multi-select mode, then auto-route every chosen file
  // into a Host/Guest camera or mic slot.
  const pickMultiple = async () => {
    if (pickingSlot || pickingMulti) return;
    setPickingMulti(true);
    setPickError(null);
    setAutoNotice(null);
    try {
      const res = await fetch("/api/clipper/native-pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Select all clips — cameras and mics together",
          kind: "any",
          multiple: true,
        }),
      });
      const data = await res.json();
      if (data.canceled) return;
      if (data.error) { setPickError(data.error); return; }
      const files: PickedFile[] = data.files ?? [];
      if (files.length === 0) return;

      const { assigned, leftovers } = autoAssign(files);
      dlog("clipper:pick", "bulk auto-sort", {
        picked: files.map((f) => f.name),
        assigned: Object.fromEntries(Object.entries(assigned).map(([k, v]) => [k, v?.name])),
        leftovers: leftovers.map((f) => f.name),
      });
      const order: SlotKey[] = ["hostCam", "guestCam", "hostMic", "guestMic"];
      for (const slot of order) {
        const f = assigned[slot];
        if (f) applyToSlot(slot, f);
      }

      const placed = order.filter((s) => assigned[s]).map((s) => SLOT_LABELS[s]).join(", ");
      let notice = placed ? `Auto-sorted: ${placed}.` : "No camera or audio files recognized.";
      if (leftovers.length > 0) {
        notice += ` ${leftovers.length} file${leftovers.length !== 1 ? "s" : ""} didn't fit (2 cameras + 2 mics): ${leftovers.map((f) => f.name).join(", ")}.`;
      }
      setAutoNotice(notice);
    } catch (e: unknown) {
      setPickError(e instanceof Error ? e.message : "Picker failed");
      derror("clipper:pick", "bulk pick failed", e);
    } finally {
      setPickingMulti(false);
    }
  };

  const downloadTranscriptTxt = (transcript: TranscriptEntry[], second: string) => {
    const lines = transcript.map((entry, i) => {
      const spk = getUtteranceSpeaker(entry.words);
      const label = spk === 0 ? "Host" : spk === 1 ? second : spk != null ? `Speaker ${spk}` : "Speaker";
      return `[${i}] ${label}: ${entry.text.trim()}`;
    });
    downloadText(`## Transcript\n${lines.join("\n")}`, "transcript.txt");
  };

  const startTranscription = async () => {
    const useLavs = !!(lav1Path && lav2Path);
    dlog("clipper:transcribe", "start", {
      mode: useLavs ? "lavs (host+guest mics)" : "camera (Host cam audio)",
      hostCam: aCamName, guestCam: bCamName || null,
      hostMic: lav1Name || null, guestMic: lav2Name || null,
    });
    setPhase("transcribing");
    setIsLavMode(useLavs);
    setIsStereo(false);
    setLeftChState("idle");
    setRightChState("idle");
    setTxStatus("extracting_audio");
    setTxStatusText(useLavs ? "Preparing host + guest mics..." : "Extracting audio from video...");
    setTxProgress(10);
    setTxError(null);

    try {
      const res = await fetch("/api/clipper/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          useLavs ? { hostLavPath: lav1Path, guestLavPath: lav2Path } : { filePath: aCamPath }
        ),
      });
      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let stereo = false;
      const lavMode = useLavs;

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
            // Python stderr is mirrored to the terminal by the transcribe route, so
            // only echo it to the browser console here (don't double-forward).
            if (msg.stderr) { dlogLocal("clipper:transcribe", "py stderr", msg.stderr); continue; }
            dlog("clipper:transcribe", `SSE ${msg.status ?? (msg.error ? "error" : "msg")}`,
              msg.status === "done"
                ? { utterances: msg.transcript?.length, duration: msg.duration, language: msg.language, sample: summarize(msg.transcript) }
                : msg);
            if (msg.error) { setTxStatus("error"); setTxError(msg.error); derror("clipper:transcribe", "python reported error", msg.error); return; }
            if (msg.status === "extracting_channels") {
              stereo = true;
              setIsStereo(true);
              setLeftChState("extracting");
              setRightChState("extracting");
              setTxStatusText("Stereo detected — splitting channels...");
              setTxProgress(20);
            }
            else if (msg.status === "audio_extracted" && stereo) {
              setLeftChState("idle");
              setRightChState("idle");
              setTxProgress(35);
            }
            else if (msg.status === "extracting_audio") { setTxStatus("extracting_audio"); setTxStatusText("Extracting audio..."); setTxProgress(20); }
            else if (msg.status === "audio_extracted") { setTxStatusText(`Audio ready (${msg.size_mb} MB)`); setTxProgress(35); }
            else if (msg.status === "chunking_audio") { setTxStatus("chunking_audio"); setTxStatusText("Splitting into chunks..."); setTxProgress(40); }
            else if (msg.status === "chunking_complete") { setTxStatusText(`Split into ${msg.chunks} chunks`); setTxProgress(45); }
            else if (msg.status === "transcribing_chunk") {
              setTxStatus("transcribing");
              const pct = msg.total > 1 ? Math.round(45 + (msg.chunk / msg.total) * 45) : 60;
              setTxProgress(pct);
              if ((stereo || lavMode) && msg.total === 2) {
                if (msg.chunk === 1) {
                  setLeftChState("transcribing");
                  setTxStatusText(lavMode ? "Transcribing host mic..." : "Transcribing host channel (left)...");
                } else {
                  setLeftChState("done");
                  setRightChState("transcribing");
                  setTxStatusText(lavMode ? "Transcribing guest mic..." : "Transcribing caller channel (right)...");
                }
              } else {
                setTxStatusText(msg.total > 1 ? `Transcribing chunk ${msg.chunk} / ${msg.total}...` : "Transcribing with Deepgram nova-3...");
              }
            }
            else if (msg.status === "done" && msg.transcript) {
              if (stereo || lavMode) { setLeftChState("done"); setRightChState("done"); }
              setTxStatus("done");
              setTxProgress(100);
              const t: TranscriptEntry[] = msg.transcript;
              const d = typeof msg.duration === "number" && msg.duration > 0 ? msg.duration : t.length > 0 ? t[t.length - 1].end : 0;
              const f = typeof msg.fps === "number" && msg.fps > 0 ? msg.fps : 30;
              setTxStatusText(`Done — ${t.length} utterances, ${formatTime(d)}`);
              setPendingComplete({ transcript: t, duration: d, fps: f, stereo, lavMode });
            }
          } catch { /* ignore non-JSON */ }
        }
      }
    } catch (e: unknown) {
      setTxStatus("error");
      setTxError(e instanceof Error ? e.message : "Transcription failed");
      derror("clipper:transcribe", "stream/fetch failed", e);
    }
  };

  const canTranscribe = !!aCamPath;
  const lavsReady = !!(lav1Path && lav2Path);

  const buildSource = (
    duration: number,
    fps: number,
    audioMode: "camera" | "lavs",
    audioChannels: 1 | 2
  ): Source => ({
    angles: bCamPath
      ? [
          { id: "A", filePath: aCamPath, audioSource: true },
          { id: "B", filePath: bCamPath, audioSource: false },
        ]
      : [{ id: "A", filePath: aCamPath, audioSource: true }],
    duration,
    fps,
    audioChannels,
    audioMode,
    lav1Path: lav1Path || undefined,
    lav2Path: lav2Path || undefined,
  });

  const finishTranscription = () => {
    if (!pendingComplete) return;
    const pc = pendingComplete;
    const info: TranscribeCompleteInfo = {
      twoSpeakers: pc.lavMode || pc.stereo,
      speakerKind: pc.lavMode ? "guest" : pc.stereo ? "caller" : "diarized",
      audioMode: pc.lavMode ? "lavs" : "camera",
    };
    onComplete(
      pc.transcript,
      buildSource(pc.duration, pc.fps, info.audioMode, pc.stereo ? 2 : 1),
      info,
    );
  };

  // Picker layout: two person groups, each with a camera + a mic sub-slot.
  const GROUPS: { person: string; slots: { key: SlotKey; label: string; path: string; name: string; required: boolean }[] }[] = [
    {
      person: "Host",
      slots: [
        { key: "hostCam", label: "Camera", path: aCamPath, name: aCamName, required: true },
        { key: "hostMic", label: "Lav mic", path: lav1Path, name: lav1Name, required: false },
      ],
    },
    {
      person: "Guest",
      slots: [
        { key: "guestCam", label: "Camera", path: bCamPath, name: bCamName, required: false },
        { key: "guestMic", label: "Lav mic", path: lav2Path, name: lav2Name, required: false },
      ],
    },
  ];

  const selectedFiles = ([
    { key: "hostCam" as SlotKey, name: aCamName, audio: false },
    { key: "guestCam" as SlotKey, name: bCamName, audio: false },
    { key: "hostMic" as SlotKey, name: lav1Name, audio: true },
    { key: "guestMic" as SlotKey, name: lav2Name, audio: true },
  ]).filter((f) => f.name);

  return (
    <div className="max-w-2xl mx-auto">

      {/* ── BROWSE PHASE ── */}
      {phase === "browse" && (
        <>
          <div className="mb-4">
            <h2 className="text-2xl font-bold mb-1">Select Files</h2>
            <p className="text-neutral-400 text-sm">
              Add each person&apos;s camera and lav mic. The Host camera is required; everything else is optional.
            </p>
          </div>

          {/* Bulk add: pick all clips at once; auto-sort into Host/Guest slots. */}
          <button
            onClick={pickMultiple}
            disabled={!!pickingSlot || pickingMulti}
            className="w-full mb-3 rounded-lg border-2 border-dashed border-amber-700/60 bg-amber-950/10 hover:border-amber-500 hover:bg-amber-950/25 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-3 text-left transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-base shrink-0">{pickingMulti ? "⏳" : "✨"}</span>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm font-semibold text-amber-200">
                  {pickingMulti ? "Picker open…" : "Add all clips — auto-sort"}
                </span>
                <span className="text-[11px] text-amber-400/70">
                  Select cameras + mics together; they fill the Host/Guest slots automatically
                </span>
              </div>
            </div>
          </button>

          {autoNotice && (
            <div className="mb-3 text-[11px] text-neutral-400 p-2.5 bg-neutral-900/40 border border-neutral-800 rounded-lg">
              {autoNotice}
            </div>
          )}

          {/* Person groups */}
          <div className="mb-4 space-y-3">
            {GROUPS.map((group) => (
              <div key={group.person} className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2 px-1">
                  {group.person}
                </div>
                <div className="space-y-2">
                  {group.slots.map((slot) => {
                    const isAudio = slot.key === "hostMic" || slot.key === "guestMic";
                    const hasFile = !!slot.path;
                    const isPicking = pickingSlot === slot.key;
                    const borderClass = hasFile
                      ? "border-emerald-500 bg-emerald-950/20"
                      : isPicking
                      ? "border-amber-500/70 bg-amber-950/10"
                      : "border-dashed border-neutral-700 bg-neutral-900/30 hover:border-neutral-600 hover:bg-neutral-900/60";
                    return (
                      <button
                        key={slot.key}
                        onClick={() => pickFileFor(slot.key)}
                        disabled={pickingMulti || (!!pickingSlot && !isPicking)}
                        className={`w-full text-left rounded-lg border-2 px-3 py-2 transition-colors disabled:opacity-50 ${borderClass}`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-base shrink-0">{hasFile ? (isAudio ? "🎙️" : "🎬") : "📂"}</span>
                          <div className="flex flex-col min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                              <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400 shrink-0">
                                {slot.label}{slot.required ? "" : " (opt)"}
                              </span>
                              <span className="text-[11px] text-neutral-500 truncate">
                                {isAudio ? "Clean per-person audio" : "Video angle"}
                              </span>
                            </div>
                            {hasFile ? (
                              <span className="text-xs text-emerald-300 font-mono truncate">{slot.name}</span>
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
                                onClick={(e) => { e.stopPropagation(); clearSlot(slot.key); }}
                                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); clearSlot(slot.key); } }}
                                className="text-neutral-500 hover:text-neutral-300 text-xs cursor-pointer px-1"
                                aria-label={`Clear ${SLOT_LABELS[slot.key]}`}
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
              </div>
            ))}
          </div>

          {/* Lav-mode hint */}
          <div className={`mb-4 text-[11px] p-2.5 rounded-lg border ${lavsReady ? "text-emerald-300/90 border-emerald-900/40 bg-emerald-950/20" : "text-neutral-400 border-neutral-800 bg-neutral-900/40"}`}>
            {lavsReady
              ? "✓ Both mics set — the transcript uses the clean lav audio and labels Host/Guest exactly. The export will play the lav audio with the cameras' audio muted."
              : "Add both lav mics to transcribe from clean per-person audio (otherwise the Host camera's own audio is used)."}
          </div>

          {pickError && (
            <div className="mb-4 text-red-400 text-sm p-3 bg-red-950/20 border border-red-900/30 rounded-lg">
              {pickError}
            </div>
          )}

          <div className="mb-6">
            <Button
              onClick={startTranscription}
              disabled={!canTranscribe}
              className="w-full bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-30 disabled:cursor-not-allowed font-semibold"
            >
              {canTranscribe ? "Transcribe →" : "Select a Host camera to transcribe"}
            </Button>
          </div>
        </>
      )}

      {phase === "transcribing" && (
        <>
          {(txStatus === "done" || txStatus === "error") && (
            <button
              onClick={() => { dlog("clipper:transcribe", "back to file selection"); setPhase("browse"); }}
              className="mb-4 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              ← Back to file selection
            </button>
          )}
          <div className="mb-8">
            <h2 className="text-2xl font-bold mb-1">Transcribing</h2>
            <p className="text-neutral-400 text-sm">
              {isLavMode
                ? "Two lav mics — each sent to Deepgram separately for an exact Host/Guest split."
                : isStereo
                ? "Stereo file — each channel sent to Deepgram separately for precise speaker identification."
                : "Deepgram nova-3 · word-level timestamps · speaker diarization"}
            </p>
          </div>

          {twoTrack ? (
            <>
              <div className="flex gap-4 mb-4">
                {[
                  { label: isLavMode ? "Host mic" : "Left Channel", role: "Host", state: leftChState },
                  { label: isLavMode ? "Guest mic" : "Right Channel", role: secondLabel, state: rightChState },
                ].map(({ label, role, state }) => (
                  <div key={label} className="flex-1 rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs text-neutral-500 uppercase tracking-wider font-medium">{label}</span>
                      {state === "done" && <span className="text-xs text-green-400 font-medium">✓ Done</span>}
                    </div>
                    <p className="text-base font-semibold text-white mb-4">{role}</p>
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        state === "done" ? "bg-green-500" :
                        state === "transcribing" ? "bg-blue-500 animate-pulse" :
                        state === "extracting" ? "bg-yellow-500 animate-pulse" :
                        "bg-neutral-700"
                      }`} />
                      <span className="text-sm text-neutral-400">
                        {state === "done" ? "Done" :
                         state === "transcribing" ? "Transcribing..." :
                         state === "extracting" ? "Extracting..." :
                         "Waiting"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <Progress value={txProgress} className="h-1.5 mb-4" />
            </>
          ) : (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-5 mb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${txStatus === "done" ? "bg-green-500" : txStatus === "error" ? "bg-red-500" : "bg-amber-500 animate-pulse"}`} />
                <span className="text-sm text-neutral-200 flex-1">{txStatusText}</span>
              </div>
              {txStatus !== "error" && <Progress value={txProgress} className="h-1.5" />}
              {txStatus === "error" && txError && (
                <div className="text-red-400 text-sm mt-2 p-3 bg-red-950/20 border border-red-900/30 rounded-lg">{txError}</div>
              )}
            </div>
          )}

          {txStatus === "done" && pendingComplete && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-950 overflow-hidden mb-4">
              <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800 bg-neutral-900">
                <span className="text-xs font-medium text-neutral-400">Transcript</span>
                <span className="text-xs text-neutral-600">{pendingComplete.transcript.length} utterances</span>
              </div>
              <div className="p-3 space-y-2 overflow-y-auto" style={{ maxHeight: "360px" }}>
                {pendingComplete.transcript.map((entry, i) => {
                  const spk = getUtteranceSpeaker(entry.words);
                  const label = labelFor(spk);
                  const isRight = label !== "Host";
                  return (
                    <div key={i} className={`flex flex-col gap-0.5 ${isRight ? "items-end" : "items-start"}`}>
                      <span className="text-[9px] text-neutral-600 px-1">{label}</span>
                      <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                        isRight
                          ? "bg-amber-600 text-white rounded-br-sm"
                          : "bg-neutral-700 text-neutral-100 rounded-bl-sm"
                      }`}>
                        {entry.text}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {txStatus === "done" && pendingComplete && (
            <div className="flex gap-3 mt-4 mb-4">
              <button
                onClick={() => downloadTranscriptTxt(pendingComplete.transcript, secondLabel)}
                className="flex-1 text-xs px-4 py-2 rounded-lg border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
              >
                Download TXT
              </button>
              <button
                onClick={finishTranscription}
                className="flex-1 text-xs px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium transition-colors"
              >
                Continue to Edit →
              </button>
            </div>
          )}

          <div className={`grid gap-3 text-xs text-neutral-500 ${selectedFiles.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
            {selectedFiles.map((f) => (
              <div key={f.key} className="rounded-lg border border-neutral-800 px-3 py-2 flex items-center gap-2">
                <span>{f.audio ? "🎙️" : "🎬"}</span>
                <span className="truncate font-mono">{f.name}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
