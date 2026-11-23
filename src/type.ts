export type Importance = "low" | "medium" | "high";

export type EvidenceType = "explicit" | "inferred" | "uncertain";

export interface TranscriptEvidence {
  type: EvidenceType;
  text: string;
  explanation: string;
}

export interface StoryBeat {
  id: string;
  type: string;
  title: string;
  start: number;
  end: number;
  description: string;
  purpose: string;
  importance: Importance;
}

export interface TranscriptConcept {
  id: string;
  name: string;
  category: string;
  definition: string | null;
  examples: string[];
  properties: string[];
  relatedConcepts: string[];
  prerequisites: string[];
  evidence: TranscriptEvidence[];
  start: number;
  end: number;
  importance: Importance;
}

export interface TranscriptClaim {
  id: string;
  claim: string;
  claimType:
    | "fact"
    | "opinion"
    | "argument"
    | "prediction"
    | "recommendation"
    | "definition"
    | "other";
  supportingEvidence: string[];
  reasoning: string | null;
  start: number;
  end: number;
  importance: Importance;
}

export interface KeyPhrase {
  text: string;
  category: string;
  start: number;
  end: number;
  importance: Importance;
  purpose: string;
}

export interface TechnicalTerm {
  term: string;
  definition: string | null;
  context: string;
  relatedTerms: string[];
  start: number;
  end: number;
}

export interface ExplanationTechnique {
  technique: string;
  description: string;
  example: string | null;
  start: number;
  end: number;
}

export interface LearningObjective {
  id: string;
  objective: string;
  relatedConcepts: string[];
  start: number;
  end: number;
  importance: Importance;
}

export interface WhisperSegment {
  id?: number;
  start: number;
  end: number;
  text: string;
  [key: string]: unknown;
}

export interface AnalyzedTranscriptSegment {
  segmentId: string;
  start: number;
  end: number;
  originalText: string;
  meaning: string;
  function: string;
  rhetoricalPurpose: string | null;
  conceptReferences: string[];
  claimReferences: string[];
  importance: Importance;
  evidenceType: EvidenceType;
}

export type { TranscriptAnalysis } from "./schema/transcriptAnalyze.schema.js";

export type { FrameAnalysis } from "./schema/visualAnalyze.schema.js";
export type { ImageAssetAnalysis } from "./schema/analyze.schema.js";

export type { MultimodalAlignment } from "./schema/analyze.schema.js";

export type {
  TemporalAlignment,
  SemanticAlignment,
} from "./schema/analyze.schema.js";

export type { UnifiedConcept, TimelineEvent } from "./schema/analyze.schema.js";

export type { MergedVideoAnalysis } from "./schema/analyze.schema.js";

export interface WhisperInferenceResponse {
  text?: string;
  segments?: WhisperSegment[];
  [key: string]: unknown;
}

export interface ExtractedFrame {
  frameId: string;
  filePath: string;
  timestamp: number;
  sourceSegmentId: string | null;
}
//  # 1. Preview what will be kept vs deleted (safe dry run)
// npx tsx src/utlis/findDulipcate.ts ./output/1_mp4/frames 1

// # 2. Move duplicates to a backup/review folder first (recommended)
// npx tsx src/utlis/findDulipcate.ts ./output/1_mp4/frames 1 --move ./output/1_mp4/duplicates

// # 3. Permanently delete duplicate frames (keeps 1 frame per cluster)
// npx tsx src/utlis/findDulipcate.ts ./output/1_mp4/frames 1 --delete
