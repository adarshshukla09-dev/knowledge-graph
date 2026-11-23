import fs from "node:fs/promises";
import path from "node:path";
import { Agent, request as undiciRequest } from "undici";

const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";
const MODEL = "gemma4:e4b";

const ollamaAgent = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
});

function sanitizeFrameAnalysis(frameAnalysis: any) {
  const stripSvg = (item: any) => {
    if (!item || typeof item !== "object") return item;
    const { svgScript, svgPrompt, ...rest } = item;
    return rest;
  };

  const sanitizeOne = (frame: any) => {
    if (!frame || typeof frame !== "object") return frame;
    const copy = { ...frame };
    if (copy.mainCharacterPrompt) {
      copy.mainCharacterPrompt = stripSvg(copy.mainCharacterPrompt);
    }
    if (Array.isArray(copy.sidecharacterPrompt)) {
      copy.sidecharacterPrompt = copy.sidecharacterPrompt.map(stripSvg);
    }
    if (copy.background && Array.isArray(copy.background.elements)) {
      copy.background = {
        ...copy.background,
        elements: copy.background.elements.map(stripSvg),
      };
    }
    return copy;
  };

  return Array.isArray(frameAnalysis)
    ? frameAnalysis.map(sanitizeOne)
    : sanitizeOne(frameAnalysis);
}

function extractJsonObject(raw: string): string {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }

  return cleaned;
}

// ==========================================
// VIDEO ANALYZER
// ==========================================

