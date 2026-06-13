import { NextResponse } from "next/server";
import { createReadStream, existsSync, statSync, unlinkSync } from "fs";
import { Readable } from "stream";
import { take } from "../../../_lib/multicam-store";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const entry = take(id);
  if (!entry || !existsSync(entry.zipPath)) {
    return NextResponse.json({ error: "Download not found or expired" }, { status: 404 });
  }

  const size = statSync(entry.zipPath).size;
  const nodeStream = createReadStream(entry.zipPath);
  nodeStream.on("close", () => {
    try { unlinkSync(entry.zipPath); } catch {}
  });
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${entry.filename}"`,
    },
  });
}
