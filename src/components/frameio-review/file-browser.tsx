"use client";

import { useState } from "react";
import { FileVideo, FolderOpen, ScanText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dlog } from "@/lib/debug";

export default function FileBrowser({
  filePath,
  fileName,
  onPicked,
  onContinue,
}: {
  filePath: string | null;
  fileName: string | null;
  onPicked: (path: string, name: string) => void;
  onContinue: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/frameio-review/pick-file", { method: "POST" });
      const data = await res.json();
      if (data.canceled) return;
      if (data.error) throw new Error(data.error);
      dlog("frameio:pick", "picked → page", { name: data.name });
      onPicked(data.path, data.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to pick a file");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rise-in">
      <div className="mb-8 flex items-center gap-3">
        <ScanText className="size-5 text-signal" strokeWidth={2} />
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Frame Review</h1>
          <p className="text-sm text-muted-foreground">
            Scan an MP4 for on-screen text errors — typos, spelling, grammar, broken formatting.
          </p>
        </div>
      </div>

      <button
        onClick={pick}
        disabled={busy}
        className="group flex w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/40 px-6 py-16 transition-colors hover:border-signal/50 hover:bg-card/70 disabled:opacity-60"
      >
        <FolderOpen className="size-7 text-muted-foreground/60 transition-colors group-hover:text-signal" />
        <span className="label text-muted-foreground">
          {busy ? "Opening picker…" : "Choose an MP4"}
        </span>
      </button>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      {filePath && (
        <div className="mt-6 flex items-center justify-between rounded-lg border border-border bg-card/60 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <FileVideo className="size-4 shrink-0 text-signal" />
            <span className="truncate text-sm text-foreground">{fileName}</span>
          </div>
          <Button onClick={onContinue} size="sm">
            Configure →
          </Button>
        </div>
      )}
    </div>
  );
}
