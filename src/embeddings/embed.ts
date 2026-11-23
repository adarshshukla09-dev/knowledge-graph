const OLLAMA_URL = "http://localhost:11434";

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    body: JSON.stringify({
      model: "nomic-embed-text",
      input: text,
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const result = (await response.json()) as {
    embeddings: number[][];
  };

  return result.embeddings[0] as number[];
}
