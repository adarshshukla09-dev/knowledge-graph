import driver from "../database/neo4j.js";
import { generateEmbedding } from "../embeddings/embed.js";

export async function retrieveKnowledge(topic: string) {
  const embedding = await generateEmbedding(topic);

  const session = driver.session();

  try {
    const result = await session.run(
      `
      CALL db.index.vector.queryNodes(
        'content_embeddings',
        15,
        $embedding
      )
      YIELD node, score

      RETURN
        node.content AS content,
        node.type AS type,
        node.topic AS topic,
        node.technique AS technique,
        node.videoId AS videoId,
        score

      ORDER BY score DESC
      `,
      {
        embedding,
      },
    );

    return result.records.map((record) => ({
      content: record.get("content"),
      type: record.get("type"),
      topic: record.get("topic"),
      technique: record.get("technique"),
      videoId: record.get("videoId"),
      score: record.get("score"),
    }));
  } finally {
    await session.close();
  }
}
