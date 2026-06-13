#!/usr/bin/env python3
"""Transcribe audio files with Deepgram (nova-3)."""

import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import List, Optional

import numpy as np
from deepgram import AsyncDeepgramClient

MAX_DEEPGRAM_FILE_SIZE = 25 * 1024 * 1024  # 25MB upload limit
CHUNK_DURATION_SECONDS = 600  # 10 minutes per chunk
FRAGMENT_TEMPLATE = "chunk-%03d.mp3"
AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"}


def run_command(cmd: List[str]) -> str:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "Command failed")
    return result.stdout.strip()


def get_audio_metadata(audio_path: str) -> tuple[float, float]:
    """Get duration (seconds) and audio stream start_time via ffprobe."""
    output = run_command([
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration:stream=start_time,codec_type",
        "-of", "json",
        audio_path,
    ])
    data = json.loads(output)
    duration = float(data.get("format", {}).get("duration", 0) or 0)
    # Find the audio stream start_time — can be non-zero in MP4s recorded by cameras
    start_time = 0.0
    for stream in data.get("streams", []):
        if stream.get("codec_type") == "audio":
            val = stream.get("start_time")
            if val and val != "N/A":
                start_time = float(val)
            break
    return (start_time, duration)


def get_channel_count(path: str) -> int:
    """Return the number of audio channels in the first audio stream."""
    try:
        output = run_command([
            "ffprobe", "-v", "error",
            "-select_streams", "a:0",
            "-show_entries", "stream=channels",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
        ])
        return int(output.strip().split("\n")[0])
    except Exception:
        return 1


def _read_stereo_pcm(path: str, max_seconds: int = 300) -> Optional[np.ndarray]:
    """Decode up to max_seconds of audio as 16kHz stereo int16 PCM.

    Returns an (N, 2) int16 array, or None on any failure / non-stereo source.
    """
    result = subprocess.run(
        [
            "ffmpeg", "-nostdin", "-v", "error",
            "-i", path,
            "-t", str(max_seconds),
            "-vn", "-ac", "2", "-ar", "16000",
            "-f", "s16le", "-",
        ],
        capture_output=True,
    )
    if result.returncode != 0 or not result.stdout:
        return None
    samples = np.frombuffer(result.stdout, dtype=np.int16)
    if samples.size < 2 or samples.size % 2 != 0:
        return None
    return samples.reshape(-1, 2)


def is_channel_isolated(path: str, threshold: float = 0.65) -> bool:
    """True only when L and R envelopes are clearly complementary.

    Compares per-50ms-window RMS envelopes of L vs R via Pearson correlation.
    - Channel-isolated (host on L, caller on R): low corr (~0.2-0.5) -> True
    - Cross-talk stereo: high corr (~0.85-0.99) -> False
    - Mono-duplicated: corr ~1.0 -> False
    Any error / ambiguity returns False so the caller falls back to mono+diarize.
    """
    try:
        pcm = _read_stereo_pcm(path)
        if pcm is None or pcm.shape[0] < 16000 * 5:
            return False

        win = 800  # 50ms at 16kHz
        n_windows = pcm.shape[0] // win
        if n_windows < 50:
            return False

        framed = pcm[: n_windows * win].astype(np.float32).reshape(n_windows, win, 2)
        rms = np.sqrt((framed ** 2).mean(axis=1))
        left_env, right_env = rms[:, 0], rms[:, 1]

        noise_floor = max(50.0, 0.01 * float(rms.max()))
        voiced = (left_env > noise_floor) | (right_env > noise_floor)
        if voiced.sum() < 50:
            return False
        left_env = left_env[voiced]
        right_env = right_env[voiced]

        if left_env.std() < 1e-3 or right_env.std() < 1e-3:
            return False

        corr = float(np.corrcoef(left_env, right_env)[0, 1])
        if not np.isfinite(corr):
            return False

        return corr < threshold
    except Exception:
        return False


