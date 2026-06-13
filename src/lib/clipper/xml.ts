import { getFrameTimeFormat } from "@/lib/clipper/timecode";
import { Source } from "@/lib/clipper/types";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeRole(label: string): string {
  return label.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "") || "track";
}

function fileUrl(absPath: string): string {
  return `file://${absPath.startsWith("/") ? "" : "/"}${escapeXml(absPath)}`;
}

/**
 * Generate FCPXML 1.8 from kept segments.
 *
 * Audio channels follow `source.audioChannels`:
 *   - 2: channel-isolated stereo, srcCh=1 → speakerLabels[0] role, srcCh=2 → speakerLabels[1] role.
 *   - 1: mono (or cross-talk stereo downmixed to mono during transcription) — single srcCh=1.
 *
 * A-only (source.angles.length === 1): flat <asset-clip> spine.
 * A+B (source.angles.length === 2): primary cam (audioSource:true) on the
 * spine; secondary cam as a lane-1 connected <asset-clip> child per segment.
 * Secondary has no <audio-channel-source> — only primary's audio plays.
 */
export function generateFCPXML(
  segments: { start: number; end: number; text: string }[],
  source: Source,
  speakerLabels?: [string, string]
): string {
  if (segments.length === 0) {
    throw new Error("generateFCPXML: no segments to export");
  }
  const primary = source.angles.find((a) => a.audioSource);
  if (!primary) {
    throw new Error("generateFCPXML: no angle has audioSource:true");
  }
  const secondary = source.angles.find((a) => !a.audioSource);
  const { duration, fps, audioChannels } = source;

  const { frameDuration, frameNum, frameDenom } = getFrameTimeFormat(fps);
  const ch1Role = `dialogue.${sanitizeRole(speakerLabels?.[0] ?? "Speaker")}`;
  const ch2Role = `dialogue.${sanitizeRole(speakerLabels?.[1] ?? "Guest")}`;

  const primaryFileName = primary.filePath.split("/").pop() || primary.filePath;
  const trimmedSource = primaryFileName.trim();
  const cleanName = trimmedSource.replace(/\.\w+$/, "").trim() || "export";
  const srcUrl = fileUrl(primary.filePath);

  // Audio routing line(s) — channel-isolated stereo carries two distinct speaker
  // roles; mono / cross-talk-downmixed sources have a single channel only.
  const audioChannelLines =
    audioChannels === 2
      ? `\n              <audio-channel-source srcCh="1" role="${ch1Role}" />\n              <audio-channel-source srcCh="2" role="${ch2Role}" />`
      : `\n              <audio-channel-source srcCh="1" role="${ch1Role}" />`;

  let offsetFrames = 0;

  const clipElements = segments
    .map((seg) => {
      // floor/ceil = inclusive: never crop a word at a fractional-frame boundary.
      const startFrame = Math.floor(seg.start * fps);
      const endFrame = Math.ceil(seg.end * fps);
      const durFrames = Math.max(1, endFrame - startFrame);

      const offsetStr = `${offsetFrames * frameNum}/${frameDenom}s`;
      const startStr  = `${startFrame  * frameNum}/${frameDenom}s`;
      const durStr    = `${durFrames   * frameNum}/${frameDenom}s`;

      offsetFrames += durFrames;

      // Connected-clip offset is in the parent's source-TC coordinate system,
      // NOT the sequence timeline. For pre-synced A+B (sync handled upstream),
      // B's offset and start are the same value — both reference the same
      // source-TC moment as A's start. If per-cam sync offsets are ever added,
      // this becomes: offset = A.start, start = A.start + B.syncOffset.
      const bClipLine = secondary
        ? `\n              <asset-clip ref="r2" lane="1" offset="${startStr}" start="${startStr}" duration="${durStr}" />`
        : "";

      return `            <asset-clip ref="r1" offset="${offsetStr}" name="${escapeXml(seg.text.trim().substring(0, 60))}" start="${startStr}" duration="${durStr}" tcFormat="NDF">${audioChannelLines}${bClipLine}
              <note>${escapeXml(seg.text)}</note>
            </asset-clip>`;
    })
    .join("\n");

  const totalDurStr  = `${offsetFrames * frameNum}/${frameDenom}s`;
  const assetDurFrames = Math.ceil(duration * fps);
  const assetDurStr  = `${assetDurFrames * frameNum}/${frameDenom}s`;

  const primaryAssetLine = `    <asset id="r1" name="${escapeXml(cleanName)}" src="${srcUrl}" start="0/${frameDenom}s" duration="${assetDurStr}" hasVideo="1" hasAudio="1" audioSources="${audioChannels}" audioChannels="${audioChannels}" audioRate="48000" format="r0" />`;

  let secondaryAssetLine = "";
  if (secondary) {
    const bFileName = secondary.filePath.split("/").pop() || secondary.filePath;
    const bCleanName = bFileName.trim().replace(/\.\w+$/, "").trim();
    const bSrcUrl = fileUrl(secondary.filePath);
    secondaryAssetLine = `\n    <asset id="r2" name="${escapeXml(bCleanName)}" src="${bSrcUrl}" start="0/${frameDenom}s" duration="${assetDurStr}" hasVideo="1" hasAudio="0" format="r0" />`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.8">
  <resources>
    <format id="r0" frameDuration="${frameDuration}" width="1920" height="1080" />
${primaryAssetLine}${secondaryAssetLine}
  </resources>
  <library>
    <event name="${escapeXml(cleanName)}">
      <project name="${escapeXml(cleanName)} - Edited">
        <sequence format="r0" duration="${totalDurStr}" tcStart="0/${frameDenom}s" tcFormat="NDF">
          <spine>
${clipElements}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`;
}
