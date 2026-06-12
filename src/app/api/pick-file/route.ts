import { NextResponse } from "next/server";
import { spawn } from "child_process";

function runOsascript(script: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn("osascript", ["-e", script]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });
}

// Opens the native macOS file picker via AppleScript and returns the
// POSIX path of the chosen file. The browser can't expose a real filesystem
// path, but since the Next.js server runs locally on the user's Mac, the
// AppleScript dialog appears on their screen and the path is returned here.
export async function POST(req: Request) {
  if (process.platform !== "darwin") {
    return NextResponse.json(
      { error: "Native file picker is only supported on macOS." },
      { status: 400 },
    );
  }

  let prompt = "Choose a file";
  let kind: "video" | "audio" = "video";
  try {
    const body = await req.json();
    if (typeof body?.prompt === "string") prompt = body.prompt;
    if (body?.kind === "audio") kind = "audio";
  } catch { /* empty body is fine */ }

  const safePrompt = prompt.replace(/["\\]/g, "\\$&");
  // public.audio is the parent UTI; covers wav/mp3/m4a/aac/flac/ogg/opus.
  const utis = kind === "audio"
    ? `{"public.audio"}`
    : `{"public.movie", "public.mpeg-4", "com.apple.quicktime-movie"}`;
  const script =
    `POSIX path of (choose file with prompt "${safePrompt}" of type ${utis})`;

  const { stdout, stderr, code } = await runOsascript(script);

  if (code !== 0) {
    // -128 is "User canceled" in AppleScript.
    if (/User canceled|-128/i.test(stderr)) {
      return NextResponse.json({ canceled: true });
    }
    return NextResponse.json(
      { error: stderr.trim() || "Picker failed" },
      { status: 500 },
    );
  }

  const filePath = stdout.trim();
  if (!filePath) return NextResponse.json({ canceled: true });
  const name = filePath.split("/").pop() || filePath;
  return NextResponse.json({ path: filePath, name });
}
