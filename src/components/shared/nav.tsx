"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TOOLS = [
  { href: "/segmenter", label: "SEGMENTER", hint: "01", soon: false },
  { href: "/clipper", label: "CLIPPER", hint: "02", soon: false },
  { href: "/polisher", label: "POLISHER", hint: "03", soon: true },
] as const;

// Auxiliary utilities — set apart from the three numbered pipeline stages and
// rendered smaller. FRAME.IO REVIEW is a standalone QC pass, not a pipeline step.
const UTILS = [
  { href: "/frameio-review", label: "FRAME.IO REVIEW", hint: "QC", soon: false },
] as const;

export default function Nav() {
  const pathname = usePathname();

  return (
    <div className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3 sm:px-10">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="tally inline-block size-1.5 rounded-full" />
          <span className="label text-foreground/80 transition-colors group-hover:text-foreground">
            PROJECT&nbsp;SNIPER
          </span>
        </Link>

        <span aria-hidden className="h-4 w-px bg-border" />

        <nav className="flex items-center gap-1">
          {TOOLS.map((t) => {
            // Locked tool — render a non-interactive label until it ships.
            if (t.soon) {
              return (
                <span
                  key={t.href}
                  aria-disabled="true"
                  title="Coming soon"
                  className="flex cursor-not-allowed items-center gap-2 px-3 py-1.5 text-muted-foreground/40"
                >
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground/30">
                    {t.hint}
                  </span>
                  <span className="label">{t.label}</span>
                  <span className="label rounded-full border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground/50">
                    SOON
                  </span>
                </span>
              );
            }

            const active = pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`group relative flex items-center gap-2 px-3 py-1.5 transition-colors ${
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span
                  className={`font-mono text-[10px] tabular-nums ${
                    active ? "text-signal" : "text-muted-foreground/50"
                  }`}
                >
                  {t.hint}
                </span>
                <span className="label">{t.label}</span>
                {active && (
                  <span className="absolute inset-x-2 -bottom-3 h-px bg-signal" />
                )}
              </Link>
            );
          })}

          {/* Auxiliary utilities — divider, then smaller secondary tabs. */}
          <span aria-hidden className="mx-1 h-4 w-px bg-border" />
          {UTILS.map((u) => {
            const active = pathname.startsWith(u.href);
            return (
              <Link
                key={u.href}
                href={u.href}
                aria-current={active ? "page" : undefined}
                className={`group relative flex items-center gap-1.5 px-2 py-1.5 transition-colors ${
                  active ? "text-foreground" : "text-muted-foreground/80 hover:text-foreground"
                }`}
              >
                <span
                  className={`font-mono text-[9px] tabular-nums ${
                    active ? "text-signal" : "text-muted-foreground/40"
                  }`}
                >
                  {u.hint}
                </span>
                <span className="label text-[10px]">{u.label}</span>
                {active && (
                  <span className="absolute inset-x-2 -bottom-3 h-px bg-signal" />
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
