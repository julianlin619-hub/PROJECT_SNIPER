"use client";

import { useState } from "react";
import { TranscriptEntry, SegmentGroup } from "@/lib/types";
import FileBrowser from "@/components/segmenter/file-browser";
import TranscriptSegmentEditor from "@/components/segmenter/transcript-segment-editor";
import SegmentExportStep from "@/components/segmenter/segment-export-step";

type AppStep = "browse" | "edit" | "export";

export default function Home() {
  const [step, setStep] = useState<AppStep>("browse");
  const [filePath, setFilePath] = useState("");
  const [bcamPath, setBcamPath] = useState("");
  const [ccamPath, setCcamPath] = useState("");
  const [lav1Path, setLav1Path] = useState("");
  const [lav2Path, setLav2Path] = useState("");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [segments, setSegments] = useState<SegmentGroup[]>([]);

  const handleTranscribeComplete = (
    t: TranscriptEntry[],
    segs: SegmentGroup[],
    videoPath: string,
    bcam: string,
    ccam: string,
    lav1: string,
    lav2: string,
  ) => {
    setTranscript(t);
    setSegments(segs);
    setFilePath(videoPath);
    setBcamPath(bcam);
    setCcamPath(ccam);
    setLav1Path(lav1);
    setLav2Path(lav2);
    setStep("edit");
  };

  const stepLabels: { key: AppStep; label: string }[] = [
    { key: "browse", label: "1. Transcribe" },
    { key: "edit", label: "2. Edit Segments" },
    { key: "export", label: "3. Export" },
  ];

  const stepOrder: AppStep[] = ["browse", "edit", "export"];
  const currentIdx = stepOrder.indexOf(step);

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      {/* Top bar */}
      <div className="border-b border-neutral-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <span className="text-lg font-bold tracking-tight">🎬 SEGMENTER</span>
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
                      ? "bg-cyan-600 text-white font-medium"
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

        {step === "edit" && (
          <TranscriptSegmentEditor
            transcript={transcript}
            segments={segments}
            onChange={setSegments}
            onContinue={() => setStep("export")}
          />
        )}

        {step === "export" && (
          <SegmentExportStep
            segments={segments}
            filePath={filePath}
            bcamPath={bcamPath}
            ccamPath={ccamPath}
            lav1Path={lav1Path}
            lav2Path={lav2Path}
          />
        )}
      </div>
    </main>
  );
}
