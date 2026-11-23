import fs from "node:fs/promises";
import path from "node:path";
import { Agent, request as undiciRequest } from "undici";

const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";
const MODEL = "gemma4:e4b";

const ollamaAgent = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
});

// Disable Undici's default 300s headers/body timeouts for slow local vision runs
const ollamaDispatcher = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
});

// ==========================================
// TYPES
// ==========================================

interface SVGComponent {
  svgScript: string;
  svgPrompt: string;
}

interface CharacterComponent extends SVGComponent {
  characterNo: number;
  characterPrompt: string;
  speechBubble: string | null;
  position: string;
  colorPalette: string[];
}

interface BackgroundElement extends SVGComponent {
  elementNo: number;
  name: string;
  category: string;
  description: string;
  color: string;
  position: string;
  depth: "foreground" | "middleGround" | "background";
}

interface ImageAnalysis {
  scenario: string;
  imagePrompt: string;

  mainCharacterPrompt: CharacterComponent | null;

  sidecharacterPrompt: CharacterComponent[];

  background: {
    description: string;
    elements: BackgroundElement[];
  };

  topHeader: string | null;
  bottomSub: string | null;

  colorPalette: {
    name: string;
    hex: string;
    usage: string;
  }[];

  artStyle: {
    style: string;
    linework: string;
    shading: string;
    texture: string;
    lighting: string;
    mood: string;
    typography: string;
  };

  composition: {
    layout: string;
    aspectRatio: string;
    cameraAngle: string;
    perspective: string;
    foreground: string;
    middleGround: string;
    background: string;
  };

