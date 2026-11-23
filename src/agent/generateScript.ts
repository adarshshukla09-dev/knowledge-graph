import { retrieveKnowledge } from "./retrieveKnowledge.js";

const MODEL = "gemma4:e4b";

export async function generateScript(topic: string) {
  // 1. Retrieve relevant knowledge

  const knowledge = await retrieveKnowledge(topic);
  const prompt = `
You are an expert storytelling strategist
and professional short-form video scriptwriter.

Your task is to create a high-quality video script.

TARGET TOPIC:
${topic}

REFERENCE KNOWLEDGE FROM OUR CONTENT DATABASE:

${JSON.stringify(knowledge, null, 2)}

IMPORTANT INSTRUCTIONS:

1. Study the retrieved storytelling examples.
2. Identify the most effective hooks.
3. Understand the narrative structures.
4. Identify emotional triggers.
5. Learn how curiosity is maintained.
6. Understand how scenes progress.
7. Apply relevant storytelling techniques.
8. Do not copy existing scripts.
9. Create original narration.
10. Preserve the quality and storytelling principles
    of the retrieved examples.

Generate the following:

{
  "title": "",
  "topic": "",
  "centralIdea": "",
  "hook": "",
  "storyStructure": "",
  "emotionalJourney": [],
  "curiosityLoops": [],
  "narration": "",
  "scenes": [
    {
      "sceneNo": 1,
      "duration": "",
      "narration": "",
      "visualDescription": "",
      "emotion": "",
      "retentionPurpose": "",
      "imagePrompt": ""
    }
  ],
  "ending": "",
  "visualStyle": "",
  "editingInstructions": ""
}

Return valid JSON only.
`;

  // 3. Generate using Gemma 4

  const response = await fetch("http://localhost:11434/api/chat", {
    method: "POST",

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
      stream: false,

      options: {
        temperature: 0.7,
        num_ctx: 16384,
      },
    }),

    signal: AbortSignal.timeout(600000),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const result = (await response.json()) as {
    message: {
      content: string;
    };
  };

  return JSON.parse(result.message.content);
}
