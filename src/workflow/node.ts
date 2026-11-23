// node.ts

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { Agent, FormData, request as undiciRequest } from "undici";
import { z } from "zod";

import type {
  ExtractedFrame,
  WhisperInferenceResponse,
  WhisperSegment,
} from "../type.js";

import type {
  MergedVideoAnalysis,
  MultimodalAlignment,
  SemanticAlignment,
  TemporalAlignment,
  TimelineEvent,
  UnifiedConcept,
} from "../schema/analyze.schema.js";

import {
  extractAudioForTranscription,
  extractFrameAtTimestamp,
  probeVideo,
} from "../videoProcessing/ffmeg.js";

import { getVideoOutputPaths } from "../utlis/helper.js";
import { model } from "../utlis/model.js";
import type { VideoIngestStateType } from "./state.js";
import { TranscriptAnalysisSchema } from "../schema/transcriptAnalyze.schema.js";
import {
  MergedVideoAnalysisSchema,
  SemanticAlignmentSchema,
} from "../schema/analyze.schema.js";

import {
  FrameAnalysisSchema,
  type FrameAnalysis as FrameAnalysisOutput,
} from "../schema/visualAnalyze.schema.js";

// --------------------------------------------------
// Configuration
// --------------------------------------------------

const WHISPER_SERVER_URL =
  process.env.WHISPER_SERVER_URL ?? "http://localhost:8080/inference";

const FRAME_INTERVAL_SECONDS = 2;

const whisperAgent = new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  headersTimeout: 0,
  bodyTimeout: 0,
});

// --------------------------------------------------
// Shared helpers
// --------------------------------------------------

