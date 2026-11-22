import { z } from "zod";
import { ImportanceSchema } from "./transcriptAnalyze.schema.js";

const BoundingBoxSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1),
  })
  .refine(
    (box) => box.x + box.width <= 1.000001 && box.y + box.height <= 1.000001,
    {
      message: "Normalized bounding box must stay within the 0..1 image bounds",
    },
  );

const VisualRegionSchema = z.object({
  regionId: z.string(),
  role: z.enum([
    "header",
    "main_subject",
    "supporting_visual",
    "caption",
    "footer",
    "background",
    "decoration",
    "other",
  ]),
  description: z.string(),
  boundingBox: BoundingBoxSchema,
  text: z.string().nullable(),
  importance: ImportanceSchema,
});

const VisibleElementSchema = z.object({
  elementId: z.string(),
  name: z.string(),
  type: z.string(),
  description: z.string(),
  boundingBox: BoundingBoxSchema.nullable(),
  positionHint: z.string(),
  colors: z.array(z.string()),
  visualRole: z.string(),
  importance: ImportanceSchema,
});

const OnScreenTextSchema = z.object({
  text: z.string(),
  role: z.enum([
    "title",
    "heading",
    "label",
    "caption",
    "subtitle",
    "callout",
    "other",
  ]),
  boundingBox: BoundingBoxSchema.nullable(),
  importance: ImportanceSchema,
});

const FrameCompositionSchema = z.object({
  layoutType: z.string(),
  cameraFraming: z.string(),
  visualHierarchy: z.array(z.string()),
  regions: z.array(VisualRegionSchema),
  description: z.string(),
});

const AnalyzedFrameSchema = z.object({
  frameId: z.string(),
  timestamp: z.number().nonnegative(),
  sourceSegmentId: z.string().nullable(),
  description: z.string(),
  scene: z.object({
    setting: z.string(),
    environment: z.string(),
    activity: z.string(),
    mood: z.string().nullable(),
  }),
  composition: FrameCompositionSchema,
  visibleElements: z.array(VisibleElementSchema),
  onScreenText: z.array(OnScreenTextSchema),
  visualType: z.string(),
  visualPurpose: z.string(),
  visualStyle: z.array(z.string()),
  colorPalette: z.array(z.string()),
  informationBeingCommunicated: z.string(),
  conceptsVisuallyRepresented: z.array(z.string()),
  visualRelationships: z.array(
    z.object({
      subject: z.string(),
      relation: z.string(),
      object: z.string(),
      explanation: z.string(),
    }),
  ),
  importance: ImportanceSchema,
});

export const FrameAnalysisSchema = z.object({
  overallVisualStyle: z.string(),
  visualNarrative: z.string(),
  visualTechniques: z.array(z.string()),
  frames: z.array(AnalyzedFrameSchema),
});


export type FrameAnalysis = z.infer<typeof FrameAnalysisSchema>;
