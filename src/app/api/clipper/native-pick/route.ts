import { execSync } from "child_process";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const result = execSync(
      `osascript -e 'POSIX path of (choose file with prompt "Select video file")'`,
      { timeout: 120000 }
    );
    return NextResponse.json({ path: result.toString().trim() });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("User canceled") || msg.includes("-128")) {
      return NextResponse.json({ cancelled: true });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