export function getSegmentId(index: number): string {
  return `segment_${String(index + 1).padStart(4, "0")}`;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function createVisualConceptId(name: string): string {
  const normalized = name.trim().toLowerCase();
  const hash = createHash("sha256")
    .update(normalized)
    .digest("hex")
    .slice(0, 12);
  return `visual_${hash}`;
}

// --------------------------------------------------
// Probe video
// --------------------------------------------------

export async function probeVideoNode(
  state: VideoIngestStateType,
): Promise<Partial<VideoIngestStateType>> {
  if (!state.ingest_video_path) {
    throw new Error("Missing required state field: ingest_video_path");
  }

  const videoMetadata = await probeVideo(state.ingest_video_path);

  return {
    videoMetadata,
    error: null,
  };
}

// --------------------------------------------------
// Extract audio
// --------------------------------------------------

export async function extractAudioNode(
  state: VideoIngestStateType,
): Promise<Partial<VideoIngestStateType>> {
  const metadata =
    state.videoMetadata ?? (await probeVideo(state.ingest_video_path));

  if (!metadata.hasAudio) {
    return {
      videoMetadata: metadata,
      audioPath: null,
      transcript: "",
      segments: [],
      transcriptionRaw: null,
    };
  }

  const paths = getVideoOutputPaths(metadata.filePath, state.output_dir);

  await fs.mkdir(paths.audioDir, { recursive: true });

  const parsedName = path.parse(metadata.fileName).name;

  const targetWavPath = path.join(paths.audioDir, `${parsedName}_16k_mono.wav`);

  const audioPath = await extractAudioForTranscription(
    metadata.filePath,
    targetWavPath,
  );

  return {
    videoMetadata: metadata,
    audioPath,
  };
}

// --------------------------------------------------
// Whisper transcription
// --------------------------------------------------

export async function transcribeAudioNode(
  state: VideoIngestStateType,
): Promise<Partial<VideoIngestStateType>> {
  if (!state.audioPath) {
    return {
      transcript: "",
      segments: [],
      transcriptionRaw: null,
    };
  }

  const wavBuffer = await fs.readFile(state.audioPath);

  const formData = new FormData();

  formData.append(
    "file",
    new Blob([wavBuffer], { type: "audio/wav" }),
    path.basename(state.audioPath),
  );

  formData.append("response_format", "verbose_json");

  const { statusCode, body } = await undiciRequest(WHISPER_SERVER_URL, {
    method: "POST",
    body: formData,
    dispatcher: whisperAgent,
  });

  if (statusCode < 200 || statusCode >= 300) {
    const bodyText = await body.text().catch(() => "");

    throw new Error(
      `whisper.cpp transcription failed (${statusCode}): ${bodyText}`,
    );
  }

  const rawText = await body.text();

  const data = JSON.parse(rawText) as WhisperInferenceResponse;

  const transcript = typeof data.text === "string" ? data.text.trim() : "";

  const segments: WhisperSegment[] = Array.isArray(data.segments)
    ? data.segments
        .filter(
          (segment) =>
            typeof segment.start === "number" &&
            Number.isFinite(segment.start) &&
            typeof segment.end === "number" &&
            Number.isFinite(segment.end) &&
            segment.start >= 0 &&
            segment.end >= segment.start &&
            typeof segment.text === "string",
        )
        .map((segment, index) => ({
          ...segment,
          id: typeof segment.id === "number" ? segment.id : index,
          start: segment.start,
          end: segment.end,
          text: segment.text,
        }))
    : [];

  const duration = state.videoMetadata?.duration;

  const invalidSegments = segments.filter(
    (segment) =>
      typeof duration === "number" &&
      (segment.start > duration + 0.05 || segment.end > duration + 0.05),
  );

  if (invalidSegments.length > 0) {
    throw new Error(
      `Whisper returned ${invalidSegments.length} segments outside video duration.`,
    );
  }

  return {
    transcript,
    segments,
    transcriptionRaw: data,
  };
}

// --------------------------------------------------
// Extract multiple frames per transcript segment
// --------------------------------------------------

// --------------------------------------------------
// Extract one frame at each transcript segment start
// --------------------------------------------------

export async function extractFramesNode(
  state: VideoIngestStateType,
): Promise<Partial<VideoIngestStateType>> {
  if (!state.videoMetadata) {
    throw new Error("Video metadata is missing.");
  }

  const videoPath = state.videoMetadata.filePath;
  const duration = state.videoMetadata.duration;

  const paths = getVideoOutputPaths(videoPath, state.output_dir);

  await fs.mkdir(paths.framesDir, { recursive: true });

  // Remove previously generated frames.
  const existingFiles = await fs.readdir(paths.framesDir);

  await Promise.all(
    existingFiles
      .filter((file) => /^frame_\d+_.*\.png$/i.test(file))
      .map((file) => fs.unlink(path.join(paths.framesDir, file))),
  );

  const frames: ExtractedFrame[] = [];

  // One frame for each Whisper segment, using its START timestamp.
  for (let index = 0; index < state.segments.length; index++) {
    const segment = state.segments[index];

    if (!segment) continue;

    const timestamp = segment.start;

    if (timestamp < 0 || timestamp >= duration) {
      console.warn(
        `Skipping segment ${index + 1}: timestamp ${timestamp}s is outside video duration.`,
      );
      continue;
    }

    const frameId = `frame_${String(frames.length + 1).padStart(4, "0")}`;

    const frameName = `${frameId}_${timestamp.toFixed(2)}s.png`;

    const framePath = path.join(paths.framesDir, frameName);

    await extractFrameAtTimestamp(videoPath, framePath, timestamp);

    frames.push({
      frameId,
      filePath: framePath,
      timestamp,
      sourceSegmentId: getSegmentId(index),
    });
  }

  console.log(
    `Extracted ${frames.length} frames from ${state.segments.length} transcript segments.`,
  );

  return {
    frames,
    framesDir: paths.framesDir,
  };
}

// --------------------------------------------------
// Analyze transcript independently
// --------------------------------------------------

export async function analyzeTranscriptNode(
  state: VideoIngestStateType,
): Promise<Partial<VideoIngestStateType>> {
  if (!state.transcript || state.segments.length === 0) {
    return {
      transcriptAnalysis: null,
    };
  }

  const transcriptModel = model.withStructuredOutput(TranscriptAnalysisSchema, {
    name: "deep_transcript_analysis",
  });

  const transcriptData = state.segments.map((segment, index) => ({
    segmentId: getSegmentId(index),

    start: segment.start,

    end: segment.end,

    text: segment.text,
  }));

  const prompt = `
You are an expert multimodal video transcript intelligence
and educational content analysis system.

Analyze the COMPLETE spoken transcript.

You are responsible for extracting structured knowledge,
not merely producing a summary.

IMPORTANT RULES:

1. Analyze only the supplied transcript.
2. Never infer anything about video frames or visual content.
3. Preserve the speaker's original meaning.
4. Never invent statements, facts, examples or terminology.
5. Do not treat opinions as verified facts.
6. Distinguish explicit information from reasonable inference.
7. Use only supplied timestamps.
8. Every timestamp must fall within the relevant source segment
   or the actual span of the referenced content.
9. Preserve segment IDs exactly.
10. Preserve original Whisper text exactly.
11. Analyze the entire transcript, not just the beginning.
12. Avoid duplicate concepts and claims.
13. If information is unavailable, use null or empty arrays.
14. Do not invent a call to action if none exists.

==================================================
A. VIDEO UNDERSTANDING
==================================================

Identify:

- Main topic.
- Central idea.
- Main domain.
- Subtopics.
- Content type.
- Intended audience, if identifiable.
- Assumed prior knowledge.
- Educational or learning level.

Distinguish the subject of the video from its central message.

==================================================
B. HOOK ANALYSIS
==================================================

Analyze the opening.

Identify:

- Exact hook text.
- Start and end timestamps.
- Hook category.
- Curiosity gap.
- Intended psychological or informational purpose.

Possible hook categories:

- question
- surprising_fact
- bold_claim
- problem_statement
- storytelling
- emotional
- controversy
- promise
- demonstration
- other

If there is no identifiable hook, return null.

==================================================
C. STORYTELLING AND NARRATIVE STRUCTURE
==================================================

Identify the overall narrative structure.

Possible story beats:

- introduction
- problem
- context
- question
- explanation
- example
- evidence
- comparison
- conflict
- turning_point
- conclusion
- call_to_action

For each beat extract:

- Unique ID.
- Type.
- Title.
- Start and end timestamps.
- Description.
- Narrative purpose.
- Importance.

Explain:

- Opening.
- Development.
- Narrative arc.
- Climax, if present.
- Resolution, if present.

Do not force a story structure onto purely informational content.

==================================================
D. CONCEPT AND KNOWLEDGE EXTRACTION
==================================================

Extract all meaningful concepts.

For every concept identify:

- Unique ID.
- Name.
- Category.
- Definition.
- Examples.
- Properties.
- Related concepts.
- Prerequisite concepts.
- Supporting transcript evidence.
- Segment references using the supplied segmentId values.
- Start and end timestamps.
- Importance.

Concept categories may include:

- scientific_concept
- technical_concept
- educational_concept
- social_concept
- economic_concept
- historical_concept
- philosophical_concept
- general_concept

Do not create concepts merely by splitting sentences.

Concepts must represent meaningful knowledge.

==================================================
E. CLAIM AND ARGUMENT EXTRACTION
==================================================

Identify important claims made by the speaker.

Classify them as:

- fact
- opinion
- argument
- prediction
- recommendation
- definition
- other

For every claim extract:

- Unique ID.
- Claim statement.
- Supporting evidence mentioned in transcript.
- Reasoning.
- Start and end timestamps.
- Segment references using the supplied segmentId values.
- Importance.

Do not independently verify claims.
A speaker's assertion must not automatically become an established fact.

==================================================
F. TERMINOLOGY AND KEY PHRASES
==================================================

Extract:

- Technical terms.
- Definitions.
- Context of usage.
- Related terminology.
- Important phrases.
- Repeated phrases.
- Emphasized expressions.

Preserve exact wording when possible.

==================================================
G. EXPLANATION TECHNIQUES
==================================================

Identify how the speaker communicates knowledge.

Possible techniques:

- analogy
- metaphor
- comparison
- storytelling
- real_world_example
- hypothetical_example
- definition
- step_by_step_explanation
- cause_and_effect
- question_and_answer
- repetition
- demonstration
- simplification
- contrast
- statistical_reasoning

For each technique provide:

- Technique.
- Description.
- Example from transcript.
- Timestamp.

==================================================
H. LEARNING OBJECTIVES
==================================================

Identify what the audience should understand after watching.

Extract:

- Learning objective.
- Related concepts.
- Timestamp.
- Importance.

Do not invent learning objectives unrelated to the spoken content.

==================================================
I. SEGMENT-LEVEL ANALYSIS
==================================================

Analyze EVERY supplied transcript segment.

For each segment:

- Preserve segmentId.
- Preserve originalText.
- Preserve start and end.
- Explain its meaning.
- Identify its communication function.
- Identify rhetorical purpose.
- Reference related concept IDs.
- Reference related claim IDs.
- Use only IDs that exist in the supplied transcript segments,
  concepts, and claims.
- Assign importance.
- Assign evidence type.

Possible functions:

- introduces_topic
- establishes_context
- defines_concept
- explains_concept
- provides_example
- presents_evidence
- makes_argument
- compares_ideas
- asks_question
- transitions
- summarizes
- concludes
- calls_to_action
- other

==================================================
J. RHETORICAL ANALYSIS
==================================================

Identify:

- Questions used by the speaker.
- Repetition.
- Persuasive techniques.
- Emotional appeals.
- Emphasis and rhetorical patterns.

Only report patterns supported by the transcript.

==================================================
K. CONCLUSION
==================================================

Extract:

- Overall spoken conclusion.
- Key takeaways.
- Unresolved questions.
- Explicit call to action.

==================================================
EVIDENCE AND CONFIDENCE RULES
==================================================

Use explicit when directly stated.

Use inferred when reasonably derived from the transcript.

Use uncertain when evidence is insufficient.

Never turn an inference into an explicit statement.

Do not create artificial timestamps.

TRANSCRIPT DATA:

${JSON.stringify(transcriptData)}

Return the complete structured transcript analysis.
`;

  const analysis = await transcriptModel.invoke(prompt);

  // Application-owned segment identity and timestamps.
  const originalSegments = new Map(
    transcriptData.map((segment) => [segment.segmentId, segment]),
  );

  const returnedSegmentIds = new Set<string>();

  const validatedSegments = analysis.segments.map((segment) => {
    if (returnedSegmentIds.has(segment.segmentId)) {
      throw new Error(`Duplicate transcript segment: ${segment.segmentId}`);
    }
    returnedSegmentIds.add(segment.segmentId);

    const original = originalSegments.get(segment.segmentId);

    if (!original) {
      throw new Error(`Unknown transcript segment: ${segment.segmentId}`);
    }

    return {
      ...segment,

      segmentId: original.segmentId,

      start: original.start,

      end: original.end,

      originalText: original.text,
    };
  });

  const missingSegments = transcriptData.filter(
    (segment) => !returnedSegmentIds.has(segment.segmentId),
  );
  if (missingSegments.length > 0) {
    throw new Error(
      `Transcript model omitted segments: ${missingSegments
        .map((segment) => segment.segmentId)
        .join(", ")}`,
    );
  }

  const segmentById = new Map(
    transcriptData.map((segment) => [segment.segmentId, segment]),
  );
  const segmentIds = new Set(segmentById.keys());
  const conceptIds = new Set(analysis.concepts.map((concept) => concept.id));
  const normalizedConceptNames = analysis.concepts.map((concept) =>
    concept.name.trim().toLowerCase(),
  );
  const conceptNames = new Set(normalizedConceptNames);
  const claimIds = new Set(analysis.claims.map((claim) => claim.id));

  if (conceptIds.size !== analysis.concepts.length) {
    throw new Error("Transcript analysis contains duplicate concept IDs.");
  }
  if (conceptNames.size !== normalizedConceptNames.length) {
    throw new Error(
      "Transcript analysis contains duplicate normalized concept names.",
    );
  }
  if (claimIds.size !== analysis.claims.length) {
    throw new Error("Transcript analysis contains duplicate claim IDs.");
  }

  const TIMESTAMP_TOLERANCE_SECONDS = 0.25;

  const validateSegmentBoundTimestamps = (
    label: string,
    start: number,
    end: number,
    segmentReferences: string[],
  ) => {
    for (const segmentId of segmentReferences) {
      const refSegment = segmentById.get(segmentId);
      if (!refSegment) {
        throw new Error(
          `Unknown transcript segment reference "${segmentId}" in ${label}`,
        );
      }

      if (
        end < refSegment.start - TIMESTAMP_TOLERANCE_SECONDS ||
        start > refSegment.end + TIMESTAMP_TOLERANCE_SECONDS
      ) {
        throw new Error(
          `Timestamp range [${start}s, ${end}s] for ${label} does not overlap referenced segment ${segmentId} [${refSegment.start}s, ${refSegment.end}s].`,
        );
      }
    }
  };

  for (const concept of analysis.concepts) {
    for (const relatedConcept of [
      ...concept.relatedConcepts,
      ...concept.prerequisites,
    ]) {
      if (
        !conceptIds.has(relatedConcept) &&
        !conceptNames.has(relatedConcept.trim().toLowerCase())
      ) {
        throw new Error(
          `Unknown related concept "${relatedConcept}" in concept "${concept.id}"`,
        );
      }
    }

    validateSegmentBoundTimestamps(
      `concept "${concept.id}"`,
      concept.start,
      concept.end,
      concept.segmentReferences,
    );
  }

  for (const objective of analysis.learningObjectives) {
    for (const relatedConcept of objective.relatedConcepts) {
      if (
        !conceptIds.has(relatedConcept) &&
        !conceptNames.has(relatedConcept.trim().toLowerCase())
      ) {
        throw new Error(
          `Unknown related concept "${relatedConcept}" in learning objective "${objective.id}"`,
        );
      }
    }
  }

  for (const claim of analysis.claims) {
    validateSegmentBoundTimestamps(
      `claim "${claim.id}"`,
      claim.start,
      claim.end,
      claim.segmentReferences,
    );
  }

  for (const segment of validatedSegments) {
    for (const conceptId of segment.conceptReferences) {
      if (!conceptIds.has(conceptId)) {
        throw new Error(
          `Unknown concept reference "${conceptId}" in segment "${segment.segmentId}"`,
        );
      }
    }

    for (const claimId of segment.claimReferences) {
      if (!claimIds.has(claimId)) {
        throw new Error(
          `Unknown claim reference "${claimId}" in segment "${segment.segmentId}"`,
        );
      }
    }
  }

  const duration = state.videoMetadata?.duration;
  if (typeof duration === "number" && Number.isFinite(duration)) {
    const timestampedEntries: { label: string; start: number; end: number }[] =
      [];
    if (analysis.hook) {
      timestampedEntries.push({ label: "hook", ...analysis.hook });
    }
    for (const [kind, entries] of [
      ["story beat", analysis.storytelling.beats],
      ["concept", analysis.concepts],
      ["claim", analysis.claims],
      ["key phrase", analysis.keyPhrases],
      ["technical term", analysis.technicalTerms],
      ["explanation technique", analysis.explanationTechniques],
      ["learning objective", analysis.learningObjectives],
      ["transcript segment", validatedSegments],
    ] as const) {
      for (const entry of entries) {
        timestampedEntries.push({
          label: `${kind} ${"id" in entry ? entry.id : ""}`.trim(),
          start: entry.start,
          end: entry.end,
        });
      }
    }

    const outOfRange = timestampedEntries.find(
      (entry) => entry.start > duration + 0.05 || entry.end > duration + 0.05,
    );
    if (outOfRange) {
      throw new Error(
        `Timestamp range for ${outOfRange.label} exceeds video duration (${duration}s).`,
      );
    }
  }

  const analysisWithValidatedSegments = {
    ...analysis,

    segments: validatedSegments,
  };

  return {
    transcriptAnalysis: analysisWithValidatedSegments,
  };
}

// --------------------------------------------------
// Analyze frames independently
// --------------------------------------------------

export async function analyzeFramesNode(
  state: VideoIngestStateType,
): Promise<Partial<VideoIngestStateType>> {
  if (!state.frames.length) {
    return {
      frameAnalysis: null,
    };
  }

  const frameModel = model.withStructuredOutput(FrameAnalysisSchema, {
    name: "video_frame_analysis",
  });

  const BATCH_SIZE = 4;

  const allFrames: FrameAnalysisOutput["frames"] = [];
  const visualNarratives: string[] = [];
  const visualStyles: string[] = [];

  const visualTechniques: string[] = [];

  for (let i = 0; i < state.frames.length; i += BATCH_SIZE) {
    const batch = state.frames.slice(i, i + BATCH_SIZE);

    const imageContents = await Promise.all(
      batch.map(async (frame) => {
        const imageBuffer = await fs.readFile(frame.filePath);

        return {
          type: "image_url" as const,

          image_url: {
            url: `data:image/png;base64,${imageBuffer.toString("base64")}`,
          },
        };
      }),
    );

    const frameMetadata = batch.map((frame) => ({
      frameId: frame.frameId,
      timestamp: frame.timestamp,
      sourceSegmentId: frame.sourceSegmentId,
    }));

    const prompt = `
You are an expert visual intelligence and image understanding system.

Your task is to perform detailed visual decomposition of the
provided video frames.

Analyze ONLY observable visual information.

Do not infer narration.
Do not invent visual objects.
Do not invent unreadable text.
Do not assume missing details.
Preserve all supplied frame IDs and timestamps exactly.

OBJECTIVES:

1. OVERALL VISUAL STYLE

Identify:

- Overall visual style.
- Illustration or photography category.
- Rendering techniques.
- Overall visual narrative.

Use descriptive and reusable style terminology.

Examples:

- 2d_illustration
- editorial
- social_commentary
- flat_design
- vector_art
- comic_art
- infographic

2. VISUAL COMPOSITION

For every frame identify:

- Layout type.
- Camera framing.
- Foreground.
- Midground.
- Background.
- Spatial relationships.
- Visual hierarchy.
- Direction of movement.

3. VISIBLE ELEMENTS

Describe important observable objects and people without identifying
real individuals. Record their position, visible colors, and role in
the scene. Do not generate image or SVG reconstruction prompts.

4. BACKGROUND

Describe the visible setting, environment, depth cues, and background
colors. Do not generate reconstruction prompts.

5. TEXT

Extract only readable on-screen text. For each item identify its role
and approximate position.

6. VISUAL NARRATIVE

Explain what the image communicates as a complete visual scene.

7. IMPORTANCE

Assign:

- high: central to the visual message.
- medium: supports the message.
- low: decorative or incidental.

IMPORTANT:

Do not confuse a visual interpretation with an observable fact.

If something cannot be determined, use null, an empty array,
or "unknown" as appropriate.

FRAME METADATA:

${JSON.stringify(frameMetadata, null, 2)}

The image order corresponds exactly to the metadata order.

Return the complete structured analysis.
`;

    const message = {
      role: "user" as const,

      content: [
        {
          type: "text" as const,
          text: prompt,
        },

        ...imageContents,
      ],
    };

    const analysis = await frameModel.invoke([message]);

    // Preserve application-owned frame identity and reject incomplete output.
    const returnedFrameIds = new Set<string>();

    for (const analyzedFrame of analysis.frames) {
      if (returnedFrameIds.has(analyzedFrame.frameId)) {
        throw new Error(
          `Duplicate frame returned by visual model: ${analyzedFrame.frameId}`,
        );
      }
      returnedFrameIds.add(analyzedFrame.frameId);

      const original = batch.find(
        (frame) => frame.frameId === analyzedFrame.frameId,
      );

      if (!original) {
        throw new Error(`Unknown frame ID: ${analyzedFrame.frameId}`);
      }

      allFrames.push({
        ...analyzedFrame,

        frameId: original.frameId,

        timestamp: original.timestamp,
        sourceSegmentId: original.sourceSegmentId,
      });
    }

    const missingFrames = batch.filter(
      (frame) => !returnedFrameIds.has(frame.frameId),
    );
    if (missingFrames.length > 0) {
      throw new Error(
        `Visual model omitted frames: ${missingFrames
          .map((frame) => frame.frameId)
          .join(", ")}`,
      );
    }

    visualNarratives.push(analysis.visualNarrative);
    visualStyles.push(analysis.overallVisualStyle);

    visualTechniques.push(...analysis.visualTechniques);
  }

  // Combine batch-level summaries with the frame observations.
  const frameAnalysis = {
    overallVisualStyle: unique(visualStyles).join("\n\n"),
    visualNarrative: visualNarratives.join("\n\n"),
    visualTechniques: unique(visualTechniques),
    frames: allFrames.sort((a, b) => a.timestamp - b.timestamp),
  } satisfies FrameAnalysisOutput;

  return {
    frameAnalysis,
  };
}

// --------------------------------------------------
// Semantic alignment schema
// --------------------------------------------------

const SemanticAlignmentBatchSchema = z.object({
  alignments: z.array(SemanticAlignmentSchema),
});

// --------------------------------------------------
// Semantic alignment using Ollama
// --------------------------------------------------

export async function semanticAlignmentNode(
  state: VideoIngestStateType,
): Promise<Partial<VideoIngestStateType>> {
  const transcriptAnalysis = state.transcriptAnalysis;
  const frameAnalysis = state.frameAnalysis;

  if (!state.temporalAlignments.length) {
    return {
      semanticAlignments: [],
    };
  }

  const validSegmentIds = new Set(
    transcriptAnalysis?.segments.map((segment) => segment.segmentId) ?? [],
  );

  const validFrameIds = new Set(
    frameAnalysis?.frames.map((frame) => frame.frameId) ?? [],
  );

  const alignmentIds = new Set<string>();

  for (const temporal of state.temporalAlignments) {
    if (alignmentIds.has(temporal.alignmentId)) {
      throw new Error(
        `Duplicate temporal alignment ID: ${temporal.alignmentId}`,
      );
    }

    alignmentIds.add(temporal.alignmentId);

    for (const segmentId of temporal.transcriptSegmentIds) {
      if (!validSegmentIds.has(segmentId)) {
        throw new Error(
          `Unknown transcript segment ${segmentId} in ${temporal.alignmentId}`,
        );
      }
    }

    for (const frameId of temporal.frameIds) {
      if (!validFrameIds.has(frameId)) {
        throw new Error(`Unknown frame ${frameId} in ${temporal.alignmentId}`);
      }
    }
  }

  const semanticModel = model.withStructuredOutput(
    SemanticAlignmentBatchSchema,
    {
      name: "semantic_alignment",
    },
  );

  const semanticAlignments: SemanticAlignment[] = [];

  for (const temporal of state.temporalAlignments) {
    const transcriptObservations = temporal.transcriptSegmentIds
      .map((segmentId) =>
        transcriptAnalysis?.segments.find(
          (segment) => segment.segmentId === segmentId,
        ),
      )
      .filter(Boolean);

    const frameObservations = temporal.frameIds
      .map((frameId) =>
        frameAnalysis?.frames.find((frame) => frame.frameId === frameId),
      )
      .filter(Boolean);

    if (transcriptObservations.length === 0 && frameObservations.length > 0) {
      semanticAlignments.push({
        alignmentId: temporal.alignmentId,
        spokenMeaning: "",
        visualMeaning: frameObservations
          .map((frame) => frame!.informationBeingCommunicated)
          .join(" "),
        relationship: "independent",
        explanation:
          "This visual sequence has no associated transcript observation.",
        consistency: "not_applicable",
        importance: "medium",
      });
      continue;
    }

    if (frameObservations.length === 0 && transcriptObservations.length > 0) {
      semanticAlignments.push({
        alignmentId: temporal.alignmentId,
        spokenMeaning: transcriptObservations
          .map((segment) => segment!.meaning)
          .join(" "),
        visualMeaning: "",
        relationship: "unclear",
        explanation:
          "No visual observation is available for this transcript segment.",
        consistency: "not_applicable",
        importance: "medium",
      });
      continue;
    }

    if (transcriptObservations.length === 0 && frameObservations.length === 0) {
      semanticAlignments.push({
        alignmentId: temporal.alignmentId,
        spokenMeaning: "",
        visualMeaning: "",
        relationship: "unclear",
        explanation: "No transcript or visual observation is available.",
        consistency: "not_applicable",
        importance: "low",
      });
      continue;
    }

    const prompt = `
You are an expert multimodal video understanding system.

Determine the semantic relationship between the supplied spoken
observations and visual observations.

IMPORTANT:

1. Temporal alignment has already been determined by the application.
2. Do not change timestamps or IDs.
3. Do not invent transcript or frame observations.
4. Do not assume that a visual represents narration merely because
   it appears at a similar time.
5. Preserve spoken and visual meanings independently.
6. Summarize the supplied spoken and visual meanings separately in
   spokenMeaning and visualMeaning. Use an empty string when a side is
   absent.
7. If there is no transcript observation, classify the visual as
   independent.
8. If there is no visual observation, classify the relationship as
   unclear.
9. Do not classify unrelated content as a contradiction.
10. Use the supplied alignmentId exactly.

Relationship definitions:

- supports: The visual reinforces the spoken explanation.
- illustrates: The visual provides an illustration of a spoken concept.
- demonstrates: The visual shows an action or process being described.
- complements: The visual adds relevant information.
- contrasts: The visual genuinely contrasts with the spoken content.
- independent: The visual communicates independently of narration.
- unclear: The relationship cannot be established confidently.

Consistency:

- consistent: Spoken and visual observations agree.
- partially_consistent: They overlap but communicate different details.
- inconsistent: There is a genuine contradiction.
- not_applicable: A cross-modal consistency judgment cannot be made.
  
Do not infer timestamps. The application owns temporal information.

ALIGNMENT:

${JSON.stringify(temporal, null, 2)}

SPOKEN OBSERVATIONS:

${JSON.stringify(transcriptObservations, null, 2)}

VISUAL OBSERVATIONS:

${JSON.stringify(frameObservations, null, 2)}

Return exactly one semantic alignment for this alignmentId.
`;

    const result = await semanticModel.invoke(prompt);

    if (result.alignments.length !== 1) {
      throw new Error(
        `Expected exactly one semantic alignment for ${temporal.alignmentId}, received ${result.alignments.length}`,
      );
    }

    const [returned] = result.alignments;
    if (!returned || returned.alignmentId !== temporal.alignmentId) {
      throw new Error(
        `Semantic alignment ID mismatch. Expected ${temporal.alignmentId}`,
      );
    }

    semanticAlignments.push({
      ...returned,
      // The model cannot modify application-owned identity.
      alignmentId: temporal.alignmentId,
    });
  }

  return {
    semanticAlignments,
  };
}

// --------------------------------------------------
// Merge analysis without rewriting observations
// --------------------------------------------------

export async function mergeAnalysisNode(
  state: VideoIngestStateType,
): Promise<Partial<VideoIngestStateType>> {
  const transcript = state.transcriptAnalysis;

  const visual = state.frameAnalysis;

  if (!transcript && !visual) {
    return {
      mergedAnalysis: null,
    };
  }

  const semanticById = new Map(
    state.semanticAlignments.map((item) => [item.alignmentId, item]),
  );

  // --------------------------------------------------
  // Multimodal alignments
  // --------------------------------------------------

  const multimodalAlignments: MultimodalAlignment[] =
    state.temporalAlignments.map((temporal) => {
      const semantic = semanticById.get(temporal.alignmentId);

      if (!semantic) {
        throw new Error(
          `Missing semantic alignment for ${temporal.alignmentId}`,
        );
      }

      const spokenSegments = temporal.transcriptSegmentIds
        .map((id) =>
          transcript?.segments.find((segment) => segment.segmentId === id),
        )
        .filter(Boolean);

      const visualFrames = temporal.frameIds
        .map((id) => visual?.frames.find((frame) => frame.frameId === id))
        .filter(Boolean);

      return {
        alignmentId: temporal.alignmentId,
        start: temporal.start,
        end: temporal.end,

        transcriptSegmentIds: temporal.transcriptSegmentIds,

        frameIds: temporal.frameIds,

        spokenMeaning: spokenSegments
          .map((segment) => segment!.meaning)
          .join(" "),

        visualMeaning: visualFrames
          .map((frame) => frame!.informationBeingCommunicated)
          .join(" "),

        relationship: semantic.relationship,

        explanation: semantic.explanation,

        consistency: semantic.consistency,

        importance: semantic.importance,
      };
    });

  // --------------------------------------------------
  // Unified concepts
  // --------------------------------------------------

  const unifiedConceptMap = new Map<string, UnifiedConcept>();

  for (const concept of transcript?.concepts ?? []) {
    unifiedConceptMap.set(concept.name.trim().toLowerCase(), {
      conceptId: concept.id,

      name: concept.name,

      definition: concept.definition,

      sources: ["transcript"],

      transcriptReferences: unique([
        ...concept.segmentReferences,
        ...(transcript?.segments
          .filter((segment) => segment.conceptReferences.includes(concept.id))
          .map((segment) => segment.segmentId) ?? []),
      ]),

      frameReferences: [],

      importance: concept.importance,
    });
  }

  // Visual concepts
  for (const frame of visual?.frames ?? []) {
    for (const visualConcept of frame.conceptsVisuallyRepresented) {
      const normalizedName = visualConcept.trim().toLowerCase();
      if (!normalizedName) continue;

      const key = normalizedName;

      const existing = unifiedConceptMap.get(key);

      if (existing) {
        if (existing.sources.includes("transcript")) {
          existing.sources = ["both"];
        }

        if (!existing.frameReferences.includes(frame.frameId)) {
          existing.frameReferences.push(frame.frameId);
        }
      } else {
        unifiedConceptMap.set(key, {
          conceptId: createVisualConceptId(visualConcept),

          name: visualConcept,

          definition: null,

          sources: ["visual"],

          transcriptReferences: [],

          frameReferences: [frame.frameId],

          importance: frame.importance,
        });
      }
    }
  }

  const unifiedConcepts = [...unifiedConceptMap.values()];

  // --------------------------------------------------
  // Timeline
  // --------------------------------------------------

  const timeline: TimelineEvent[] = multimodalAlignments.map(
    (alignment, index) => {
      const relatedConcepts = unifiedConcepts
        .filter((concept) => {
          return (
            concept.transcriptReferences.some((id) =>
              alignment.transcriptSegmentIds.includes(id),
            ) ||
            concept.frameReferences.some((id) =>
              alignment.frameIds.includes(id),
            )
          );
        })
        .map((concept) => concept.conceptId);

      return {
        eventId: `event_${String(index + 1).padStart(4, "0")}`,

        start: alignment.start,

        end: alignment.end,

        title: `Video event ${index + 1}`,

        description: alignment.explanation,

        transcriptSegmentIds: alignment.transcriptSegmentIds,

        frameIds: alignment.frameIds,

        concepts: relatedConcepts,

        eventType: alignment.relationship,

        importance: alignment.importance,
      };
    },
  );

  // --------------------------------------------------
  // Important moments
  // --------------------------------------------------

  const importantMoments = multimodalAlignments
    .filter((item) => item.importance === "high")
    .map((item) => ({
      start: item.start,
      end: item.end,

      description: item.explanation,

      transcriptSegmentIds: item.transcriptSegmentIds,

      frameIds: item.frameIds,

      importance: item.importance,
    }));

  // --------------------------------------------------
  // Consistency report
  // --------------------------------------------------

  const consistencyReport = {
    consistent: 0,

    partiallyConsistent: 0,

    inconsistent: 0,

    independent: 0,

    notApplicable: 0,

    summary: "",
  };

  for (const item of multimodalAlignments) {
    if (item.relationship === "independent") {
      consistencyReport.independent++;
    }

    if (item.consistency === "consistent") {
      consistencyReport.consistent++;
    }

    if (item.consistency === "partially_consistent") {
      consistencyReport.partiallyConsistent++;
    }

    if (item.consistency === "inconsistent") {
      consistencyReport.inconsistent++;
    }

    if (item.consistency === "not_applicable") {
      consistencyReport.notApplicable++;
    }
  }

  consistencyReport.summary =
    `Consistency: ${consistencyReport.consistent} consistent, ` +
    `${consistencyReport.partiallyConsistent} partially consistent, ` +
    `${consistencyReport.inconsistent} inconsistent, ` +
    `${consistencyReport.notApplicable} not applicable. ` +
    `Relationship: ${consistencyReport.independent} independent.`;

  // --------------------------------------------------
  // Final merged analysis
  // --------------------------------------------------

  const mergedAnalysis: MergedVideoAnalysis = {
    videoSummary: [
      transcript?.videoUnderstanding.centralIdea,
      visual?.visualNarrative,
    ]
      .filter(Boolean)
      .join("\n\n"),

    mainTopic: transcript?.videoUnderstanding.mainTopic ?? "Not available",

    centralMessage:
      transcript?.videoUnderstanding.centralIdea ?? "Not available",

    domain: transcript?.videoUnderstanding.domain ?? [],

    targetAudience: transcript?.videoUnderstanding.targetAudience ?? null,

    narrativeStructure:
      transcript?.storytelling.overallStructure ?? "Not available",

    transcriptSummary: transcript?.conclusion.summary ?? "",

    visualCommunicationSummary: visual?.visualNarrative ?? "",

    keyTakeaways: transcript?.conclusion.keyTakeaways ?? [],

    learningObjectives: transcript?.learningObjectives ?? [],

    unifiedConcepts,

    timeline,

    multimodalAlignments,

    importantMoments,

    consistencyReport,
  };

  const validatedMergedAnalysis =
    MergedVideoAnalysisSchema.parse(mergedAnalysis);

  return {
    mergedAnalysis: validatedMergedAnalysis,
  };
}

// --------------------------------------------------
// Save complete JSON
// --------------------------------------------------

export async function saveTranscriptionJsonNode(
  state: VideoIngestStateType,
): Promise<Partial<VideoIngestStateType>> {
  if (!state.videoMetadata) {
    throw new Error("Video metadata is missing.");
  }

  const paths = getVideoOutputPaths(
    state.videoMetadata.filePath,
    state.output_dir,
  );

  await fs.mkdir(paths.videoOutputDir, {
    recursive: true,
  });

  const segmentsWithFrames = state.segments.map((segment, index) => {
    const segmentId = getSegmentId(index);
    const whisperSegment = state.segments[index];

    const segmentFrames = state.frames.filter(
      (frame) =>
        whisperSegment &&
        frame.timestamp >= whisperSegment.start &&
        frame.timestamp <= whisperSegment.end,
    );

    return {
      ...segment,
      segmentId,
      frames: segmentFrames.map((frame) => ({
        frameId: frame.frameId,
        filePath: frame.filePath,
        timestamp: frame.timestamp,
        sourceSegmentId: frame.sourceSegmentId,
      })),
    };
  });

  const result = {
    video: state.videoMetadata,

    duration: state.videoMetadata.duration,

    transcription: {
      transcript: state.transcript,
      segments: segmentsWithFrames,
      raw: state.transcriptionRaw,
    },

    media: {
      audioPath: state.audioPath,
      framesDir: paths.framesDir,
      frames: state.frames,
    },

    analysis: {
      transcript: state.transcriptAnalysis,
      visual: state.frameAnalysis,
      temporalAlignment: state.temporalAlignments,
      semanticAlignment: state.semanticAlignments,
      multimodal: state.mergedAnalysis,
    },
  };

  await fs.writeFile(paths.jsonPath, JSON.stringify(result, null, 2), "utf-8");

  console.log("Analysis JSON saved:", paths.jsonPath);

  return {
    transcriptionJsonPath: paths.jsonPath,
  };
}

export async function temporalAlignmentNode(
  state: VideoIngestStateType,
): Promise<Partial<VideoIngestStateType>> {
  const transcriptAnalysis = state.transcriptAnalysis;
  const frameAnalysis = state.frameAnalysis;

  if (!transcriptAnalysis && !frameAnalysis) {
    return {
      temporalAlignments: [],
    };
  }

  const temporalAlignments: TemporalAlignment[] = [];

  const assignedFrameIds = new Set<string>();

  // --------------------------------------------------
  // Transcript-based alignments
  // --------------------------------------------------

  if (transcriptAnalysis) {
    for (let index = 0; index < state.segments.length; index++) {
      const whisperSegment = state.segments[index];

      if (!whisperSegment) continue;

      const segmentId = getSegmentId(index);

      const analyzedSegment = transcriptAnalysis.segments.find(
        (segment) => segment.segmentId === segmentId,
      );

      if (!analyzedSegment) continue;

      const matchingFrames = (frameAnalysis?.frames ?? []).filter(
        (frame) =>
          frame.timestamp >= whisperSegment.start &&
          frame.timestamp <= whisperSegment.end,
      );

      const frameIds = matchingFrames.map((frame) => frame.frameId);

      frameIds.forEach((id) => assignedFrameIds.add(id));

      // Preserve transcript segments even without matching frames.
      temporalAlignments.push({
        alignmentId: `alignment_${segmentId}`,

        start: whisperSegment.start,

        end: whisperSegment.end,

        transcriptSegmentIds: [segmentId],

        frameIds,
      });
    }
  }

  // --------------------------------------------------
  // Visual-only alignments
  // --------------------------------------------------

  for (const frame of frameAnalysis?.frames ?? []) {
    if (assignedFrameIds.has(frame.frameId)) continue;

    temporalAlignments.push({
      alignmentId: `alignment_${frame.frameId}`,

      start: frame.timestamp,

      end: frame.timestamp,

      transcriptSegmentIds: [],

      frameIds: [frame.frameId],
    });
  }

  return {
    temporalAlignments: temporalAlignments.sort((a, b) => a.start - b.start),
  };
}