  additionalText: {
    text: string;
    position: string;
    color: string;
    style: string;
  }[];
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
// MAIN IMAGE ANALYZER
// ==========================================

export async function analyzeImage(imagePath: string): Promise<ImageAnalysis> {
  try {
    // 1. Read image
    const absolutePath = path.resolve(imagePath);
    const imageBuffer = await fs.readFile(absolutePath);
    const imageBase64 = imageBuffer.toString("base64");
    const imageName = path.parse(imagePath).name;
    const extension = path.extname(imagePath).toLowerCase();

    const mimeTypes: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
    };

    const mimeType = mimeTypes[extension];
    if (!mimeType) {
      throw new Error("Unsupported image format");
    }

    // 2. Create analysis prompt
    const prompt = `
You are an expert illustration analyst, visual storyteller,
character designer, SVG artist and graphic designer.

Your job is to DECONSTRUCT the provided image into
independent visual components that can be recreated
using JavaScript and SVG.

Analyze the image carefully.

IMPORTANT:
Do not simply describe the image.

Extract every visual component independently and
provide sufficient details to recreate it.

==========================================
1. SCENARIO
==========================================

Explain the complete story of the illustration.

Describe:
- What is happening?
- What is the central concept?
- What message does the image communicate?
- What is the relationship between characters and environment?

==========================================
2. IMAGE PROMPT
==========================================

Create one comprehensive imagePrompt.

It should describe how to recreate the COMPLETE image.

Include:
- All characters
- All background elements
- Composition
- Colors
- Art style
- Lighting
- Typography
- Relative positions
- Overall mood

The prompt must be usable for image generation.

==========================================
3. MAIN CHARACTER
==========================================

Identify the most important character.

Create a detailed characterPrompt.

Include:
- Physical appearance
- Head shape
- Body structure
- Face and eyes
- Facial expression
- Hair
- Clothing
- Accessories
- Pose
- Action
- Emotional state
- Colors
- Position
- Relative proportions

speechBubble:
Extract dialogue if a speech bubble exists.
Otherwise return null.

svgScript:
Generate a self-contained SVG for the character.

Requirements:
- Transparent background.
- Use SVG paths, circles, ellipses and shapes.
- Preserve character proportions.
- Preserve clothing and colors.
- Include all visible accessories.
- Use viewBox.
- Include no external image references.
- Make it editable.

svgPrompt:
Write detailed JavaScript implementation instructions
explaining how to recreate the character SVG.

Include:
- SVG dimensions
- Shapes required
- SVG path instructions
- Colors
- Stroke widths
- Layer ordering
- Character proportions
- Coordinates
- Grouping

The svgPrompt must be sufficiently detailed
for another JavaScript developer or AI to generate
the same character.

==========================================
4. SIDE CHARACTERS
==========================================

Identify every additional character.

Each character must have an independent object.

Use sequential characterNo values.

Apply the SAME detailed analysis as the main character.

Do not include background objects as characters.

==========================================
5. BACKGROUND DECONSTRUCTION
==========================================

Break the background into individual elements.

Examples:
- House
- Roof
- Tree
- Bush
- Road
- Mountains
- Clouds
- Sun
- Sky
- Grass
- Fence
- Signboards
- Windows
- Doors
- Lamps

Each element must have:

elementNo
name
category
description
color
position
depth
svgScript
svgPrompt

IMPORTANT:

Every background element must have its own SVG.

Each SVG must:
- Have a transparent background.
- Use an appropriate viewBox.
- Be independently reusable.
- Preserve its original color and appearance.
- Use SVG paths and shapes.
- Avoid embedding the complete original image.

The svgPrompt must explain how to generate the element
using JavaScript and SVG.

==========================================
6. HEADER AND SUBTITLE
==========================================

Extract:

topHeader:
The main heading displayed at the top.

bottomSub:
The main subtitle or text displayed at the bottom.

Preserve exact spelling, capitalization and punctuation.

==========================================
7. COLOR PALETTE
==========================================

Extract dominant colors.

Provide:
- Color name
- Approximate HEX code
- Where the color is used

==========================================
8. ART STYLE
==========================================

Identify:
- Illustration style
- Linework
- Shading
- Texture
- Lighting
- Mood
- Typography style

==========================================
9. COMPOSITION
==========================================

Analyze:
- Layout
- Aspect ratio
- Camera angle
- Perspective
- Foreground
- Middle ground
- Background

==========================================
10. ADDITIONAL TEXT
==========================================

Extract other visible text not already represented
by topHeader or bottomSub.

==========================================
STRICT RULES
==========================================

1. Do not invent characters or objects.
2. Do not omit visible elements.
3. Use null when speech bubbles are absent.
4. Every character gets an independent SVG.
5. Every background element gets an independent SVG.
6. SVG scripts must be actual SVG markup, not descriptions.
7. SVG prompts must explain how JavaScript should
   generate the corresponding SVG.
8. Keep the SVG elements on transparent backgrounds.
9. Keep the original illustration style.
10. Return valid JSON only.
11. Escape SVG strings correctly inside JSON.
12. Do not return markdown code blocks.

==========================================
EXPECTED JSON STRUCTURE
==========================================

{
  "scenario": "",
  "imagePrompt": "",

  "mainCharacterPrompt": {
    "characterNo": 1,
    "characterPrompt": "",
    "speechBubble": null,
    "position": "",
    "colorPalette": [],
    "svgScript": "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 300'>...</svg>",
    "svgPrompt": ""
  },

  "sidecharacterPrompt": [
    {
      "characterNo": 2,
      "characterPrompt": "",
      "speechBubble": null,
      "position": "",
      "colorPalette": [],
      "svgScript": "<svg>...</svg>",
      "svgPrompt": ""
    }
  ],

  "background": {
    "description": "",
    "elements": [
      {
        "elementNo": 1,
        "name": "",
        "category": "",
        "description": "",
        "color": "",
        "position": "",
        "depth": "background",
        "svgScript": "<svg>...</svg>",
        "svgPrompt": ""
      }
    ]
  },

  "topHeader": "",
  "bottomSub": "",

  "colorPalette": [
    {
      "name": "",
      "hex": "",
      "usage": ""
    }
  ],

  "artStyle": {
    "style": "",
    "linework": "",
    "shading": "",
    "texture": "",
    "lighting": "",
    "mood": "",
    "typography": ""
  },

  "composition": {
    "layout": "",
    "aspectRatio": "",
    "cameraAngle": "",
    "perspective": "",
    "foreground": "",
    "middleGround": "",
    "background": ""
  },

  "additionalText": [
    {
      "text": "",
      "position": "",
      "color": "",
      "style": ""
    }
  ]
}

Return all fields.
If no side characters exist, return [].
If no main character exists, return null.
Do not omit background elements.
`;

    // 3. Call Gemma 4 with streaming + custom undici dispatcher
    console.log(`Analyzing image with ${MODEL} (${imageName}${extension})...`);
    console.log(`Analyzing image with ${MODEL} (${imageName}${extension})...`);

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
            images: [imageBase64],
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
      const errorText = await body.text();
      throw new Error(`Ollama error (${statusCode}): ${errorText}`);
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
              `Streamed ${chunkCount} chunks (${fullContent.length} chars)...`,
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

    const analysis = JSON.parse(
      extractJsonObject(fullContent),
    ) as ImageAnalysis;
    // 5. Basic validation
    if (!analysis.scenario || !analysis.imagePrompt || !analysis.background) {
      throw new Error("Incomplete image analysis returned by Gemma");
    }

    // 6. Save output
    const outputDir = path.resolve("./analyze");
    await fs.mkdir(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, `${imageName}.json`);
    await fs.writeFile(
      outputPath,
      JSON.stringify(
        {
          imageId: imageName,
          originalImage: absolutePath,
          analysis,
        },
        null,
        2,
      ),
      "utf8",
    );

    console.log("Image analysis completed!");
    console.log("Saved:", outputPath);

    return analysis;
  } catch (error) {
    console.error("Image analysis failed:", error);
    throw error;
  }
}
