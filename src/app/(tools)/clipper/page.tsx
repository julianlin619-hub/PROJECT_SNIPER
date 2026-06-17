"use client";

import { useState, useEffect } from "react";
import {
  AppStep,
  TranscriptEntry,
  LineDecision,
  EditableWord,
  SpeakerMap,
  Source,
  TranscribeCompleteInfo,
} from "@/lib/clipper/types";
import { autoDetectSpeakers } from "@/lib/clipper/speaker-utils";
import { buildEditableWords, filterShortClips } from "@/lib/clipper/editor";
import { dlog, installClientErrorCapture } from "@/lib/debug";
import FileBrowser from "@/components/clipper/file-browser";
import PromptStep from "@/components/clipper/prompt-step";
import VideoEditor from "@/components/clipper/video-editor";
import ExportStep from "@/components/clipper/export-step";


export default function Home() {
  const [step, setStep] = useState<AppStep>("browse");
  const [source, setSource] = useState<Source | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [speakerMap, setSpeakerMap] = useState<SpeakerMap>({});
  const [versionWords, setVersionWords] = useState<EditableWord[][]>([[]]);

  // Forward uncaught errors / promise rejections from the clipper UI to the terminal.
  useEffect(() => { installClientErrorCapture(); }, []);

  const primary = source?.angles.find((a) => a.audioSource) ?? source?.angles[0];
  const fileName = primary ? (primary.filePath.split("/").pop() || primary.filePath) : "";

  const handleTranscribeComplete = (
    t: TranscriptEntry[],
    src: Source,
    info: TranscribeCompleteInfo
  ) => {
    dlog("clipper:transcribe", "complete → page", {
      utterances: t.length,
      info,
      audioMode: src.audioMode,
      angles: src.angles.map((a) => ({ id: a.id, audioSource: a.audioSource, file: a.filePath.split("/").pop() })),
      lavs: { host: src.lav1Path?.split("/").pop(), guest: src.lav2Path?.split("/").pop() },
      duration: src.duration,
      fps: src.fps,
      audioChannels: src.audioChannels,
    });
    setSource(src);
    setTranscript(t);
    if (info.twoSpeakers) {
      // Two known speakers on fixed IDs: lav mode → Host/Guest, isolated stereo → Host/Caller.
      setSpeakerMap({ 0: "Host", 1: info.speakerKind === "guest" ? "Guest" : "Caller" });
    } else {
      const detected = autoDetectSpeakers(t);
      const remapped: SpeakerMap = Object.fromEntries(
        Object.entries(detected).map(([k, v]) => [Number(k), v === "Guest" ? "Caller" : v])
      );
      setSpeakerMap(remapped);
    }
    setStep("prompt");
  };

  // Step back one stage. (browse ⇄ prompt remounts FileBrowser fresh; use the
  // "Back to file selection" button inside the transcribe view to keep picks.)
  const goBack = () => {
    setStep((s) => (s === "export" ? "edit" : s === "edit" ? "prompt" : "browse"));
    dlog("clipper:nav", "back");
  };

  const handlePromptComplete = (decisions: LineDecision[]) => {
    const words = filterShortClips(buildEditableWords(transcript, decisions));
    dlog("clipper:prompt", "decisions → editable words", {
      decisions: decisions.length,
      removed: decisions.filter((d) => d.action === "remove").length,
      trimmed: decisions.filter((d) => d.action === "trim").length,
      words: words.length,
      keptWords: words.filter((w) => !w.removed).length,
    });
    setVersionWords([words]);
    setStep("edit");
  };


  return (
    <main className="reticle-field grain min-h-screen bg-background text-foreground">
      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {step !== "browse" && (
          <button
            onClick={goBack}
            className="mb-4 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            ← Back
          </button>
        )}

        {step === "browse" && (
          <FileBrowser onComplete={handleTranscribeComplete} />
        )}

        {step === "prompt" && (
          <PromptStep
            transcript={transcript}
            speakerMap={speakerMap}
            onComplete={handlePromptComplete}
          />
        )}

        {step === "edit" && (
          <VideoEditor
            words={versionWords[0] ?? []}
            onChange={(updated) => setVersionWords([updated])}
            onContinue={() => {
              const w = versionWords[0] ?? [];
              dlog("clipper:edit", "continue → export", {
                words: w.length,
                keptWords: w.filter((x) => !x.removed).length,
              });
              setStep("export");
            }}
            videoSrc={primary ? `/api/clipper/video?path=${encodeURIComponent(primary.filePath)}` : undefined}
            fileName={fileName}
            duration={source?.duration ?? 0}
          />
        )}

        {step === "export" && source && (
          <ExportStep
            versionWords={versionWords}
            source={source}
            transcript={transcript}
            speakerMap={speakerMap}
          />
        )}
      </div>
    </main>
  );
}
