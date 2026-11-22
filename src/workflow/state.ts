import { Annotation } from "@langchain/langgraph";
import type { VideoMetadata } from "../videoProcessing/ffmeg.js";
import type {
  ExtractedFrame,
  FrameAnalysis,
  MergedVideoAnalysis,
  SemanticAlignment,
  TemporalAlignment,
  TranscriptAnalysis,
  WhisperInferenceResponse,
  WhisperSegment,
} from "../type.js";

export const VideoIngestState = Annotation.Root({
  ingest_video_path: Annotation<string>(),

  output_dir: Annotation<string | undefined>(),

  videoMetadata: Annotation<VideoMetadata | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  audioPath: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  transcript: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  temporalAlignments: Annotation<TemporalAlignment[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  semanticAlignments: Annotation<SemanticAlignment[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  segments: Annotation<WhisperSegment[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  transcriptionRaw: Annotation<WhisperInferenceResponse | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  // Newly extracted frames
  frames: Annotation<ExtractedFrame[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  // Directory containing extracted frames
  framesDir: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  // Generated JSON file
  transcriptionJsonPath: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  transcriptAnalysis: Annotation<TranscriptAnalysis | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  frameAnalysis: Annotation<FrameAnalysis | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  mergedAnalysis: Annotation<MergedVideoAnalysis | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  error: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
});

export type VideoIngestStateType = typeof VideoIngestState.State;
