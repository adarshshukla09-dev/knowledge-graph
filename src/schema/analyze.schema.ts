import { z } from "zod";
import {
  ImportanceSchema,
  LearningObjectiveSchema,
} from "./transcriptAnalyze.schema.js";

// These detailed asset-reconstruction fields are intentionally separate from
// FrameAnalysis: they describe how to recreate an asset, not merely observe it.
const CharacterSchema = z.object({
  charId: z.string(),
  archetype: z.string(),
  pose: z.string(),
  expression: z.string().nullable(),
  imagePrompt: z.string(),
  speechBubble: z.string().nullable(),
  colors: z.array(z.string()),
  geometryPrimitives: z.array(z.string()),
  svgCode: z.string().nullable(),
  svgPrompt: z.string(),
});

const VisualElementAssetSchema = z.object({
  elementId: z.string(),
  name: z.string(),
  category: z.enum([
    "prop",
    "building",
    "nature",
    "vehicle",
    "furniture",
    "symbol",
    "decoration",
    "other",
  ]),
  zIndex: z.number(),
  positionHint: z.string(),
  colors: z.array(z.string()),
  geometryPrimitives: z.array(z.string()),
  svgCode: z.string().nullable(),
  svgPrompt: z.string(),
});

const BackgroundSchema = z.object({
  scenario: z.string(),
  settingType: z.enum(["indoor", "outdoor", "abstract", "mixed", "unknown"]),
  backgroundPrompt: z.string(),
  colors: z.array(z.string()),
  svgCode: z.string().nullable(),
  svgPrompt: z.string(),
});

const DetailedFrameSchema = z.object({
  frameId: z.string(),
  startTimestampSec: z.number().nonnegative(),
  composition: z.object({
    layoutType: z.string(),
    cameraFraming: z.string(),
    description: z.string(),
  }),
  visibleElements: z.object({
    characters: z.array(CharacterSchema),
    elements: z.array(VisualElementAssetSchema),
    background: BackgroundSchema,
  }),
  onScreenText: z.object({
    topHeader: z.string().nullable(),
    bottomCaption: z.string().nullable(),
    signageText: z.array(z.string()),
  }),
  visualType: z.string(),
  visualPurpose: z.string(),
  visualStyle: z.string(),
  informationBeingCommunicated: z.string(),
  conceptsVisuallyRepresented: z.array(z.string()),
  importance: ImportanceSchema,
});

export const ImageAssetAnalysisSchema = z.object({
  assetId: z.string(),
  sourceMeta: z.object({
    domainTags: z.array(z.string()),
    aspectRatio: z.string(),
    paletteHex: z.array(z.string()),
    lineStyle: z.string(),
  }),
  overallVisualStyle: z.string(),
  visualNarrative: z.string(),
  visualTechniques: z.array(z.string()),
  frames: z.array(DetailedFrameSchema),
});

export const TemporalAlignmentSchema = z
  .object({
    alignmentId: z.string(),
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
    transcriptSegmentIds: z.array(z.string()),
    frameIds: z.array(z.string()),
  })
  .refine((item) => item.end >= item.start, {
    message: "Alignment end must be greater than or equal to start",
  });

export const SemanticAlignmentSchema = z.object({
  alignmentId: z.string(),
  relationship: z.enum([
    "supports",
    "illustrates",
    "demonstrates",
    "complements",
    "contrasts",
    "independent",
    "unclear",
  ]),
  spokenMeaning: z.string(),
  visualMeaning: z.string(),
  explanation: z.string(),
  consistency: z.enum([
    "consistent",
    "partially_consistent",
    "inconsistent",
    "not_applicable",
  ]),
  importance: ImportanceSchema,
});

export const MultimodalAlignmentSchema = z
  .object({
    alignmentId: z.string(),
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
    transcriptSegmentIds: z.array(z.string()),
    frameIds: z.array(z.string()),
    spokenMeaning: z.string(),
    visualMeaning: z.string(),
    relationship: SemanticAlignmentSchema.shape.relationship,
    explanation: z.string(),
    consistency: SemanticAlignmentSchema.shape.consistency,
    importance: ImportanceSchema,
  })
  .refine((item) => item.end >= item.start, {
    message: "Alignment end must be greater than or equal to start",
  });

export const UnifiedConceptSchema = z.object({
  conceptId: z.string(),
  name: z.string(),
  definition: z.string().nullable(),
  sources: z.array(z.enum(["transcript", "visual", "both"])),
  transcriptReferences: z.array(z.string()),
  frameReferences: z.array(z.string()),
  importance: ImportanceSchema,
});

export const TimelineEventSchema = z
  .object({
    eventId: z.string(),
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
    title: z.string(),
    description: z.string(),
    transcriptSegmentIds: z.array(z.string()),
    frameIds: z.array(z.string()),
    concepts: z.array(z.string()),
    eventType: z.string(),
    importance: ImportanceSchema,
  })
  .refine((item) => item.end >= item.start, {
    message: "Timeline event end must be greater than or equal to start",
  });

export const MergedVideoAnalysisSchema = z.object({
  videoSummary: z.string(),
  mainTopic: z.string(),
  centralMessage: z.string(),
  domain: z.array(z.string()),
  targetAudience: z.string().nullable(),
  narrativeStructure: z.string(),
  transcriptSummary: z.string(),
  visualCommunicationSummary: z.string(),
  keyTakeaways: z.array(z.string()),
  learningObjectives: z.array(LearningObjectiveSchema),
  unifiedConcepts: z.array(UnifiedConceptSchema),
  timeline: z.array(TimelineEventSchema),
  multimodalAlignments: z.array(MultimodalAlignmentSchema),
  importantMoments: z.array(
    z
      .object({
        start: z.number().nonnegative(),
        end: z.number().nonnegative(),
        description: z.string(),
        transcriptSegmentIds: z.array(z.string()),
        frameIds: z.array(z.string()),
        importance: ImportanceSchema,
      })
      .refine((item) => item.end >= item.start, {
        message: "Important moment end must be greater than or equal to start",
      }),
  ),
  consistencyReport: z.object({
    consistent: z.number().int().nonnegative(),
    partiallyConsistent: z.number().int().nonnegative(),
    inconsistent: z.number().int().nonnegative(),
    independent: z.number().int().nonnegative(),
    notApplicable: z.number().int().nonnegative(),
    summary: z.string(),
  }),
});

export type ImageAssetAnalysis = z.infer<typeof ImageAssetAnalysisSchema>;
export type TemporalAlignment = z.infer<typeof TemporalAlignmentSchema>;
export type SemanticAlignment = z.infer<typeof SemanticAlignmentSchema>;
export type MultimodalAlignment = z.infer<typeof MultimodalAlignmentSchema>;
export type UnifiedConcept = z.infer<typeof UnifiedConceptSchema>;
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;
export type MergedVideoAnalysis = z.infer<typeof MergedVideoAnalysisSchema>;
