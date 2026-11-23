import fs from "node:fs/promises";
import path from "node:path";

import {
  probeVideo,
  extractFramesWithTimestamps,
  extractAudioForTranscription,
  type VideoMetadata,
} from "./ffmeg.js";

type StageStatus = "pending" | "running" | "completed" | "failed" | "skipped";

interface ProcessingStage {
  status: StageStatus;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

interface ManifestFrame {
  frameId: string;
  filePath: string;
  timestamp: number;
  fileSizeBytes: number;
}

interface ManifestAudio {
  filePath: string;
  format: "wav";
  codec: "pcm_s16le";
  sampleRate: 16000;
  channels: 1;
  fileSizeBytes: number;
}

export interface VideoManifest {
  manifestVersion: "1.1";

  videoId: string;

  createdAt: string;
  updatedAt: string;

  source: {
    originalPath: string;
    fileName: string;
    fileSizeBytes: number;
  };

  metadata: VideoMetadata | null;

  media: {
    frames: ManifestFrame[];
    audio: ManifestAudio | null;
  };

  processingConfig: {
    pipelineVersion: string;
    frameIntervalSeconds: number;
    audioSampleRate: 16000;
    audioChannels: 1;
    frameTimestampMethod: "nominal_sampling_interval";
  };

  processing: {
    metadata: ProcessingStage;

    frameExtraction: ProcessingStage & {
      totalFrames: number;
    };

    audioExtraction: ProcessingStage;
  };

  analysis: {
    transcription: StageStatus;
    sceneDetection: StageStatus;
    frameAnalysis: StageStatus;
    videoAnalysis: StageStatus;
  };
}

interface CreateManifestOptions {
  videoId: string;
  videoPath: string;
  projectRoot?: string;
  frameIntervalSeconds?: number;
}

function createStage(): ProcessingStage {
  return {
    status: "pending",
    startedAt: null,
    completedAt: null,
    error: null,
  };
}

function toRelativePath(projectRoot: string, filePath: string): string {
  const relativePath = path.relative(projectRoot, filePath);

  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`File must be inside the project directory: ${filePath}`);
  }

  return relativePath.split(path.sep).join("/");
}

function validateVideoId(videoId: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(videoId)) {
    throw new Error(
      "Invalid videoId. Use 1-100 characters containing only letters, numbers, underscores, and hyphens. The ID must start with a letter or number.",
    );
  }
}

async function getFileSize(filePath: string): Promise<number> {
  const stats = await fs.stat(filePath);
  return stats.size;
}

