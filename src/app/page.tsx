import Link from "next/link";
import { Lock } from "lucide-react";

const TOOLS = [
  {
    href: "/segmenter",
    index: "01",
    part: "PART ONE",
    name: "SEGMENTER",
    role: "Rough-cut",
    blurb:
      "Feed in long footage. Deepgram transcribes, Claude picks segment boundaries, and ffmpeg stream-copies rough clips — single or multicam — as a zip for NLE trimming.",
    spec: ["IN · LONG MP4", "ENGINE · CLAUDE", "OUT · CLIP ZIP"],
    soon: false,
  },
  {
    href: "/clipper",
    index: "02",
    part: "PART TWO",
    name: "CLIPPER",
    role: "Fine-cut",
    blurb:
      "Take a clip and refine it. The LLM cuts filler at the word level, you fine-tune in the editor, and export a frame-accurate FCPXML timeline for Final Cut Pro.",
    spec: ["IN · ONE CLIP", "ENGINE · WORD-LEVEL", "OUT · FCPXML"],
    soon: false,
  },
  {
    href: undefined,
    index: "03",
    part: "PART THREE",
    name: "POLISHER",
    role: "Polish",
    blurb:
      "The finishing pass. Take a locked cut and clean it up — levels, captions, and titles — into a delivery-ready master. Landing soon.",
    spec: ["IN · LOCKED CUT", "ENGINE · TBD", "OUT · MASTER"],
    soon: true,
  },
] as const;

export default function Home() {
  return (
    <main className="reticle-field grain relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col px-6 sm:px-10">
        {/* Instrument bar */}
        <header className="flex items-center justify-between py-6">
          <div className="flex items-center gap-2.5">
            <span className="tally inline-block size-1.5 rounded-full" />
            <span className="label text-foreground/80">PROJECT&nbsp;SNIPER</span>
          </div>
          <span className="label text-muted-foreground">
            AI VIDEO PIPELINE / v1
          </span>
        </header>

        {/* Hero */}
        <section className="rise-in flex flex-1 flex-col justify-center py-16">
          <p className="label mb-6 flex items-center gap-3 text-signal">
            <span className="inline-block h-px w-8 bg-signal/60" />
            THREE STAGES · ONE SCOPE
          </p>

          <h1 className="font-display text-[clamp(2.75rem,9vw,6.5rem)] font-extrabold leading-[0.92] tracking-[-0.03em]">
            Acquire
            <br />
            <span className="relative inline-flex items-center">
              <span className="text-signal">the&nbsp;cut</span>
              {/* reticle crosshair */}
              <span
                aria-hidden
                className="pointer-events-none absolute -right-9 top-1/2 hidden size-7 -translate-y-1/2 sm:block"
              >
                <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-signal/50" />
                <span className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-signal/50" />
                <span className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-signal/70" />
              </span>
            </span>
          </h1>

          <p className="mt-7 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            A precision pipeline for editors. Rough-cut a long recording with{" "}
            <span className="text-foreground">SEGMENTER</span>, then chase every
            frame down to the polished take in{" "}
            <span className="text-foreground">CLIPPER</span>. Only audio and
            transcript text ever leave the machine.
          </p>
        </section>

        {/* Tool modules */}
        <section className="grid gap-4 pb-14 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((t, i) => {
            const body = (
              <>
                {/* scan sweep on hover (live modules only) */}
                {!t.soon && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-signal to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  />
                )}

                <div className="flex items-start justify-between">
                  <span
                    className={`font-mono text-3xl font-medium tabular-nums transition-colors ${
                      t.soon
                        ? "text-muted-foreground/25"
                        : "text-muted-foreground/40 group-hover:text-signal"
                    }`}
                  >
                    {t.index}
                  </span>
                  {t.soon ? (
                    <span className="label flex items-center gap-1.5 rounded-full border border-signal/40 px-2.5 py-1 text-signal/90">
                      <span className="inline-block size-1 rounded-full bg-signal/80" />
                      SOON
                    </span>
                  ) : (
                    <span className="label text-muted-foreground">{t.part}</span>
                  )}
                </div>

                <div className="mt-7 flex items-baseline gap-3">
                  <h2 className="font-display text-2xl font-bold tracking-tight">
                    {t.name}
                  </h2>
                  <span className="label text-signal/80">{t.role}</span>
                </div>

                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {t.blurb}
                </p>

                <div className="mt-6 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border pt-4">
                  {t.spec.map((s) => (
                    <span key={s} className="label text-muted-foreground/70">
                      {s}
                    </span>
                  ))}
                </div>

                {t.soon ? (
                  <div className="mt-6 flex items-center gap-2 text-muted-foreground/60">
                    <Lock className="size-3.5" strokeWidth={2} />
                    <span className="label">IN DEVELOPMENT</span>
                  </div>
                ) : (
                  <div className="mt-6 flex items-center gap-2 text-sm font-medium text-foreground/70 transition-colors group-hover:text-signal">
                    <span className="label">ENGAGE</span>
                    <span className="transition-transform duration-300 group-hover:translate-x-1.5">
                      →
                    </span>
                  </div>
                )}
              </>
            );

            const delay = { animationDelay: `${120 + i * 120}ms` };

            // Locked placeholder — non-interactive until the route ships.
            if (t.soon) {
              return (
                <div
                  key={t.index}
                  aria-disabled="true"
                  style={delay}
                  className="rise-in relative flex flex-col overflow-hidden rounded-lg border border-dashed border-border bg-card/25 p-6 opacity-70 sm:col-span-2 lg:col-span-1"
                >
                  {body}
                </div>
              );
            }

            return (
              <Link
                key={t.index}
                href={t.href!}
                style={delay}
                className="rise-in group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card/60 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-signal/50 hover:bg-card/90"
              >
                {body}
              </Link>
            );
          })}
        </section>

        {/* Readout footer */}
        <footer className="flex items-center justify-between border-t border-border py-5">
          <span className="label text-muted-foreground/60">
            DEEPGRAM · CLAUDE · FFMPEG
          </span>
          <span className="label text-muted-foreground/60">MACOS · LOCAL</span>
        </footer>
      </div>
    </main>
  );
}
