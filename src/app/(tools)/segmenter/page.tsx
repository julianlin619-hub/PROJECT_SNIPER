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

  return (
    <main className="reticle-field grain min-h-screen bg-background text-foreground">
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