async function saveManifest(
  manifestPath: string,
  manifest: VideoManifest,
): Promise<void> {
  manifest.updatedAt = new Date().toISOString();

  const temporaryPath = `${manifestPath}.tmp`;

  await fs.writeFile(temporaryPath, JSON.stringify(manifest, null, 2), "utf8");

  await fs.rename(temporaryPath, manifestPath);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Creates a video manifest and extracts its source media.
 *
 * Note:
 * This version records stage progress and failures.
 * It does not yet skip completed extraction stages on reruns.
 */
export async function createVideoManifest(
  options: CreateManifestOptions,
): Promise<VideoManifest> {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());

  const videoId = options.videoId;

  validateVideoId(videoId);

  const frameIntervalSeconds = options.frameIntervalSeconds ?? 3;

  if (!Number.isFinite(frameIntervalSeconds) || frameIntervalSeconds <= 0) {
    throw new Error("frameIntervalSeconds must be a positive number.");
  }

  const videoPath = path.resolve(projectRoot, options.videoPath);

  const relativeVideoPath = toRelativePath(projectRoot, videoPath);

  const manifestDirectory = path.join(projectRoot, "video-manifests");

  const outputDirectory = path.join(projectRoot, "media", videoId);

  const frameDirectory = path.join(outputDirectory, "frames");

  const audioPath = path.join(outputDirectory, "audio.wav");

  const manifestPath = path.join(manifestDirectory, `${videoId}.json`);

  await fs.mkdir(manifestDirectory, {
    recursive: true,
  });

  await fs.mkdir(outputDirectory, {
    recursive: true,
  });

  // Preserve creation time when updating an existing manifest.
  let createdAt = new Date().toISOString();

  try {
    const existingContent = await fs.readFile(manifestPath, "utf8");

    const existingManifest = JSON.parse(existingContent);

    if (typeof existingManifest.createdAt === "string") {
      createdAt = existingManifest.createdAt;
    }
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }

  const sourceStats = await fs.stat(videoPath);

  if (!sourceStats.isFile()) {
    throw new Error("videoPath must point to a file.");
  }

  const manifest: VideoManifest = {
    manifestVersion: "1.1",

    videoId,

    createdAt,
    updatedAt: createdAt,

    source: {
      originalPath: relativeVideoPath,
      fileName: path.basename(videoPath),
      fileSizeBytes: sourceStats.size,
    },

    metadata: null,

    media: {
      frames: [],
      audio: null,
    },

    processingConfig: {
      pipelineVersion: "1.0.0",
      frameIntervalSeconds,
      audioSampleRate: 16000,
      audioChannels: 1,
      frameTimestampMethod: "nominal_sampling_interval",
    },

    processing: {
      metadata: createStage(),

      frameExtraction: {
        ...createStage(),
        totalFrames: 0,
      },

      audioExtraction: createStage(),
    },

    analysis: {
      transcription: "pending",
      sceneDetection: "pending",
      frameAnalysis: "pending",
      videoAnalysis: "pending",
    },
  };

  await saveManifest(manifestPath, manifest);

  // --------------------------------------------------
  // STAGE 1: Technical metadata
  // --------------------------------------------------

  try {
    manifest.processing.metadata.status = "running";
    manifest.processing.metadata.startedAt = new Date().toISOString();

    await saveManifest(manifestPath, manifest);

    manifest.metadata = await probeVideo(videoPath);

    manifest.processing.metadata.status = "completed";
    manifest.processing.metadata.completedAt = new Date().toISOString();

    // Store a portable relative path in the manifest.
    manifest.metadata.filePath = relativeVideoPath;

    await saveManifest(manifestPath, manifest);
  } catch (error) {
    manifest.processing.metadata.status = "failed";
    manifest.processing.metadata.error = getErrorMessage(error);

    await saveManifest(manifestPath, manifest);

    throw error;
  }

  // --------------------------------------------------
  // STAGE 2: Frame extraction
  // --------------------------------------------------

  try {
    manifest.processing.frameExtraction.status = "running";
    manifest.processing.frameExtraction.startedAt = new Date().toISOString();

    await saveManifest(manifestPath, manifest);

    const extractedFrames = await extractFramesWithTimestamps(
      videoPath,
      frameDirectory,
      frameIntervalSeconds,
    );

    const frames: ManifestFrame[] = await Promise.all(
      extractedFrames.map(async (frame) => ({
        frameId: frame.frameId,

        filePath: toRelativePath(projectRoot, frame.filePath),

        timestamp: frame.timestamp,

        fileSizeBytes: await getFileSize(frame.filePath),
      })),
    );

    manifest.media.frames = frames;

    manifest.processing.frameExtraction.totalFrames = frames.length;

    manifest.processing.frameExtraction.status = "completed";
    manifest.processing.frameExtraction.completedAt = new Date().toISOString();

    await saveManifest(manifestPath, manifest);
  } catch (error) {
    manifest.processing.frameExtraction.status = "failed";
    manifest.processing.frameExtraction.error = getErrorMessage(error);

    await saveManifest(manifestPath, manifest);

    throw error;
  }

  // --------------------------------------------------
  // STAGE 3: Audio extraction
  // --------------------------------------------------

  if (manifest.metadata.hasAudio) {
    try {
      manifest.processing.audioExtraction.status = "running";
      manifest.processing.audioExtraction.startedAt = new Date().toISOString();

      await saveManifest(manifestPath, manifest);

      const extractedAudioPath = await extractAudioForTranscription(
        videoPath,
        audioPath,
      );

      manifest.media.audio = {
        filePath: toRelativePath(projectRoot, extractedAudioPath),

        format: "wav",
        codec: "pcm_s16le",
        sampleRate: 16000,
        channels: 1,

        fileSizeBytes: await getFileSize(extractedAudioPath),
      };

      manifest.processing.audioExtraction.status = "completed";

      manifest.processing.audioExtraction.completedAt =
        new Date().toISOString();

      await saveManifest(manifestPath, manifest);
    } catch (error) {
      manifest.processing.audioExtraction.status = "failed";
      manifest.processing.audioExtraction.error = getErrorMessage(error);

      await saveManifest(manifestPath, manifest);

      throw error;
    }
  } else {
    manifest.processing.audioExtraction.status = "skipped";
    manifest.processing.audioExtraction.completedAt = new Date().toISOString();

    await saveManifest(manifestPath, manifest);
  }

  console.log(`Video manifest saved: ${manifestPath}`);

  return manifest;
}
