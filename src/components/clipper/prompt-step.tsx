"use client";

import { useState, useCallback, useEffect } from "react";
import { TranscriptEntry, LineDecision, SpeakerMap } from "@/lib/clipper/types";
import { parseIndexedDecisions } from "@/lib/clipper/llm";
import { Button } from "@/components/ui/button";
import { DEFAULT_EDIT_PROMPT } from "@/prompts/clipper/default-edit";

interface Props {
  transcript: TranscriptEntry[];
  speakerMap?: SpeakerMap;
  onComplete: (decisions: LineDecision[]) => void;
}

function getLabel(t: TranscriptEntry, speakerMap?: SpeakerMap): string {
  const counts = new Map<number, number>();
  for (const w of t.words ?? []) {
    if (w.speaker != null) counts.set(w.speaker, (counts.get(w.speaker) ?? 0) + 1);
  }
  if (!counts.size) return "Speaker";
  const id = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return speakerMap?.[id] ?? `Speaker ${id}`;
}

/** Render the LLM Output tab — converts tool-call JSON to readable decision lines. */
function formatDecisionsView(raw: string, totalLines: number, streaming: boolean): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  // Try to parse as tool-call JSON and render human-readable
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as {
        decisions?: { index: number; action: string; trimmed_text?: string }[];
      };
      if (Array.isArray(parsed.decisions)) {
        return parsed.decisions
          .map((d) => {
            const action = d.action.toUpperCase();
            if (action === "TRIM" && d.trimmed_text) {
              return `[${d.index}] TRIM: ${d.trimmed_text}`;
            }
            return `[${d.index}] ${action}`;
          })
          .join("\n");
      }
    } catch {
      // Partial JSON during streaming — show progress indicator
      if (streaming) {
        // Count how many decisions we've seen so far in the partial JSON
        const matches = trimmed.match(/"index"\s*:\s*\d+/g);
        const count = matches?.length ?? 0;
        return `Generating decisions… (${count}/${totalLines} utterances)`;
      }
    }
  }

  // Legacy text format — show as-is
  return raw;
}

export default function PromptStep({ transcript, speakerMap, onComplete }: Props) {
  const [generating, setGenerating] = useState(false);
  const [rawOutput, setRawOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"decisions" | "transcript" | "edited">("decisions");

  const handleGenerate = useCallback(async () => {
    setError(null);
    setRawOutput("");
    setGenerating(true);

    try {
      const res = await fetch("/api/clipper/clip-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, prompt: DEFAULT_EDIT_PROMPT, speakerMap }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        accumulated += chunk;
        setRawOutput(accumulated);
      }

      setGenerating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setGenerating(false);
    }
  }, [transcript, speakerMap]);

  const handleContinue = useCallback(() => {
    try {
      const { decisions } = parseIndexedDecisions(rawOutput, transcript.length, 0);
      onComplete(decisions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse LLM output");
    }
  }, [rawOutput, transcript.length, onComplete]);

  useEffect(() => { handleGenerate(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <h2 className="text-2xl font-bold mb-1">Edit Decisions</h2>
      <p className="text-neutral-400 mb-4 text-sm">
        {generating ? "Generating…" : rawOutput ? "Review the decisions below, then continue." : "AI edits the transcript into clips for you to review."}
      </p>

      {rawOutput && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-950 overflow-hidden mb-5">
          <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800 bg-neutral-900">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setView("decisions")}
                className={`text-xs font-medium px-2 py-0.5 rounded ${view === "decisions" ? "bg-neutral-700 text-white" : "text-neutral-400 hover:text-neutral-200"}`}
              >
                LLM Output
              </button>
              <button
                onClick={() => setView("transcript")}
                className={`text-xs font-medium px-2 py-0.5 rounded ${view === "transcript" ? "bg-neutral-700 text-white" : "text-neutral-400 hover:text-neutral-200"}`}
              >
                Transcript
              </button>
              <button
                onClick={() => setView("edited")}
                className={`text-xs font-medium px-2 py-0.5 rounded ${view === "edited" ? "bg-amber-600 text-white" : "text-neutral-400 hover:text-neutral-200"}`}
              >
                Edited
              </button>
            </div>
            {generating && <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
          </div>
          <pre className="p-3 text-xs text-neutral-300 font-mono overflow-y-auto whitespace-pre-wrap" style={{ maxHeight: "480px" }}>
            {view === "decisions"
              ? formatDecisionsView(rawOutput, transcript.length, generating)
              : view === "transcript"
              ? transcript.map((t, i) => `[${i}] ${getLabel(t, speakerMap)}: ${t.text.trim()}`).join("\n")
              : (() => {
                  try {
                    const { decisions } = parseIndexedDecisions(rawOutput, transcript.length, 0);
                    const decisionMap = new Map(decisions.map((d) => [d.index, d]));
                    return transcript
                      .map((t, i) => {
                        const d = decisionMap.get(i);
                        const action = d?.action ?? "keep";
                        if (action === "remove") return null;
                        const text = action === "trim" && d?.text ? d.text : t.text.trim();
                        return `${getLabel(t, speakerMap)}: ${text}`;
                      })
                      .filter(Boolean)
                      .join("\n\n");
                  } catch {
                    return generating
                      ? "Generating edited preview…"
                      : "Edited preview unavailable — see LLM Output tab.";
                  }
                })()}
          </pre>
        </div>
      )}

      {!rawOutput && generating && (
        <div className="flex items-center gap-2 text-neutral-500 text-sm mb-5">
          <span className="inline-block w-0.5 h-4 bg-amber-400 animate-pulse align-middle" />
          <span>Generating edit decisions</span>
        </div>
      )}

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      <div className="flex gap-3">
        {!generating && rawOutput && (
          <Button onClick={handleContinue} className="px-6">
            Continue to edit →
          </Button>
        )}
        {!generating && (
          <Button variant="outline" onClick={handleGenerate} className="px-6 border-neutral-700 text-neutral-300 hover:text-white">
            {rawOutput ? "Retry" : "Generate Edit"}
          </Button>
        )}
      </div>
    </div>
  );
}
