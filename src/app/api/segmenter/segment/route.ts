import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { SEGMENT_SYSTEM_PROMPT } from "@/prompts/segment-system";
import { dlog, summarize } from "@/lib/debug";

export const maxDuration = 900;
export const dynamic = "force-dynamic";

const anthropic = new Anthropic();
const SEGMENT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const SEGMENT_MAX_TOKENS = 64000;

interface WordTiming {
  word: string;
  start: number;
  end: number;
}

interface TranscriptLine {
  start: number;
  end: number;
  text: string;
  words?: WordTiming[];
}

interface ClaudeSegment {
  id?: number;
  title?: string;
  startLine?: number;
  startSec?: number;
  endSec?: number;
  summary?: string;
}

export async function POST(req: NextRequest) {
  try {
    const { transcript, prompt } = (await req.json()) as {
      transcript?: TranscriptLine[];
      prompt?: string;
    };

    if (!transcript || !prompt) {
      return NextResponse.json(
        { error: "transcript and prompt are required" },
        { status: 400 }
      );
    }

    dlog("segmenter:segment", "incoming request", {
      model: SEGMENT_MODEL,
      transcriptLines: transcript.length,
      prompt: summarize(prompt),
    });

    const transcriptText = transcript
      .map((t, i) => {
        const header = `[LINE ${i}] [${t.start}s-${t.end}s] ${t.text}`;
        const words = t.words ?? [];
        if (words.length === 0) return header;
        const wordsLine = words
          .map((w) => `${w.word}@${w.start.toFixed(2)}`)
          .join(" ");
        return `${header}\n[WORDS ${i}] ${wordsLine}`;
      })
      .join("\n");

    const stream = anthropic.messages.stream({
      model: SEGMENT_MODEL,
      max_tokens: SEGMENT_MAX_TOKENS,
      system: SEGMENT_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Here is the timestamped transcript:\n\n${transcriptText}\n\nSegmentation instructions: ${prompt}`,
        },
      ],
    });
    const response = await stream.finalMessage();

    dlog("segmenter:segment", "anthropic response", {
      model: SEGMENT_MODEL,
      stop_reason: response.stop_reason,
      usage: response.usage,
    });

    if (response.stop_reason === "max_tokens") {
      return NextResponse.json(
        {
          error: `Model output hit max_tokens (${SEGMENT_MAX_TOKENS}) before finishing the JSON. Transcript is likely too long for a single-pass segmentation — split the source video and segment each half separately.`,
          stop_reason: response.stop_reason,
        },
        { status: 500 }
      );
    }

    const content = response.content[0];
    const text = content.type === "text" ? content.text : "";

    let segments: ClaudeSegment[];
    try {
      const parsed = JSON.parse(text);
      segments = Array.isArray(parsed) ? parsed : parsed.segments;
    } catch (parseErr) {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return NextResponse.json(
          {
            error: "Model response was not valid JSON and no JSON object could be extracted.",
            detail: parseErr instanceof Error ? parseErr.message : String(parseErr),
            preview: text.slice(0, 500),
            stop_reason: response.stop_reason,
          },
          { status: 502 }
        );
      }
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        segments = Array.isArray(parsed) ? parsed : parsed.segments;
      } catch (fallbackErr) {
        return NextResponse.json(
          {
            error: "Extracted JSON object failed to parse.",
            detail: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
            preview: jsonMatch[0].slice(0, 500),
            stop_reason: response.stop_reason,
          },
          { status: 502 }
        );
      }
    }

    if (!Array.isArray(segments) || segments.length === 0) {
      return NextResponse.json(
        {
          error: "Model returned no segments.",
          preview: text.slice(0, 500),
          stop_reason: response.stop_reason,
        },
        { status: 502 }
      );
    }

    // Enrich segments with start/end timestamps. Prefer Claude's word-level
    // startSec/endSec when present and sane; fall back to line-level otherwise.
    const enriched = segments.map((seg, i) => {
      const startIdx = seg.startLine ?? 0;
      const endIdx =
        i + 1 < segments.length
          ? (segments[i + 1].startLine ?? startIdx + 1) - 1
          : transcript.length - 1;

      const lineStart = transcript[startIdx]?.start ?? 0;
      const lineEnd = transcript[endIdx]?.end ?? 0;

      const startSec =
        typeof seg.startSec === "number" &&
        seg.startSec >= lineStart &&
        seg.startSec <= lineEnd
          ? seg.startSec
          : lineStart;

      const endSec =
        typeof seg.endSec === "number" &&
        seg.endSec >= lineStart &&
        seg.endSec <= lineEnd &&
        seg.endSec > startSec
          ? seg.endSec
          : lineEnd;

      return {
        id: seg.id ?? i + 1,
        title: seg.title ?? `Segment ${i + 1}`,
        startLine: startIdx,
        endLine: endIdx,
        start: startSec,
        end: endSec,
        summary: seg.summary ?? "",
      };
    });

    dlog("segmenter:segment", "returning enriched segments", summarize(enriched));
    return NextResponse.json({ segments: enriched });
  } catch (error: unknown) {
    console.error("[/api/segment] caught error:", error);
    dlog("segmenter:segment", "caught error", error instanceof Error ? error.message : String(error));
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: error.message, type: error.name, status: error.status },
        { status: error.status ?? 500 }
      );
    }
    const message =
      error instanceof Error ? error.message : "Segmentation failed";
    const stack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json({ error: message, stack }, { status: 500 });
  }
}
