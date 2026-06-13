const pad = (value: number, digits = 2) => value.toString().padStart(digits, "0");

/**
 * FCPXML rational frame duration for a given fps.
 * NTSC rates use 1001-pulldown fractions per Apple spec.
 * Integer fps use 100/(fps*100)s = 1/fps.
 */
export function getFrameTimeFormat(fps: number): {
  frameDuration: string;
  frameNum: number;
  frameDenom: number;
} {
  if (Math.abs(fps - 29.97) < 0.02) return { frameDuration: "1001/30000s", frameNum: 1001, frameDenom: 30000 };
  if (Math.abs(fps - 59.94) < 0.02) return { frameDuration: "1001/60000s", frameNum: 1001, frameDenom: 60000 };
  const effectiveFps = Math.round(fps);
  const denom = effectiveFps * 100;
  return { frameDuration: `100/${denom}s`, frameNum: 100, frameDenom: denom };
}

export function secondsToTimecode(seconds: number, fps = 29.97): string {
  const safeSeconds = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
  const wholeSeconds = Math.floor(safeSeconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const secs = wholeSeconds % 60;
  const safeFps = fps > 0 ? fps : 29.97;
  const fractional = safeSeconds - wholeSeconds;
  const frames = Math.floor(fractional * safeFps + 1e-4);
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}:${pad(frames)}`;
}
