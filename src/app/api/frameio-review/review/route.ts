import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { pythonInterpreter, SCRIPTS_DIR } from "../../_lib/spawn-python";
import { dlog, derror } from "@/lib/debug";

export const maxDuration = 600;
export const dynamic = "force-dynamic";

// review.py self-bootstraps its package path, so we can invoke it as a file.
const SCRIPT_PATH = path.join(SCRIPTS_DIR, "frameio", "review.py");

export async function POST(req: NextRequest) {
  const {
    filePath,
    fps = 1,
    mode = "visual",
    fuzz = 90,
    maxReps = null,
    maxFrames = null,
    hamming = 5,
    model = "claude-sonnet-4-6",
    confirmThreshold = 200,
    yes = false,
  } = await req.json();

  if (!filePath) {
    return new Response(JSON.stringify({ error: "No file path provided" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!existsSync(filePath)) {
    return new Response(JSON.stringify({ error: "File not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const args = [
    SCRIPT_PATH, "--server",
    "--input", filePath,
    "--fps", String(fps),
    "--mode", String(mode),
    "--fuzz", String(fuzz),
    "--hamming", String(hamming),
    "--model", String(model),
    "--confirm-threshold", String(confirmThreshold),
  ];
  if (maxReps != null) args.push("--max-reps", String(maxReps));
  if (maxFrames != null) args.push("--max-frames", String(maxFrames));
  if (yes) args.push("--yes");

  dlog("frameio:review", "spawn python", { args: args.slice(1) });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const proc = spawn(pythonInterpreter(), args, { env: { ...process.env } });

      let stderrBuffer = "";
      let stdoutBuffer = "";

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {}
      }, 10000);

      proc.stdout.on("data", (data: Buffer) => {
        stdoutBuffer += data.toString();
        const parts = stdoutBuffer.split("\n");
        stdoutBuffer = parts.pop() || "";
        for (const line of parts) {
          if (line.trim()) controller.enqueue(encoder.encode(`data: ${line}\n\n`));
        }
      });

      let stderrLineBuf = "";
      proc.stderr.on("data", (data: Buffer) => {
        const text = data.toString();
        stderrBuffer += text;
        // Mirror the python worker's [SNIPER:frameio] trace to the dev terminal…
        process.stderr.write(text);
        // …and forward each complete line over SSE as a `log` event so the tab's
        // Diagnostics panel shows the python trace inline (great for diagnosing).
        stderrLineBuf += text;
        const lines = stderrLineBuf.split("\n");
        stderrLineBuf = lines.pop() || "";
        for (const line of lines) {
          if (line.trim()) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ event: "log", stream: "stderr", text: line })}\n\n`),
            );
          }
        }
      });

      proc.on("close", (code) => {
        dlog("frameio:review", "python exit", {
          code,
          stderrTail: code !== 0 ? stderrBuffer.slice(-1500) : undefined,
        });
        clearInterval(keepalive);
        if (stderrLineBuf.trim()) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ event: "log", stream: "stderr", text: stderrLineBuf })}\n\n`),
          );
          stderrLineBuf = "";
        }
        if (stdoutBuffer.trim()) {
          controller.enqueue(encoder.encode(`data: ${stdoutBuffer}\n\n`));
          stdoutBuffer = "";
        }
        if (code !== 0) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ event: "error", message: `Process exited with code ${code}. ${stderrBuffer.slice(-500)}` })}\n\n`,
            ),
          );
        }
        controller.close();
      });

      proc.on("error", (err) => {
        derror("frameio:review", "failed to spawn python", err);
        clearInterval(keepalive);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ event: "error", message: err.message })}\n\n`),
        );
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