def extract_channel(video_path: str, channel: int) -> str:
    """Extract one stereo channel (0=left/host, 1=right/caller) as a mono MP3.

    Returns the path to a temporary file that the caller must delete.
    """
    channel_label = "FL" if channel == 0 else "FR"
    fd, tmp = tempfile.mkstemp(suffix=".mp3", prefix=f"clipper-ch{channel}-")
    os.close(fd)
    result = subprocess.run(
        [
            "ffmpeg", "-i", video_path, "-vn",
            "-af", f"pan=mono|c0={channel_label}",
            "-ar", "16000", "-b:a", "128k",
            "-avoid_negative_ts", "make_zero",
            tmp, "-y",
        ],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg channel {channel} extraction failed: {result.stderr.strip()}")
    return tmp


async def transcribe_channel(
    client: AsyncDeepgramClient,
    audio_path: str,
    speaker_id: int,
    audio_offset: float = 0.0,
) -> tuple[List[dict], Optional[str]]:
    """Transcribe a mono channel file.

    Returns (entries, detected_language).  All word-level speaker fields are
    set to speaker_id — diarization is disabled since we already know the speaker.
    """
    chunk_paths, chunk_dir = split_audio_if_needed(audio_path)
    total_chunks = len(chunk_paths)
    offsets = get_chunk_offsets(audio_path, total_chunks) if total_chunks > 1 else [0.0]

    entries: List[dict] = []
    detected_language: Optional[str] = None

    try:
        for idx, chunk_path in enumerate(chunk_paths, start=1):
            with open(chunk_path, "rb") as f:
                audio_bytes = f.read()

            response = await client.listen.v1.media.transcribe_file(
                request=audio_bytes,
                model="nova-3",
                smart_format=True,
                punctuate=True,
                utterances=True,
                diarize=False,
                paragraphs=True,
            )

            chunk_data = response.model_dump()
            chunk_entries = build_transcript_entries(chunk_data, offsets[idx - 1] + audio_offset)

            # Stamp every word with the known speaker_id (channel-based, not diarized)
            for entry in chunk_entries:
                for word in entry.get("words", []):
                    word["speaker"] = speaker_id

            entries.extend(chunk_entries)

            if not detected_language:
                channels = chunk_data.get("results", {}).get("channels", [])
                if channels:
                    detected_language = channels[0].get("detected_language")
    finally:
        if chunk_dir and os.path.exists(chunk_dir):
            shutil.rmtree(chunk_dir)

    return entries, detected_language


async def run_stereo_transcription(video_path: str, audio_offset: float = 0.0) -> None:
    """Transcribe a stereo video by sending each channel to Deepgram separately.

    Left channel → speaker 0 (host), right channel → speaker 1 (caller).
    Entries from both channels are merged and sorted by start time.
    """
    _, duration = get_audio_metadata(video_path)

    print(json.dumps({"status": "extracting_channels"}), flush=True)
    left_path = extract_channel(video_path, 0)
    right_path = extract_channel(video_path, 1)
    size_mb = round((os.path.getsize(left_path) + os.path.getsize(right_path)) / (1024 * 1024), 1)
    print(json.dumps({"status": "audio_extracted", "size_mb": size_mb, "audio_offset": audio_offset}), flush=True)

    client = AsyncDeepgramClient(api_key=os.environ["DEEPGRAM_API_KEY"])
    detected_language: Optional[str] = None

    try:
        print(json.dumps({"status": "transcribing_chunk", "chunk": 1, "total": 2}), flush=True)
        left_entries, lang = await transcribe_channel(client, left_path, speaker_id=0, audio_offset=audio_offset)
        if lang:
            detected_language = lang

        print(json.dumps({"status": "transcribing_chunk", "chunk": 2, "total": 2}), flush=True)
        right_entries, lang = await transcribe_channel(client, right_path, speaker_id=1, audio_offset=audio_offset)
        if lang and not detected_language:
            detected_language = lang
    finally:
        for p in (left_path, right_path):
            if os.path.exists(p):
                os.unlink(p)

    transcript = sorted(left_entries + right_entries, key=lambda e: e["start"])
    duration_out = duration if duration > 0 else (transcript[-1]["end"] if transcript else 0)

    print(
        json.dumps({
            "status": "done",
            "transcript": transcript,
            "duration": duration_out,
            "fps": 0,
            "language": detected_language or "en",
            "model": "deepgram:nova-3",
        }),
        flush=True,
    )


def split_audio_if_needed(audio_path: str) -> tuple[List[str], Optional[str]]:
    size = os.path.getsize(audio_path)
    if size <= MAX_DEEPGRAM_FILE_SIZE:
        return [audio_path], None

    print(json.dumps({"status": "chunking_audio"}), flush=True)
    temp_dir = tempfile.mkdtemp(prefix="clipper-chunks-")
    pattern = os.path.join(temp_dir, FRAGMENT_TEMPLATE)
    subprocess.run(
        [
            "ffmpeg", "-i", audio_path,
            "-f", "segment",
            "-segment_time", str(CHUNK_DURATION_SECONDS),
            "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "16000", "-ac", "1",
            pattern, "-y",
        ],
        capture_output=True, check=True,
    )

    chunks = sorted(Path(temp_dir).glob("chunk-*.mp3"))
    if not chunks:
        raise RuntimeError("Chunking produced no files")

    chunk_paths = [str(c) for c in chunks]
    print(json.dumps({"status": "chunking_complete", "chunks": len(chunk_paths)}), flush=True)
    return chunk_paths, temp_dir


def get_chunk_offsets(audio_path: str, num_chunks: int) -> List[float]:
    offsets: List[float] = []
    for i in range(num_chunks):
        target = i * CHUNK_DURATION_SECONDS
        if target == 0:
            offsets.append(0.0)
            continue
        try:
            output = run_command([
                "ffprobe", "-v", "error",
                "-read_intervals", f"{target}%+#1",
                "-show_entries", "packet=pts_time",
                "-select_streams", "a:0",
                "-of", "default=noprint_wrappers=1:nokey=1",
                audio_path,
            ])
            val = output.strip().split("\n")[0]
            offsets.append(float(val) if val and val != "N/A" else float(target))
        except Exception:
            offsets.append(float(target))
    return offsets


def build_transcript_entries(chunk_data: dict, offset: float) -> List[dict]:
    utterances = chunk_data.get("results", {}).get("utterances") or []
    if not utterances:
        channels = chunk_data.get("results", {}).get("channels", [])
        if channels:
            alt = (channels[0].get("alternatives") or [{}])[0]
            words = alt.get("words") or []
            utterances = [
                {
                    "start": words[0].get("start", 0) if words else 0,
                    "end": words[-1].get("end", 0) if words else 0,
                    "transcript": alt.get("transcript", ""),
                    "words": words,
                }
            ]

    entries: List[dict] = []
    for utt in utterances:
        raw_words = utt.get("words") or []
        entries.append(
            {
                "start": round((utt.get("start") or 0) + offset, 2),
                "end": round((utt.get("end") or 0) + offset, 2),
                "text": (utt.get("transcript") or "").strip(),
                "words": [
                    {
                        "word": word.get("punctuated_word") or word.get("word") or "",
                        "start": round((word.get("start") or 0) + offset, 3),
                        "end": round((word.get("end") or 0) + offset, 3),
                        "confidence": word.get("confidence"),
                        "speaker": word.get("speaker"),
                    }
                    for word in raw_words
                ],
            }
        )
    return entries


async def run_transcription(audio_path: str, audio_offset: float = 0.0) -> None:
    """Single async entry point — all Deepgram calls happen here."""
    _, duration = get_audio_metadata(audio_path)
    chunk_paths, chunk_dir = split_audio_if_needed(audio_path)
    total_chunks = len(chunk_paths)
    offsets = get_chunk_offsets(audio_path, total_chunks) if total_chunks > 1 else [0.0]

    client = AsyncDeepgramClient(api_key=os.environ["DEEPGRAM_API_KEY"])
    transcript: List[dict] = []
    detected_language: Optional[str] = None

    try:
        for idx, chunk_path in enumerate(chunk_paths, start=1):
            print(
                json.dumps({"status": "transcribing_chunk", "chunk": idx, "total": total_chunks}),
                flush=True,
            )

            transcribe_kwargs = dict(
                model="nova-3",
                smart_format=True,
                punctuate=True,
                utterances=True,
                diarize=True,
                paragraphs=True,
            )
            if detected_language:
                transcribe_kwargs["language"] = detected_language

            with open(chunk_path, "rb") as f:
                audio_bytes = f.read()

            response = await client.listen.v1.media.transcribe_file(
                request=audio_bytes,
                **transcribe_kwargs,
            )

            chunk_data = response.model_dump()
            transcript.extend(build_transcript_entries(chunk_data, offsets[idx - 1] + audio_offset))

            if not detected_language:
                channels = chunk_data.get("results", {}).get("channels", [])
                if channels:
                    detected_language = channels[0].get("detected_language")
    finally:
        if chunk_dir and os.path.exists(chunk_dir):
            shutil.rmtree(chunk_dir)

    duration = duration if duration > 0 else (transcript[-1]["end"] if transcript else 0)

    print(
        json.dumps(
            {
                "status": "done",
                "transcript": transcript,
                "duration": duration,
                "fps": 0,
                "language": detected_language or "en",
                "model": "deepgram:nova-3",
            }
        ),
        flush=True,
    )


async def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: transcribe.py <audio_path>"}), flush=True)
        sys.exit(1)

    audio_path = sys.argv[1]

    if not os.path.exists(audio_path):
        print(json.dumps({"error": f"File not found: {audio_path}"}), flush=True)
        sys.exit(1)

    is_video = any(audio_path.lower().endswith(ext) for ext in VIDEO_EXTENSIONS)
    is_audio = any(audio_path.lower().endswith(ext) for ext in AUDIO_EXTENSIONS)

    if not is_audio and not is_video:
        print(json.dumps({"error": "Unsupported file type. Please provide a video (mp4, mov) or audio file (mp3, wav, m4a, etc.)"}), flush=True)
        sys.exit(1)

    if not os.environ.get("DEEPGRAM_API_KEY"):
        print(json.dumps({"error": "DEEPGRAM_API_KEY not set"}), flush=True)
        sys.exit(1)

    extracted_audio_path: Optional[str] = None
    audio_offset = 0.0

    try:
        if is_video:
            # Capture audio stream start_time so we can shift Deepgram timestamps
            audio_start, _ = get_audio_metadata(audio_path)
            audio_offset = audio_start

            channels = get_channel_count(audio_path)
            print(json.dumps({"status": "channel_detected", "channels": channels}), flush=True)
            if channels >= 2 and is_channel_isolated(audio_path):
                # Channel-isolated stereo: left = host (speaker 0), right = caller (speaker 1)
                await run_stereo_transcription(audio_path, audio_offset=audio_offset)
                return
            # Mono OR cross-talk stereo -> fall through to mono extraction + diarization.
            # The mono ffmpeg call below uses -ac 1, which downmixes cross-talk stereo for us.

            # Mono video: fall through to standard extraction + diarization
            print(json.dumps({"status": "extracting_audio"}), flush=True)
            fd, tmp = tempfile.mkstemp(suffix=".mp3", prefix="clipper-audio-")
            os.close(fd)
            result = subprocess.run(
                ["ffmpeg", "-i", audio_path, "-vn", "-ar", "16000", "-ac", "1", "-b:a", "128k",
                 "-avoid_negative_ts", "make_zero", tmp, "-y"],
                capture_output=True, text=True,
            )
            if result.returncode != 0:
                print(json.dumps({"error": f"ffmpeg audio extraction failed: {result.stderr.strip()}"}), flush=True)
                sys.exit(1)
            size_mb = round(os.path.getsize(tmp) / (1024 * 1024), 1)
            print(json.dumps({"status": "audio_extracted", "size_mb": size_mb, "audio_offset": audio_offset}), flush=True)
            extracted_audio_path = tmp
            audio_path = tmp

        await run_transcription(audio_path, audio_offset=audio_offset)
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), flush=True)
        sys.exit(1)
    finally:
        if extracted_audio_path and os.path.exists(extracted_audio_path):
            os.unlink(extracted_audio_path)


if __name__ == "__main__":
    asyncio.run(main())
