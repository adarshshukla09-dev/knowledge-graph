import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface FFprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
}
interface FFprobeOutput {
  streams: FFprobeStream[];
  format: {
    duration?: string;
    format_name?: string;
  };
}
export interface VideoMetadata {
  filePath: string;
  fileName: string;
  duration: number;
  format: string | null;
  width: number;
  height: number;
  fps: number;
  aspectRatio: string;
  videoCodec: string | null;
  audioCodec: string | null;
  audioSampleRate: number | null;
  audioChannels: number | null;
  hasAudio: boolean;
}
export interface ExtractedFrame {
  frameId: string;
  filePath: string;
  timestamp: number;
}

function parseFrameRate(value?: string): number {
  if (!value) return 0;

  const [numerator, denominator] = value.split("/").map(Number);

  if (!numerator || !denominator) return 0;

  return numerator / denominator;
}
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
function getAspectRatio(width: number, height: number): string {
  if (!width || !height) return "unknown";

  const divisor = gcd(width, height);

  return `${width / divisor}:${height / divisor}`;
}

export async function probeVideo(videoPath: string): Promise<VideoMetadata> {
  const resolvedPath = path.resolve(videoPath);

  await fs.access(resolvedPath);

  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    resolvedPath,
  ]);

  const result = JSON.parse(stdout) as FFprobeOutput;

  const videoStream = result.streams.find(
    (stream) => stream.codec_type === "video",
  );

  const audioStream = result.streams.find(
    (stream) => stream.codec_type === "audio",
  );

  if (!videoStream) {
    throw new Error("No video stream found in input file.");
  }

  const width = videoStream.width ?? 0;
  const height = videoStream.height ?? 0;

  const duration = Number(result.format.duration ?? videoStream.duration);

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Could not determine video duration.");
  }

  return {
    filePath: resolvedPath,
    fileName: path.basename(resolvedPath),
    duration,
    format: result.format.format_name ?? null,
    width,
    height,
    fps: parseFrameRate(videoStream.avg_frame_rate ?? videoStream.r_frame_rate),
    aspectRatio: getAspectRatio(width, height),
    videoCodec: videoStream.codec_name ?? null,
    audioCodec: audioStream?.codec_name ?? null,
    audioSampleRate: audioStream?.sample_rate
      ? Number(audioStream.sample_rate)
      : null,
    audioChannels: audioStream?.channels ?? null,
    hasAudio: Boolean(audioStream),
  };
}
export async function extractFrameAtTimestamp(
  videoPath: string,
  outputPath: string,
  timestamp: number,
): Promise<string> {
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new Error("Invalid frame timestamp.");
  }

  const resolvedVideoPath = path.resolve(videoPath);
  const resolvedOutputPath = path.resolve(outputPath);

  await fs.access(resolvedVideoPath);

  await fs.mkdir(path.dirname(resolvedOutputPath), {
    recursive: true,
  });

  await execFileAsync("ffmpeg", [
    "-y",
    "-ss",
    timestamp.toFixed(3),
    "-i",
    resolvedVideoPath,
    "-frames:v",
    "1",
    "-update",
    "1",
    resolvedOutputPath,
  ]);

  return resolvedOutputPath;
}
export async function extractFramesWithTimestamps(
  videoPath: string,
  outputDir: string,
  intervalSeconds = 3,
): Promise<ExtractedFrame[]> {
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    throw new Error("intervalSeconds must be positive.");
  }

  const resolvedVideoPath = path.resolve(videoPath);
  const resolvedOutputDir = path.resolve(outputDir);

  await fs.access(resolvedVideoPath);
  await fs.mkdir(resolvedOutputDir, { recursive: true });

  // Remove stale frames from previous extraction runs.
  const existingFiles = await fs.readdir(resolvedOutputDir);

  for (const file of existingFiles) {
    if (/^frame_\d+\.png$/i.test(file)) {
      await fs.unlink(path.join(resolvedOutputDir, file));
    }
  }

  const outputPattern = path.join(resolvedOutputDir, "frame_%04d.png");

  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    resolvedVideoPath,
    "-vf",
    `fps=1/${intervalSeconds}`,
    "-fps_mode",
    "vfr",
    outputPattern,
  ]);

  const files = (await fs.readdir(resolvedOutputDir))
    .filter((file) => /^frame_\d+\.png$/i.test(file))
    .sort();

  return files.map((file, index) => ({
    frameId: `frame_${String(index + 1).padStart(4, "0")}`,
    filePath: path.join(resolvedOutputDir, file),
    timestamp: index * intervalSeconds,
  }));
}
export async function extractFramesEverySeconds(
  videoPath: string,
  outputDir: string,
  intervalSeconds = 3,
): Promise<string[]> {
  const frames = await extractFramesWithTimestamps(
    videoPath,
    outputDir,
    intervalSeconds,
  );

  return frames.map((frame) => frame.filePath);
}
export async function extractAudioForTranscription(
  videoPath: string,
  outputAudioPath: string,
): Promise<string> {
  const resolvedVideoPath = path.resolve(videoPath);
  const resolvedAudioPath = path.resolve(outputAudioPath);

  await fs.access(resolvedVideoPath);

  await fs.mkdir(path.dirname(resolvedAudioPath), {
    recursive: true,
  });

  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    resolvedVideoPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    resolvedAudioPath,
  ]);

  return resolvedAudioPath;
}
