import Link from "next/link";

const TOOLS = [
  {
    href: "/segmenter",
    emoji: "🎬",
    name: "SEGMENTER",
    part: "Part 1",
    blurb:
      "Feed in long footage. Deepgram transcribes, Claude picks segment boundaries, and ffmpeg stream-copies rough clips (single or multicam) as a zip for NLE trimming.",
    accent: "hover:border-violet-600/60",
  },
  {
    href: "/clipper",
    emoji: "✂️",
    name: "CLIPPER",
    part: "Part 2",
    blurb:
      "Take a clip and refine it. Transcribe, let the LLM cut filler at the word level, fine-tune in the editor, and export a polished FCPXML timeline for Final Cut Pro.",
    accent: "hover:border-violet-600/60",
  },
] as const;

export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center px-6 py-16">
      <div className="max-w-3xl w-full">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold tracking-tight">
            🎯 PROJECT SNIPER
          </h1>
          <p className="mt-2 text-neutral-400 text-sm">
            AI video pipeline — rough-cut with SEGMENTER, then polish with CLIPPER.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {TOOLS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={`group rounded-xl border border-neutral-800 bg-neutral-900/40 p-6 transition-colors ${t.accent}`}
            >
              <div className="flex items-center gap-2">
                <span className="text-2xl">{t.emoji}</span>
                <span className="text-lg font-semibold tracking-tight">
                  {t.name}
                </span>
                <span className="ml-auto text-[11px] font-medium uppercase tracking-wide text-violet-400">
                  {t.part}
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-neutral-400">
                {t.blurb}
              </p>
              <span className="mt-4 inline-block text-sm font-medium text-neutral-300 group-hover:text-white transition-colors">
                Open {t.name} →
              </span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
