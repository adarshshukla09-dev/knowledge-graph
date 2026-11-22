import { z } from "zod";

export const ImportanceSchema = z.enum(["low", "medium", "high"]);
export const EvidenceTypeSchema = z.enum(["explicit", "inferred", "uncertain"]);

export const EvidenceSchema = z.object({
  type: EvidenceTypeSchema,
  text: z.string(),
  explanation: z.string(),
});

const timestampedObject = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object({
      ...shape,
      start: z.number().nonnegative(),
      end: z.number().nonnegative(),
    })
    .refine((item) => {
      const range = item as { start: number; end: number };
      return range.end >= range.start;
    }, {
      message: "End timestamp must be greater than or equal to start",
    });

export const StoryBeatSchema = timestampedObject({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  description: z.string(),
  purpose: z.string(),
  importance: ImportanceSchema,
});

export const TranscriptConceptSchema = timestampedObject({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  definition: z.string().nullable(),
  examples: z.array(z.string()),
  properties: z.array(z.string()),
  relatedConcepts: z.array(z.string()),
  prerequisites: z.array(z.string()),
  evidence: z.array(EvidenceSchema),
  importance: ImportanceSchema,
  segmentReferences: z.array(z.string()),
});

export const TranscriptClaimSchema = timestampedObject({
  id: z.string(),
  claim: z.string(),
  claimType: z.enum([
    "fact",
    "opinion",
    "argument",
    "prediction",
    "recommendation",
    "definition",
    "other",
  ]),
  supportingEvidence: z.array(z.string()),
  reasoning: z.string().nullable(),
  importance: ImportanceSchema,
  segmentReferences: z.array(z.string()),
});

export const KeyPhraseSchema = timestampedObject({
  text: z.string(),
  category: z.string(),
  importance: ImportanceSchema,
  purpose: z.string(),
});

export const TechnicalTermSchema = timestampedObject({
  term: z.string(),
  definition: z.string().nullable(),
  context: z.string(),
  relatedTerms: z.array(z.string()),
});

export const ExplanationTechniqueSchema = timestampedObject({
  technique: z.string(),
  description: z.string(),
  example: z.string().nullable(),
});

export const LearningObjectiveSchema = timestampedObject({
  id: z.string(),
  objective: z.string(),
  relatedConcepts: z.array(z.string()),
  importance: ImportanceSchema,
});

export const AnalyzedTranscriptSegmentSchema = timestampedObject({
  segmentId: z.string(),
  originalText: z.string(),
  meaning: z.string(),
  function: z.string(),
  rhetoricalPurpose: z.string().nullable(),
  conceptReferences: z.array(z.string()),
  claimReferences: z.array(z.string()),
  importance: ImportanceSchema,
  evidenceType: EvidenceTypeSchema,
});

export const TranscriptAnalysisSchema = z.object({
  videoUnderstanding: z.object({
    mainTopic: z.string(),
    centralIdea: z.string(),
    domain: z.array(z.string()),
    subTopics: z.array(z.string()),
    contentType: z.string(),
    targetAudience: z.string().nullable(),
    assumedKnowledge: z.array(z.string()),
    learningLevel: z.string().nullable(),
  }),

  hook: timestampedObject({
    text: z.string(),
    hookType: z.string(),
    curiosityGap: z.string().nullable(),
    purpose: z.string(),
  }).nullable(),

  storytelling: z.object({
    beats: z.array(StoryBeatSchema),
    overallStructure: z.string(),
    narrativeArc: z.string(),
    opening: z.string(),
    development: z.string(),
    climax: z.string().nullable(),
    resolution: z.string().nullable(),
  }),

  concepts: z.array(TranscriptConceptSchema),
  claims: z.array(TranscriptClaimSchema),
  keyPhrases: z.array(KeyPhraseSchema),
  technicalTerms: z.array(TechnicalTermSchema),
  explanationTechniques: z.array(ExplanationTechniqueSchema),
  learningObjectives: z.array(LearningObjectiveSchema),
  segments: z.array(AnalyzedTranscriptSegmentSchema),

  rhetoricalAnalysis: z.object({
    questions: z.array(z.string()),
    repetition: z.array(z.string()),
    persuasiveTechniques: z.array(z.string()),
    emotionalAppeals: z.array(z.string()),
  }),

  conclusion: z.object({
    summary: z.string(),
    keyTakeaways: z.array(z.string()),
    unresolvedQuestions: z.array(z.string()),
    callToAction: z.string().nullable(),
  }),
});

export type TranscriptAnalysis = z.infer<typeof TranscriptAnalysisSchema>;
export type TranscriptEvidence = z.infer<typeof EvidenceSchema>;
export type StoryBeat = z.infer<typeof StoryBeatSchema>;
export type TranscriptConcept = z.infer<typeof TranscriptConceptSchema>;
export type TranscriptClaim = z.infer<typeof TranscriptClaimSchema>;
export type KeyPhrase = z.infer<typeof KeyPhraseSchema>;
export type TechnicalTerm = z.infer<typeof TechnicalTermSchema>;
export type ExplanationTechnique = z.infer<typeof ExplanationTechniqueSchema>;
export type LearningObjective = z.infer<typeof LearningObjectiveSchema>;
export type AnalyzedTranscriptSegment = z.infer<
  typeof AnalyzedTranscriptSegmentSchema
>;
export type Importance = z.infer<typeof ImportanceSchema>;
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;
