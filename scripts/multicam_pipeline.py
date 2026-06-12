#!/usr/bin/env python3
"""Multicam sync + cut pipeline.

Takes A-cam (master, required) plus any combination of B-cam, C-cam, and up to
two audio-only lavalier inputs (lav1, lav2) that may have started rolling later.
Computes per-alt audio-sync offsets against A, cuts frame-accurate clips per
camera (and sample-accurate PCM WAV clips per lav) at A-cam-defined segment
timecodes, and self-validates the result.

  python3 scripts/multicam_pipeline.py \\
    --acam Acam_full.mp4 --bcam Bcam_full.mp4 --ccam Ccam_full.mp4 \\
    --lav1 lav1.wav --lav2 lav2.wav \\
    --segments segments.json --outdir ./out/multicam

segments.json: [{"start": float, "end": float, "title"?: str}, ...] in A-cam timecode.

Sign convention: positive offset = source started LATER than A.
    alt_time_in_alt_file = a_time - alt_offset
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from fractions import Fraction
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import fftconvolve


MUXABLE_AUDIO = {"aac", "mp3", "ac3", "opus", "alac"}
MIN_FFMPEG_VERSION = (4, 4)


def run_command(cmd):
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        tail = (result.stderr or result.stdout).strip().splitlines()[-15:]
        raise RuntimeError("\n".join(tail) or f"{cmd[0]} failed")
    return result.stdout.strip()


def log_status(**fields):
    print(json.dumps(fields), flush=True)


def safe_name(s):
    cleaned = re.sub(r"[^\w\-. ]+", "_", s).strip().strip(".")
    return cleaned or "segment"


# ---------- ffprobe ----------

def ffprobe_duration(path):
    out = run_command([
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "json", path,
    ])
    return float(json.loads(out)["format"]["duration"])


def ffprobe_frame_rate(path):
    """r_frame_rate as Fraction. avg_frame_rate is unreliable on VFR/MOV."""
    out = run_command([
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=r_frame_rate",
        "-of", "default=noprint_wrappers=1:nokey=1", path,
    ])
    val = out.strip().splitlines()[0] if out.strip() else ""
    if not val or "/" not in val:
        raise RuntimeError(f"Could not parse r_frame_rate for {path!r}: {val!r}")
    num, den = val.split("/")
    return Fraction(int(num), int(den))


def ffprobe_audio_info(path):
    out = run_command([
        "ffprobe", "-v", "error",
        "-select_streams", "a:0",
        "-show_entries", "stream=codec_name,sample_rate,channels",
        "-of", "json", path,
    ])
    streams = json.loads(out).get("streams", [])
    if not streams:
        return {"codec_name": None, "sample_rate": None, "channels": None}
    s = streams[0]
    return {
        "codec_name": s.get("codec_name"),
        "sample_rate": int(s["sample_rate"]) if s.get("sample_rate") else None,
        "channels": int(s["channels"]) if s.get("channels") else None,
    }


def check_ffmpeg_version():
    out = run_command(["ffmpeg", "-version"])
    m = re.search(r"ffmpeg version (\d+)\.(\d+)", out)
    if not m:
        log_status(status="warn", reason="could_not_parse_ffmpeg_version")
        return
    ver = (int(m.group(1)), int(m.group(2)))
    if ver < MIN_FFMPEG_VERSION:
        log_status(
            status="warn", reason="ffmpeg_too_old",
            found=f"{ver[0]}.{ver[1]}",
            minimum=f"{MIN_FFMPEG_VERSION[0]}.{MIN_FFMPEG_VERSION[1]}",
            detail="Input-side -ss with re-encode requires ffmpeg >= 4.4 for frame-accurate cuts.",
        )


# ---------- audio extraction & xcorr ----------

def extract_audio_window(src, start, dur, out_wav, sr=8000):
    """Extract mono PCM WAV window from `src` starting at `start` (seconds).

    Uses fast input-side -ss to within ~5s of the target, then accurate
    output-side -ss for sample-precise trim. Pure input-side -ss can truncate
    the output by several seconds on some ffmpeg/codec combos (observed on
    ffmpeg 8.0.1 with stream-copied AAC); pure output-side -ss is accurate
    but decodes from the start of the file. This pattern is fast on long
    files and exact at the trim boundary.
    """
    start = max(0.0, start)
    pre_seek = max(0.0, start - 5.0)
    fine_seek = start - pre_seek
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    if pre_seek > 0:
        cmd += ["-ss", f"{pre_seek:.3f}"]
    cmd += ["-i", src]
    if fine_seek > 0:
        cmd += ["-ss", f"{fine_seek:.3f}"]
    cmd += [
        "-t", f"{dur:.3f}",
        "-vn", "-ac", "1", "-ar", str(sr),
        "-c:a", "pcm_s16le", "-f", "wav",
        out_wav,
    ]
    run_command(cmd)


def load_wav_mono(path):
    sr, data = wavfile.read(path)
    if data.ndim > 1:
        data = data.mean(axis=1)
    if data.dtype != np.float32:
        if np.issubdtype(data.dtype, np.integer):
            info = np.iinfo(data.dtype)
            denom = max(abs(int(info.min)), int(info.max))
            data = data.astype(np.float32) / float(denom)
        else:
            data = data.astype(np.float32)
    return data, sr


def xcorr_lag_seconds(ref, probe, sr):
    """Return the position (seconds) in `ref` where `probe` best aligns.

    fftconvolve(ref, probe[::-1], mode='valid') gives correlation values for
    each alignment of probe within ref; argmax = best start position in ref.
    """
    if len(ref) < len(probe):
        raise ValueError(
            f"xcorr_lag_seconds: ref ({len(ref)} samples) must be at least as long "
            f"as probe ({len(probe)} samples); otherwise mode='valid' returns an "
            f"empty array and argmax is undefined."
        )
    ref = ref - float(ref.mean())
    probe = probe - float(probe.mean())
    corr = fftconvolve(ref, probe[::-1], mode="valid")
    lag_samples = int(np.argmax(corr))
    return lag_samples / float(sr)


def estimate_offset(name, a_path, b_path, a_dur, b_dur,
                    coarse_sr, fine_sr, probe_dur, max_offset, tmp_dir):
    """Return offset (seconds) of camera `b_path` relative to A.

    Positive = camera started later than A. b_time_in_b_file = a_time - offset.
    """
    probe_dur = min(probe_dur, max(0.0, b_dur - 1.0))
    if probe_dur <= 1.0:
        raise RuntimeError(f"{name}: source too short to probe ({b_dur:.2f}s)")
    probe_start_in_b = max(0.0, (b_dur - probe_dur) / 2.0)

    # A's window must cover every plausible probe-match position. The probe
    # starts in A at (offset + probe_start_in_b) and is probe_dur long, so the
    # latest end is (max_offset + probe_start_in_b + probe_dur). Without the
    # probe_start_in_b term, fftconvolve's valid range clips off the true
    # match when the probe was pulled from deep inside B.
    a_search_dur = min(a_dur, max_offset + probe_start_in_b + probe_dur + 2.0)
    log_status(status="estimating_offset_coarse", cam=name,
               probe_dur=probe_dur, a_search_dur=a_search_dur, sr=coarse_sr)

    a_wav = os.path.join(tmp_dir, f"a_coarse_{name}.wav")
    b_wav = os.path.join(tmp_dir, f"b_coarse_{name}.wav")
    extract_audio_window(a_path, 0.0, a_search_dur, a_wav, sr=coarse_sr)
    extract_audio_window(b_path, probe_start_in_b, probe_dur, b_wav, sr=coarse_sr)
    a_sig, sr_a = load_wav_mono(a_wav)
    b_sig, sr_b = load_wav_mono(b_wav)
    if sr_a != sr_b:
        raise RuntimeError(f"{name}: coarse SR mismatch {sr_a} vs {sr_b}")

    coarse_lag_in_a = xcorr_lag_seconds(a_sig, b_sig, sr_a)
    coarse_offset = coarse_lag_in_a - probe_start_in_b
    log_status(status="estimating_offset_coarse_done", cam=name,
               coarse_offset=round(coarse_offset, 4))

    fine_probe_dur = min(probe_dur, 10.0)
    fine_probe_start_in_b = max(
        0.0,
        min(b_dur - fine_probe_dur,
            probe_start_in_b + (probe_dur - fine_probe_dur) / 2.0),
    )
    expected_lag_in_a = coarse_lag_in_a + (fine_probe_start_in_b - probe_start_in_b)
    fine_a_start = max(0.0, expected_lag_in_a - 2.0)
    fine_a_dur = min(a_dur - fine_a_start, fine_probe_dur + 4.0)
    if fine_a_dur <= fine_probe_dur:
        log_status(status="estimating_offset_fine_skipped", cam=name,
                   reason="not_enough_a_runway", offset=round(coarse_offset, 4))
        return coarse_offset

    log_status(status="estimating_offset_fine", cam=name,
               fine_probe_dur=fine_probe_dur, fine_a_dur=fine_a_dur, sr=fine_sr)
    a_fine_wav = os.path.join(tmp_dir, f"a_fine_{name}.wav")
    b_fine_wav = os.path.join(tmp_dir, f"b_fine_{name}.wav")
    extract_audio_window(a_path, fine_a_start, fine_a_dur, a_fine_wav, sr=fine_sr)
    extract_audio_window(b_path, fine_probe_start_in_b, fine_probe_dur, b_fine_wav, sr=fine_sr)
    a_fine, sr_fa = load_wav_mono(a_fine_wav)
    b_fine, _ = load_wav_mono(b_fine_wav)
    fine_lag_in_window = xcorr_lag_seconds(a_fine, b_fine, sr_fa)
    fine_lag_in_a = fine_a_start + fine_lag_in_window
    fine_offset = fine_lag_in_a - fine_probe_start_in_b
    log_status(status="estimating_offset_fine_done", cam=name,
               fine_offset=round(fine_offset, 4))
    return fine_offset


def round_offset_to_frame(offset_s, fps):
    frames = round(offset_s * float(fps))
    return frames / float(fps)


# ---------- segment cutting ----------

def cut_segment(src, start, dur, out, audio_copy):
    """Re-encode a frame-accurate clip from `src` covering [start, start+dur].

    Uses the fast input-seek + accurate output-seek pattern (same reason as
    extract_audio_window). Pure input-side -ss on ffmpeg 8.0.1 produces
    incorrect durations here when combined with -t and a re-encoded video
    stream; the dual-seek form is reliable.
    """
    start = max(0.0, start)
    pre_seek = max(0.0, start - 5.0)
    fine_seek = start - pre_seek
    audio_args = ["-c:a", "copy"] if audio_copy else ["-c:a", "aac", "-b:a", "192k"]
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    if pre_seek > 0:
        cmd += ["-ss", f"{pre_seek:.3f}"]
    cmd += ["-i", src]
    if fine_seek > 0:
        cmd += ["-ss", f"{fine_seek:.3f}"]
    cmd += [
        "-t", f"{dur:.3f}",
        "-c:v", "libx264", "-crf", "18", "-preset", "fast",
        *audio_args,
        "-movflags", "+faststart",
        "-avoid_negative_ts", "make_zero",
        out,
    ]
    run_command(cmd)


def cut_audio_segment(src, start, dur, out):
    """Sample-accurate PCM WAV clip from an audio-only source.

    Always decodes to pcm_s16le so the output is uniform regardless of input
    container (.wav/.mp3/.m4a/.aac/.flac/.ogg/.opus). Source channel count is
    preserved (no -ac flag — don't downmix). Same dual-seek pattern as
    cut_segment / extract_audio_window for sample-precise trim boundaries.
    """
    start = max(0.0, start)
    pre_seek = max(0.0, start - 5.0)
    fine_seek = start - pre_seek
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    if pre_seek > 0:
        cmd += ["-ss", f"{pre_seek:.3f}"]
    cmd += ["-i", src]
    if fine_seek > 0:
        cmd += ["-ss", f"{fine_seek:.3f}"]
    cmd += [
        "-t", f"{dur:.3f}",
        "-vn",
        "-c:a", "pcm_s16le", "-f", "wav",
        out,
    ]
    run_command(cmd)


# ---------- validation ----------

def measure_clip_lag(ref_clip, alt_clip, tmp_dir, probe_dur=10.0):
    """Signed lag (seconds) of alt_clip relative to ref_clip.

    Pull a probe from the middle of alt and a slightly wider window from the
    middle of ref. If clips are in sync, alt's t=0_in_window corresponds to
    the same ref time → returned lag ≈ 0.
    """
    ref_dur = ffprobe_duration(ref_clip)
    alt_dur = ffprobe_duration(alt_clip)
    pd = min(probe_dur, max(0.5, min(ref_dur, alt_dur) - 1.0))
    alt_start = max(0.0, (alt_dur - pd) / 2.0)
    ref_start = max(0.0, alt_start - 2.0)
    ref_dur_window = min(ref_dur - ref_start, pd + 4.0)
    if ref_dur_window <= pd:
        ref_start = 0.0
        ref_dur_window = min(ref_dur, pd + 4.0)
    ref_wav = os.path.join(tmp_dir, "val_ref.wav")
    alt_wav = os.path.join(tmp_dir, "val_alt.wav")
    extract_audio_window(ref_clip, ref_start, ref_dur_window, ref_wav, sr=16000)
    extract_audio_window(alt_clip, alt_start, pd, alt_wav, sr=16000)
    ref, sr = load_wav_mono(ref_wav)
    alt, _ = load_wav_mono(alt_wav)
    lag_in_window = xcorr_lag_seconds(ref, alt, sr)
    return (ref_start + lag_in_window) - alt_start


# ---------- input validation ----------

def validate_segments(segments, a_duration):
    """Attach validation_error per-segment; never raises for content issues."""
    out = []
    for i, seg in enumerate(segments):
        seg = dict(seg)
        err = None
        start = end = None
        try:
            start = float(seg.get("start"))
            end = float(seg.get("end"))
        except (TypeError, ValueError):
            err = "missing or non-numeric start/end"
        if err is None:
            if start < 0:
                err = f"start ({start}) is negative"
            elif end <= start:
                err = f"end ({end}) <= start ({start})"
            elif end > a_duration:
                err = f"end ({end:.3f}) exceeds A-cam duration ({a_duration:.3f})"
        if err:
            log_status(status="segment_invalid", index=i, reason=err)
            seg["validation_error"] = err
        out.append(seg)
    return out


# ---------- manifest I/O ----------

def write_manifest_atomic(path, data):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2))
    os.replace(tmp, path)


# ---------- main ----------

def parse_args():
    p = argparse.ArgumentParser(description="Multicam sync + cut pipeline.")
    p.add_argument("--acam", required=True)
    p.add_argument("--bcam", default=None,
                   help="Optional. At least one of --bcam/--ccam/--lav1/--lav2 must be provided.")
    p.add_argument("--ccam", default=None,
                   help="Optional. At least one of --bcam/--ccam/--lav1/--lav2 must be provided.")
    p.add_argument("--lav1", default=None,
                   help="Optional audio-only source (lavalier mic). Sync'd to A-cam audio.")
    p.add_argument("--lav2", default=None,
                   help="Optional audio-only source (lavalier mic). Sync'd to A-cam audio.")
    p.add_argument("--segments", required=True,
                   help="JSON file: [{start, end, title?}, ...] in A-cam timecode")
    p.add_argument("--outdir", required=True)
    p.add_argument("--probe-dur", type=float, default=180.0,
                   help="Audio probe duration for sync correlation (seconds).")
    p.add_argument("--coarse-sr", type=int, default=8000)
    p.add_argument("--fine-sr", type=int, default=16000)
    p.add_argument("--max-offset", type=float, default=1200.0,
                   help="Max plausible offset (s) of any alt source after A.")
    p.add_argument("--tolerance-frames", type=float, default=1.5,
                   help="Allowed sync drift (A-cam frames). Re-encode can shift PTS ~10-40ms; 1.5 is safer than 1.")
    p.add_argument("--skip-validation", action="store_true")
    p.add_argument("--zip-out", default=None,
                   help="If set, bundle the outdir into a ZIP at this path after success.")
    return p.parse_args()


def main():
    args = parse_args()

    if not any([args.bcam, args.ccam, args.lav1, args.lav2]):
        print(json.dumps({"error": "At least one of --bcam / --ccam / --lav1 / --lav2 is required"}),
              file=sys.stderr, flush=True)
        sys.exit(1)

    paths_to_check = [args.acam, args.segments]
    if args.bcam:
        paths_to_check.append(args.bcam)
    if args.ccam:
        paths_to_check.append(args.ccam)
    if args.lav1:
        paths_to_check.append(args.lav1)
    if args.lav2:
        paths_to_check.append(args.lav2)
    for p in paths_to_check:
        if not os.path.exists(p):
            print(json.dumps({"error": f"Not found: {p}"}), file=sys.stderr, flush=True)
            sys.exit(1)

    check_ffmpeg_version()

    outdir = Path(args.outdir)
    (outdir / "acam_clips").mkdir(parents=True, exist_ok=True)
    if args.bcam:
        (outdir / "bcam_clips").mkdir(parents=True, exist_ok=True)
    if args.ccam:
        (outdir / "ccam_clips").mkdir(parents=True, exist_ok=True)
    if args.lav1:
        (outdir / "lav1_clips").mkdir(parents=True, exist_ok=True)
    if args.lav2:
        (outdir / "lav2_clips").mkdir(parents=True, exist_ok=True)
    manifest_path = outdir / "clips_manifest.json"

    a_dur = ffprobe_duration(args.acam)
    b_dur = ffprobe_duration(args.bcam) if args.bcam else None
    c_dur = ffprobe_duration(args.ccam) if args.ccam else None
    l1_dur = ffprobe_duration(args.lav1) if args.lav1 else None
    l2_dur = ffprobe_duration(args.lav2) if args.lav2 else None
    fps = ffprobe_frame_rate(args.acam)
    log_status(status="probed_sources", a_duration=a_dur, b_duration=b_dur,
               c_duration=c_dur, lav1_duration=l1_dur, lav2_duration=l2_dur,
               a_fps=str(fps))

    alt_cams = []
    if args.bcam:
        alt_cams.append(("B", args.bcam))
    if args.ccam:
        alt_cams.append(("C", args.ccam))
    for cam_name, cam_path in alt_cams:
        try:
            other_fps = ffprobe_frame_rate(cam_path)
            if other_fps != fps:
                log_status(status="warn", reason="fps_mismatch",
                           cam=cam_name, a_fps=str(fps), cam_fps=str(other_fps))
        except Exception as e:
            log_status(status="warn", reason="fps_unreadable", cam=cam_name, detail=str(e))

    audio_copy = {}
    cam_paths = [("a", args.acam)]
    if args.bcam:
        cam_paths.append(("b", args.bcam))
    if args.ccam:
        cam_paths.append(("c", args.ccam))
    for name, path in cam_paths:
        info = ffprobe_audio_info(path)
        ok = (info["codec_name"] or "").lower() in MUXABLE_AUDIO
        audio_copy[name] = ok
        if not ok:
            log_status(status="warn", reason="audio_codec_not_muxable",
                       cam=name, codec=info["codec_name"], fallback="aac@192k")

    b_offset = None
    c_offset = None
    l1_offset = None
    l2_offset = None
    with tempfile.TemporaryDirectory(prefix="multicam-xcorr-") as tmp:
        if args.bcam:
            b_raw = estimate_offset("B", args.acam, args.bcam, a_dur, b_dur,
                                    args.coarse_sr, args.fine_sr,
                                    args.probe_dur, args.max_offset, tmp)
            b_offset = round_offset_to_frame(b_raw, fps)
        if args.ccam:
            c_raw = estimate_offset("C", args.acam, args.ccam, a_dur, c_dur,
                                    args.coarse_sr, args.fine_sr,
                                    args.probe_dur, args.max_offset, tmp)
            c_offset = round_offset_to_frame(c_raw, fps)
        if args.lav1:
            l1_raw = estimate_offset("L1", args.acam, args.lav1, a_dur, l1_dur,
                                     args.coarse_sr, args.fine_sr,
                                     args.probe_dur, args.max_offset, tmp)
            l1_offset = round_offset_to_frame(l1_raw, fps)
        if args.lav2:
            l2_raw = estimate_offset("L2", args.acam, args.lav2, a_dur, l2_dur,
                                     args.coarse_sr, args.fine_sr,
                                     args.probe_dur, args.max_offset, tmp)
            l2_offset = round_offset_to_frame(l2_raw, fps)
    log_status(status="offsets_rounded",
               b_offset=round(b_offset, 4) if b_offset is not None else None,
               c_offset=round(c_offset, 4) if c_offset is not None else None,
               lav1_offset=round(l1_offset, 4) if l1_offset is not None else None,
               lav2_offset=round(l2_offset, 4) if l2_offset is not None else None)

    raw_segments = json.loads(Path(args.segments).read_text())
    if not isinstance(raw_segments, list) or not raw_segments:
        print(json.dumps({"error": "segments JSON must be a non-empty list"}),
              file=sys.stderr, flush=True)
        sys.exit(1)
    validated = validate_segments(raw_segments, a_dur)

    manifest = {
        "sources": {
            "acam": {"path": str(Path(args.acam).resolve()),
                     "duration": a_dur,
                     "fps": f"{fps.numerator}/{fps.denominator}"},
            "bcam": (None if not args.bcam else
                     {"path": str(Path(args.bcam).resolve()),
                      "duration": b_dur, "offset_seconds": b_offset}),
            "ccam": (None if not args.ccam else
                     {"path": str(Path(args.ccam).resolve()),
                      "duration": c_dur, "offset_seconds": c_offset}),
            "lav1": (None if not args.lav1 else
                     {"path": str(Path(args.lav1).resolve()),
                      "duration": l1_dur, "offset_seconds": l1_offset}),
            "lav2": (None if not args.lav2 else
                     {"path": str(Path(args.lav2).resolve()),
                      "duration": l2_dur, "offset_seconds": l2_offset}),
        },
        "convention": "alt_time = a_time - alt_offset (positive offset = alt started later)",
        "segments": [],
        "validation": None,
    }
    write_manifest_atomic(manifest_path, manifest)

    pad = max(3, len(str(len(validated))))
    for i, seg in enumerate(validated):
        title = safe_name(str(seg.get("title") or f"segment_{i:0{pad}d}"))
        base = f"segment_{i:0{pad}d}.mp4"
        entry = {
            "index": i, "title": title,
            "a_start": seg.get("start"), "a_end": seg.get("end"),
            "acam_clip": None, "bcam_clip": None, "ccam_clip": None,
            "lav1_clip": None, "lav2_clip": None,
            "bcam_available": False, "ccam_available": False,
            "lav1_available": False, "lav2_available": False,
            "error": None,
        }

        if "validation_error" in seg:
            entry["error"] = seg["validation_error"]
            manifest["segments"].append(entry)
            write_manifest_atomic(manifest_path, manifest)
            log_status(status="segment_skipped", index=i, reason=seg["validation_error"])
            continue

        try:
            a_start = float(seg["start"])
            a_end = float(seg["end"])
            dur = a_end - a_start
            avail = ["a"]

            a_out = outdir / "acam_clips" / base
            cut_segment(args.acam, a_start, dur, str(a_out), audio_copy["a"])
            entry["acam_clip"] = str(a_out.relative_to(outdir))

            if args.bcam:
                b_start = a_start - b_offset
                b_end = a_end - b_offset
                if b_start >= 0.0 and b_end <= b_dur:
                    b_out = outdir / "bcam_clips" / base
                    cut_segment(args.bcam, b_start, dur, str(b_out), audio_copy["b"])
                    entry["bcam_clip"] = str(b_out.relative_to(outdir))
                    entry["bcam_available"] = True
                    avail.append("b")

            if args.ccam:
                c_start = a_start - c_offset
                c_end = a_end - c_offset
                if c_start >= 0.0 and c_end <= c_dur:
                    c_out = outdir / "ccam_clips" / base
                    cut_segment(args.ccam, c_start, dur, str(c_out), audio_copy["c"])
                    entry["ccam_clip"] = str(c_out.relative_to(outdir))
                    entry["ccam_available"] = True
                    avail.append("c")

            wav_base = f"segment_{i:0{pad}d}.wav"

            if args.lav1:
                l1_start = a_start - l1_offset
                l1_end = a_end - l1_offset
                if l1_start >= 0.0 and l1_end <= l1_dur:
                    l1_out = outdir / "lav1_clips" / wav_base
                    cut_audio_segment(args.lav1, l1_start, dur, str(l1_out))
                    entry["lav1_clip"] = str(l1_out.relative_to(outdir))
                    entry["lav1_available"] = True
                    avail.append("l1")

            if args.lav2:
                l2_start = a_start - l2_offset
                l2_end = a_end - l2_offset
                if l2_start >= 0.0 and l2_end <= l2_dur:
                    l2_out = outdir / "lav2_clips" / wav_base
                    cut_audio_segment(args.lav2, l2_start, dur, str(l2_out))
                    entry["lav2_clip"] = str(l2_out.relative_to(outdir))
                    entry["lav2_available"] = True
                    avail.append("l2")

            log_status(status="segment_cut", index=i, available=avail)
        except Exception as exc:
            entry["error"] = f"{type(exc).__name__}: {exc}"
            log_status(status="segment_failed", index=i, error=entry["error"])

        manifest["segments"].append(entry)
        write_manifest_atomic(manifest_path, manifest)

    if args.skip_validation:
        log_status(status="validation_skipped")
    else:
        tolerance_s = args.tolerance_frames / float(fps)
        validation = {"tolerance_seconds": round(tolerance_s, 4)}
        try:
            with tempfile.TemporaryDirectory(prefix="multicam-validate-") as tmp:
                has_b = args.bcam is not None
                has_c = args.ccam is not None
                all_three = None
                if has_b and has_c:
                    all_three = next(
                        (s for s in manifest["segments"]
                         if s["acam_clip"] and s["bcam_clip"] and s["ccam_clip"]),
                        None,
                    )
                if all_three:
                    a_clip = str(outdir / all_three["acam_clip"])
                    b_lag = measure_clip_lag(a_clip, str(outdir / all_three["bcam_clip"]), tmp)
                    c_lag = measure_clip_lag(a_clip, str(outdir / all_three["ccam_clip"]), tmp)
                    passed = abs(b_lag) <= tolerance_s and abs(c_lag) <= tolerance_s
                    validation.update(
                        method="all_three", segment_index=all_three["index"],
                        b_lag_seconds=round(b_lag, 4),
                        c_lag_seconds=round(c_lag, 4),
                        passed=passed,
                    )
                else:
                    b_seg = next((s for s in manifest["segments"]
                                  if s["acam_clip"] and s["bcam_clip"]), None) if has_b else None
                    c_seg = next((s for s in manifest["segments"]
                                  if s["acam_clip"] and s["ccam_clip"]), None) if has_c else None
                    has_l1 = args.lav1 is not None
                    has_l2 = args.lav2 is not None
                    l1_seg = next((s for s in manifest["segments"]
                                   if s["acam_clip"] and s["lav1_clip"]), None) if has_l1 else None
                    l2_seg = next((s for s in manifest["segments"]
                                   if s["acam_clip"] and s["lav2_clip"]), None) if has_l2 else None
                    if not b_seg and not c_seg and not l1_seg and not l2_seg:
                        validation.update(method="skipped_no_overlap", passed=True)
                    else:
                        validation.update(method="per_cam", passed=True)
                        if b_seg:
                            b_lag = measure_clip_lag(str(outdir / b_seg["acam_clip"]),
                                                     str(outdir / b_seg["bcam_clip"]), tmp)
                            validation["b_segment_index"] = b_seg["index"]
                            validation["b_lag_seconds"] = round(b_lag, 4)
                            if abs(b_lag) > tolerance_s:
                                validation["passed"] = False
                        if c_seg:
                            c_lag = measure_clip_lag(str(outdir / c_seg["acam_clip"]),
                                                     str(outdir / c_seg["ccam_clip"]), tmp)
                            validation["c_segment_index"] = c_seg["index"]
                            validation["c_lag_seconds"] = round(c_lag, 4)
                            if abs(c_lag) > tolerance_s:
                                validation["passed"] = False
                        if l1_seg:
                            l1_lag = measure_clip_lag(str(outdir / l1_seg["acam_clip"]),
                                                      str(outdir / l1_seg["lav1_clip"]), tmp)
                            validation["lav1_segment_index"] = l1_seg["index"]
                            validation["lav1_lag_seconds"] = round(l1_lag, 4)
                            if abs(l1_lag) > tolerance_s:
                                validation["passed"] = False
                        if l2_seg:
                            l2_lag = measure_clip_lag(str(outdir / l2_seg["acam_clip"]),
                                                      str(outdir / l2_seg["lav2_clip"]), tmp)
                            validation["lav2_segment_index"] = l2_seg["index"]
                            validation["lav2_lag_seconds"] = round(l2_lag, 4)
                            if abs(l2_lag) > tolerance_s:
                                validation["passed"] = False
        except Exception as exc:
            validation["error"] = f"{type(exc).__name__}: {exc}"
            log_status(status="validation_error", error=validation["error"])

        manifest["validation"] = validation
        write_manifest_atomic(manifest_path, manifest)

        if validation.get("passed") is False:
            log_status(status="validation_failed", validation=validation)
            print(json.dumps({"error": "sync validation exceeded tolerance",
                              "validation": validation}),
                  file=sys.stderr, flush=True)
            sys.exit(2)
        log_status(status="validation_passed", validation=validation)

    if args.zip_out:
        import zipfile
        zip_path = Path(args.zip_out)
        log_status(status="zipping", path=str(zip_path))
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED) as zf:
            for f in sorted(outdir.rglob("*")):
                if f.is_file():
                    zf.write(f, arcname=str(f.relative_to(outdir)))
        log_status(status="zipped", path=str(zip_path))

    log_status(status="done", manifest=str(manifest_path))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr, flush=True)
        sys.exit(1)
