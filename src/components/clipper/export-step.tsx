"use client";

import { useState } from "react";
import { EditableWord, TranscriptEntry, SpeakerMap, Source } from "@/lib/clipper/types";
import { computeFinalClips, generateExampleTranscript, generateExampleDecisions } from "@/lib/clipper/export";
import { generateFCPXML } from "@/lib/clipper/xml";
import { downloadBlob, downloadText } from "@/lib/clipper/download";
import { dlog, derror, summarize } from "@/lib/debug";
import { Download } from "lucide-react";

interface Props {
  versionWords: EditableWord[][];
  source: Source;
  transcript?: TranscriptEntry[];
  speakerMap?: SpeakerMap;
}

export default function ExportStep({ versionWords, source, transcript = [], speakerMap }: Props) {
  const [error, setError] = useState<string | null>(null);
  const primary = source.angles.find((a) => a.audioSource) ?? source.angles[0];
  const primaryFileName = primary.filePath.split("/").pop() || primary.filePath;
  const baseName = primaryFileName.replace(/\.\w+$/, "");
  const speakerLabels: [string, string] = [speakerMap?.[0] ?? "Speaker", speakerMap?.[1] ?? "Guest"];
  const isMultiCam = source.angles.length > 1;
  const isLavAudio = source.audioMode === "lavs" && !!source.lav1Path && !!source.lav2Path;

  const downloadExample = (words: EditableWord[], versionIdx: number) => {
    const output =
      'RAW TRANSCRIPT:\n\n' + generateExampleTranscript(transcript, words) +
      '\n\nDECISIONS:\n\n' + generateExampleDecisions(words, transcript) + '\n';
    downloadText(output, `example-v${versionIdx + 1}.txt`);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-1">Export</h2>
        <p className="text-neutral-400 text-sm">Download your edited output.</p>
      </div>
      <div className="space-y-3">
        <button
          onClick={() => {
            setError(null);
            try {
              dlog("clipper:export", "export FCPXML", {
                versions: versionWords.length,
                audioMode: source.audioMode ?? "camera",
                isMultiCam, isLavAudio, speakerLabels,
                lavs: { host: source.lav1Path?.split("/").pop(), guest: source.lav2Path?.split("/").pop() },
              });
              versionWords.forEach((words, i) => {
                const clips = computeFinalClips(words);
                const xml = generateFCPXML(clips, source, speakerLabels);
                dlog("clipper:export", `v${i + 1} → fcpxml`, {
                  clips: clips.length,
                  firstClip: clips[0] ? { start: clips[0].start, end: clips[0].end } : null,
                  totalSeconds: clips.reduce((a, c) => a + (c.end - c.start), 0),
                  xmlChars: xml.length,
                  xmlHead: summarize(xml, 600),
                });
                const blob = new Blob([xml], { type: "application/xml" });
                const suffix = versionWords.length > 1 ? `_clipper_v${i + 1}` : "_clipper";
                downloadBlob(blob, baseName + suffix + ".fcpxml");
              });
            } catch (e) { setError(e instanceof Error ? e.message : String(e)); derror("clipper:export", "FCPXML export failed", e); }
          }}
          className="w-full flex items-center justify-between px-5 py-4 rounded-xl border border-amber-500/50 bg-amber-950/30 hover:bg-amber-950/50 hover:border-amber-400 transition-all group"
        >
          <div className="text-left">
            <p className="text-sm font-semibold text-amber-200">
              {isMultiCam ? "Export A+B FCPXML" : "Export FCPXML"}
            </p>
            <p className="text-xs text-amber-400/70 mt-0.5">
              {versionWords.length > 1
                ? `${versionWords.length} files · one FCPXML per version`
                : isLavAudio
                ? isMultiCam
                  ? "Host + Guest cams stacked · clean Host/Guest lav audio · cameras muted"
                  : "Host cam · clean Host/Guest lav audio · camera muted"
                : isMultiCam
                ? "A on spine · B stacked on lane 1 · only A's audio plays"
                : "FCPXML generated from your edits · ready to import"}
            </p>
          </div>
          <span className="text-amber-400 group-hover:text-amber-200 transition-colors text-lg">⬇</span>
        </button>
        {error && <p className="text-sm text-red-400 px-1">{error}</p>}
      </div>

      <div className="mt-8">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-neutral-300">Prompt Examples</h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            Download a before/after example file — paste into the prompt to improve future edits.
          </p>
        </div>
        <div className="space-y-2">
          {versionWords.map((words, i) => (
            <button
              key={i}
              onClick={() => downloadExample(words, i)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 hover:border-neutral-500 transition-all group"
            >
              <div className="text-left">
                <p className="text-sm font-medium text-neutral-200">
                  {versionWords.length > 1 ? `Version ${i + 1} Transcript` : "Full Transcript"}
                </p>
                <p className="text-xs text-neutral-500 mt-0.5">
                  {versionWords.length > 1 ? `example-v${i + 1}.txt` : "example-full.txt"}
                </p>
              </div>
              <Download className="w-4 h-4 text-neutral-500 group-hover:text-neutral-200 transition-colors shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
