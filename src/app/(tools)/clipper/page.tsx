"use client";

import { useState } from "react";
import {
  AppStep,
  TranscriptEntry,
  LineDecision,
  EditableWord,
  SpeakerMap,
  Source,
} from "@/lib/clipper/types";
import { autoDetectSpeakers } from "@/lib/clipper/speaker-utils";
import { buildEditableWords, filterShortClips } from "@/lib/clipper/editor";
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

  const primary = source?.angles.find((a) => a.audioSource) ?? source?.angles[0];
  const fileName = primary ? (primary.filePath.split("/").pop() || primary.filePath) : "";

  const handleTranscribeComplete = (
    t: TranscriptEntry[],
    src: Source,
    stereo?: boolean
  ) => {
    setSource(src);
    setTranscript(t);
    if (stereo) {
      setSpeakerMap({ 0: "Host", 1: "Caller" });
    } else {
      const detected = autoDetectSpeakers(t);
      const remapped: SpeakerMap = Object.fromEntries(
        Object.entries(detected).map(([k, v]) => [Number(k), v === "Guest" ? "Caller" : v])
      );
      setSpeakerMap(remapped);
    }
    setStep("prompt");
  };

  const handlePromptComplete = (decisions: LineDecision[]) => {
    setVersionWords([filterShortClips(buildEditableWords(transcript, decisions))]);
    setStep("edit");
  };


  const stepLabels: { key: AppStep; label: string }[] = [
    { key: "browse", label: "1. Transcribe" },
    { key: "prompt", label: "2. Clip" },
    { key: "edit", label: "3. Edit" },
    { key: "export", label: "4. Export" },
  ];

  const stepOrder = stepLabels.map((s) => s.key);
  const currentIdx = stepOrder.indexOf(step);

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      {/* Top bar */}
      <div className="border-b border-neutral-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <span className="text-lg font-bold tracking-tight">✂️ CLIPPER</span>
          <div className="flex items-center gap-1.5 ml-4">
            {stepLabels.map((s, i) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    const targetIdx = stepOrder.indexOf(s.key);
                    if (targetIdx <= currentIdx) setStep(s.key);
                  }}
                  disabled={stepOrder.indexOf(s.key) > currentIdx}
                  className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                    step === s.key
                      ? "bg-violet-600 text-white font-medium"
                      : stepOrder.indexOf(s.key) < currentIdx
                      ? "text-neutral-400 hover:text-neutral-200 cursor-pointer"
                      : "text-neutral-700 cursor-not-allowed"
                  }`}
                >
                  {s.label}
                </button>
                {i < stepLabels.length - 1 && (
                  <span className="text-neutral-800">→</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
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
            onContinue={() => setStep("export")}
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
