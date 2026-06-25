"use client";

import { ReviewConfig, MODEL_OPTIONS, MODE_OPTIONS, SelectMode } from "@/lib/frameio/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ConfigStep({
  fileName,
  config,
  onChange,
  onRun,
}: {
  fileName: string | null;
  config: ReviewConfig;
  onChange: (c: ReviewConfig) => void;
  onRun: () => void;
}) {
  const set = (patch: Partial<ReviewConfig>) => onChange({ ...config, ...patch });

  return (
    <div className="rise-in max-w-xl">
      <h1 className="font-display text-2xl font-bold tracking-tight">Configure scan</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        <span className="text-foreground">{fileName}</span> · tune for a cheap test run first,
        then scale up.
      </p>

      <div className="mt-8 space-y-6">
        <Field
          label="Selection mode"
          hint="Visual (pHash) picks the settled frame of each run — works on any footage, incl. text over moving video. OCR groups by tesseract text — only for clean, static slideware."
        >
          <div className="flex gap-2">
            {MODE_OPTIONS.map((m) => (
              <button
                key={m.id}
                onClick={() => set({ mode: m.id as SelectMode })}
                className={`flex flex-col items-start rounded-md border px-3 py-2 text-left transition-colors ${
                  config.mode === m.id
                    ? "border-signal/60 bg-signal/10"
                    : "border-border bg-card/40 hover:border-border/80"
                }`}
              >
                <span className="text-sm font-medium">{m.label}</span>
                <span className="label text-muted-foreground/70">{m.hint}</span>
              </button>
            ))}
          </div>
        </Field>

        <Field
          label="Frames per second"
          hint="How densely to sample. 1 fps is plenty for slides; raise for fast-moving lower-thirds."
        >
          <Input
            type="number"
            min={0.1}
            step={0.1}
            value={config.fps}
            onChange={(e) => set({ fps: Math.max(0.1, Number(e.target.value) || 1) })}
            className="w-32"
          />
        </Field>

        {config.mode === "ocr" && (
          <Field
            label="OCR group threshold"
            hint="rapidfuzz token_set_ratio (0–100) for two frames' text to count as the same slide. Lower = group more aggressively."
          >
            <Input
              type="number"
              min={0}
              max={100}
              value={config.fuzz}
              onChange={(e) => set({ fuzz: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
              className="w-32"
            />
          </Field>
        )}

        <Field
          label="Max representatives"
          hint="Cap how many representative frames get sent to Claude — cheap test run. Blank = all (you'll still confirm over the safety limit)."
        >
          <Input
            type="number"
            min={1}
            placeholder="all"
            value={config.maxReps ?? ""}
            onChange={(e) =>
              set({ maxReps: e.target.value === "" ? null : Math.max(1, Number(e.target.value)) })
            }
            className="w-32"
          />
        </Field>

        <Field
          label="Max frames"
          hint="Cap extracted frames for a cheap test on a short clip. Blank = no cap."
        >
          <Input
            type="number"
            min={1}
            placeholder="none"
            value={config.maxFrames ?? ""}
            onChange={(e) =>
              set({ maxFrames: e.target.value === "" ? null : Math.max(1, Number(e.target.value)) })
            }
            className="w-32"
          />
        </Field>

        {config.mode === "visual" && (
          <Field
            label="Dedup threshold"
            hint="Perceptual-hash Hamming distance. Higher = collapse more near-identical frames (fewer API calls)."
          >
            <Input
              type="number"
              min={0}
              max={32}
              value={config.hamming}
              onChange={(e) => set({ hamming: Math.max(0, Number(e.target.value) || 0) })}
              className="w-32"
            />
          </Field>
        )}

        <Field label="Model" hint="Sonnet for quality; Haiku for cheaper, faster passes.">
          <div className="flex gap-2">
            {MODEL_OPTIONS.map((m) => (
              <button
                key={m.id}
                onClick={() => set({ model: m.id })}
                className={`flex flex-col items-start rounded-md border px-3 py-2 text-left transition-colors ${
                  config.model === m.id
                    ? "border-signal/60 bg-signal/10"
                    : "border-border bg-card/40 hover:border-border/80"
                }`}
              >
                <span className="text-sm font-medium">{m.label}</span>
                <span className="label text-muted-foreground/70">{m.hint}</span>
              </button>
            ))}
          </div>
        </Field>
      </div>

      <div className="mt-8 flex items-center gap-3">
        <Button onClick={onRun}>Run review →</Button>
        <span className="label text-muted-foreground/70">
          You&apos;ll confirm before any run over {config.confirmThreshold} API calls.
        </span>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start sm:gap-6">
      <div>
        <div className="label text-foreground">{label}</div>
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </div>
      <div className="sm:justify-self-end">{children}</div>
    </div>
  );
}
