"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TOOLS = [
  { href: "/segmenter", label: "🎬 SEGMENTER", hint: "Part 1" },
  { href: "/clipper", label: "✂️ CLIPPER", hint: "Part 2" },
] as const;

export default function Nav() {
  const pathname = usePathname();

  return (
    <div className="border-b border-neutral-800 bg-neutral-950">
      <div className="max-w-5xl mx-auto flex items-center gap-4 px-6 py-2.5">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-neutral-300 hover:text-white transition-colors"
        >
          🎯 PROJECT&nbsp;SNIPER
        </Link>
        <div className="flex items-center gap-1.5 ml-2">
          {TOOLS.map((t) => {
            const active = pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                  active
                    ? "bg-violet-600 text-white font-medium"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {t.label}
                <span className="ml-1.5 text-[10px] opacity-60">{t.hint}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