export async function analyzeVideo({
  videoId,
  frameAnalysis,
  transcript,
  duration,
}: {
  videoId: string;
  frameAnalysis: any;
  transcript: string;
  duration: number;
}) {
  const compactFrames = sanitizeFrameAnalysis(frameAnalysis);

  const prompt = `
You are an expert video content strategist,
storytelling analyst, retention specialist,
social media strategist and video editor.

Analyze the supplied video information.

Your objective is to reverse-engineer the video
and understand WHY it works, HOW it communicates,
and HOW it could be recreated or improved.

==========================================
VIDEO INFORMATION
==========================================

VIDEO ID:
${videoId}

DURATION:
${duration} seconds

FRAME ANALYSIS:
${JSON.stringify(compactFrames, null, 2)}

AUDIO TRANSCRIPTION:
${transcript}

==========================================
1. VIDEO OVERVIEW
==========================================

Extract:

- Video title
- Category
- Topic
- Summary
- Central message
- Target audience
- Purpose

==========================================
2. HOOK ANALYSIS
==========================================

Analyze the opening of the video.

Identify:

- Exact opening hook
- Hook type
- Hook duration
- Opening visual
- Opening dialogue
- Attention trigger
- Hook effectiveness
- Improvement suggestions

Possible hook types:

- Curiosity
- Question
- Shocking statement
- Controversy
- Emotional
- Storytelling
- Unexpected visual
- Problem identification
- Promise
- Statistics

Do not assume a hook exists if the opening
does not contain one.

Score hook strength from 0 to 10.

==========================================
3. STORY ANALYSIS
==========================================

Identify:

- Introduction
- Problem
- Conflict
- Climax
- Resolution
- Story structure
- Storytelling technique

Explain how the story progresses.

==========================================
4. SCENE ANALYSIS
==========================================

Combine visual frame analysis and transcription.

Identify logical scenes.

For each scene provide:

- Scene number
- Start time
- End time
- Purpose
- Visual summary
- Narration
- Main emotion
- Retention purpose
- Transition

Do not treat every extracted frame as a separate scene.

Only create scene boundaries when supported
by changes in location, action, narrative or visuals.

If exact timestamps are unavailable,
mark them as null rather than inventing them.

==========================================
5. CHARACTER ANALYSIS
==========================================

Identify main and supporting characters.

Explain their roles in the story.

==========================================
6. AUDIO ANALYSIS
==========================================

Analyze:

- Narration style
- Speaking tone
- Speech pacing
- Background music, if supported by evidence
- Sound effects, if supported by evidence
- Audio and visual synchronization

Do not claim music or sound effects are present
unless the supplied information establishes them.

==========================================
7. ENGAGEMENT ANALYSIS
==========================================

Identify:

- Attention triggers
- Curiosity loops
- Emotional triggers
- Pattern interruptions
- Retention techniques
- Weak points

Explain WHY each technique might engage viewers.

==========================================
8. VISUAL ANALYSIS
==========================================

Analyze:

- Visual style
- Color strategy
- Camera techniques
- Transitions
- Text overlays
- Visual storytelling

==========================================
9. CONTENT STRATEGY
==========================================

Identify:

- Content type
- Likely platform
- Target audience
- Value proposition
- Shareability
- Potential virality factors

Do not claim actual platform performance
or virality without analytics data.

==========================================
10. ENDING ANALYSIS
==========================================

Identify:

- Ending type
- Final message
- Call to action
- Effectiveness

If no CTA exists, return null.

==========================================
11. PERFORMANCE SCORES
==========================================

Rate:

- Hook
- Story
- Visuals
- Audio
- Engagement

Each score must be between 0 and 10.

Explain the reasoning in the relevant analysis sections.

These are qualitative estimates, not measured
audience-retention or performance metrics.

==========================================
12. IMPROVEMENTS
==========================================

Provide actionable suggestions for:

- Hook
- Story
- Visuals
- Audio
- Retention

==========================================
13. RECREATION PROMPT
==========================================

Generate:

- Complete video recreation prompt
- Individual scene prompts
- Narration prompt
- Editing instructions

The recreation should preserve the original
story concept while allowing creative improvements.

==========================================
IMPORTANT RULES
==========================================

1. Use only supplied evidence.
2. Do not invent dialogue.
3. Do not invent timestamps.
4. Separate observations from interpretations.
5. Do not confuse visual scene changes with frame changes.
6. Do not assume actual engagement metrics.
7. Preserve the original narrative.
8. Return valid JSON only.

==========================================
EXPECTED JSON
==========================================

{
  "videoId": "${videoId}",

  "overview": {
    "title": "",
    "category": "",
    "topic": "",
    "summary": "",
    "centralMessage": "",
    "targetAudience": "",
    "videoPurpose": ""
  },

  "hookAnalysis": {
    "hook": "",
    "hookType": "",
    "hookDuration": "",
    "openingVisual": "",
    "openingDialogue": "",
    "attentionTrigger": "",
    "hookStrength": 0,
    "improvementSuggestion": ""
  },

  "storyAnalysis": {
    "storyStructure": "",
    "introduction": "",
    "problem": "",
    "conflict": "",
    "climax": "",
    "resolution": "",
    "storytellingTechnique": ""
  },

  "sceneAnalysis": [
    {
      "sceneNo": 1,
      "startTime": null,
      "endTime": null,
      "purpose": "",
      "visualSummary": "",
      "narration": "",
      "emotion": "",
      "retentionPurpose": "",
      "transition": ""
    }
  ],

  "characterAnalysis": {
    "mainCharacters": [],
    "sideCharacters": []
  },

  "audioAnalysis": {
    "narrationStyle": "",
    "speakingTone": "",
    "speechPacing": "",
    "backgroundMusic": "",
    "soundEffects": [],
    "audioVisualSynchronization": ""
  },

  "engagementAnalysis": {
    "attentionTriggers": [],
    "curiosityLoops": [],
    "emotionalTriggers": [],
    "patternInterruptions": [],
    "retentionTechniques": [],
    "weakPoints": []
  },

  "visualAnalysis": {
    "visualStyle": "",
    "colorStrategy": "",
    "cameraTechniques": [],
    "transitions": [],
    "textOverlays": [],
    "visualStorytelling": ""
  },

  "contentStrategy": {
    "contentType": "",
    "platform": "",
    "targetAudience": "",
    "valueProposition": "",
    "shareability": "",
    "viralityFactors": []
  },

  "endingAnalysis": {
    "endingType": "",
    "finalMessage": "",
    "callToAction": null,
    "effectiveness": ""
  },

  "performanceAnalysis": {
    "hookScore": 0,
    "storyScore": 0,
    "visualScore": 0,
    "audioScore": 0,
    "engagementScore": 0,
    "overallScore": 0
  },

  "improvements": {
    "hookImprovements": [],
    "storyImprovements": [],
    "visualImprovements": [],
    "audioImprovements": [],
    "retentionImprovements": []
  },

  "recreationPrompt": {
    "videoPrompt": "",
    "scenePrompts": [],
    "narrationPrompt": "",
    "editingInstructions": ""
  },

  "tags": []
}
`;

  console.log(`Analyzing video with ${MODEL} (${videoId})...`);

  const { statusCode, body } = await undiciRequest(OLLAMA_URL, {
    method: "POST",
    dispatcher: ollamaAgent,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      format: "json",
      stream: true,
      options: {
        temperature: 0,
        num_ctx: 8192,
      },
    }),
  });

  if (statusCode < 200 || statusCode >= 300) {
    const errText = await body.text();
    throw new Error(`Ollama error (${statusCode}): ${errText}`);
  }

  const decoder = new TextDecoder();
  let fullContent = "";
  let buffer = "";
  let chunkCount = 0;

  for await (const chunk of body) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const parsed = JSON.parse(trimmed) as {
        message?: { content?: string };
        done?: boolean;
        error?: string;
      };

      if (parsed.error) {
        throw new Error(`Ollama stream error: ${parsed.error}`);
      }

      if (parsed.message?.content) {
        fullContent += parsed.message.content;
        chunkCount++;
        if (chunkCount % 50 === 0) {
          console.log(
            `Video stream: ${chunkCount} chunks (${fullContent.length} chars)...`,
          );
        }
      }
    }
  }

  if (buffer.trim()) {
    const trailing = JSON.parse(buffer.trim()) as {
      message?: { content?: string };
      error?: string;
    };
    if (trailing.error) {
      throw new Error(`Ollama stream error: ${trailing.error}`);
    }
    if (trailing.message?.content) {
      fullContent += trailing.message.content;
    }
  }
  const outputDir2 = path.resolve("./video-analysis");
  await fs.mkdir(outputDir2, { recursive: true });
  const debugPath = path.join(outputDir2, `raw-${videoId}.txt`);
  await fs.writeFile(debugPath, fullContent, "utf8");
  const analysis = parseModelJson(fullContent, debugPath);
  const outputDir = path.resolve("./video-analysis");
  await fs.mkdir(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, `${videoId}.json`);
  await fs.writeFile(outputPath, JSON.stringify(analysis, null, 2), "utf8");

  console.log("Video analysis completed!");
  console.log("Saved:", outputPath);

  return analysis;
}
function parseModelJson(raw: string, debugFilePath: string) {
  const extracted = extractJsonObject(raw);

  try {
    return JSON.parse(extracted);
  } catch (firstErr) {
    // Repair raw unescaped newlines/tabs inside string literals
    let repaired = "";
    let inString = false;
    let escaped = false;

    for (let i = 0; i < extracted.length; i++) {
      const ch = extracted[i];

      if (escaped) {
        repaired += ch;
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        repaired += ch;
        escaped = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        repaired += ch;
        continue;
      }

      if (inString && ch === "\n") {
        repaired += "\\n";
        continue;
      }

      if (inString && ch === "\r") {
        repaired += "\\r";
        continue;
      }

      if (inString && ch === "\t") {
        repaired += "\\t";
        continue;
      }

      repaired += ch;
    }

    try {
      return JSON.parse(repaired);
    } catch (secondErr) {
      console.error("Failed to parse JSON even after newline repair.");
      console.error("Raw model output saved to:", debugFilePath);
      throw firstErr;
    }
  }
}
