import { Driver } from "neo4j-driver";
import driver from "./neo4j.js";

export async function initializeSchema(driver: Driver): Promise<void> {
  const session = driver.session();

  try {
    await session.executeWrite(async (tx) => {
      const constraints = [
        `CREATE CONSTRAINT video_id IF NOT EXISTS
         FOR (v:Video) REQUIRE v.id IS UNIQUE`,

        `CREATE CONSTRAINT video_analysis_id IF NOT EXISTS
         FOR (a:VideoAnalysis) REQUIRE a.id IS UNIQUE`,

        `CREATE CONSTRAINT script_id IF NOT EXISTS
         FOR (s:Script) REQUIRE s.id IS UNIQUE`,

        `CREATE CONSTRAINT scene_id IF NOT EXISTS
         FOR (s:Scene) REQUIRE s.id IS UNIQUE`,

        `CREATE CONSTRAINT topic_name IF NOT EXISTS
         FOR (t:Topic) REQUIRE t.name IS UNIQUE`,

        `CREATE CONSTRAINT technique_name IF NOT EXISTS
         FOR (t:Technique) REQUIRE t.name IS UNIQUE`,

        `CREATE CONSTRAINT hook_id IF NOT EXISTS
         FOR (h:Hook) REQUIRE h.id IS UNIQUE`,

        `CREATE CONSTRAINT image_id IF NOT EXISTS
         FOR (i:Image) REQUIRE i.id IS UNIQUE`,

        `CREATE CONSTRAINT image_analysis_id IF NOT EXISTS
         FOR (a:ImageAnalysis) REQUIRE a.id IS UNIQUE`,

        `CREATE CONSTRAINT character_id IF NOT EXISTS
         FOR (c:Character) REQUIRE c.id IS UNIQUE`,

        `CREATE CONSTRAINT background_element_id IF NOT EXISTS
         FOR (b:BackgroundElement) REQUIRE b.id IS UNIQUE`,

        `CREATE CONSTRAINT knowledge_chunk_id IF NOT EXISTS
         FOR (k:KnowledgeChunk) REQUIRE k.id IS UNIQUE`,
      ];

      for (const query of constraints) {
        await tx.run(query);
      }

      const indexes = [
        `CREATE INDEX video_category IF NOT EXISTS
         FOR (v:Video) ON (v.category)`,

        `CREATE INDEX video_title IF NOT EXISTS
         FOR (v:Video) ON (v.title)`,

        `CREATE INDEX scene_video_id IF NOT EXISTS
         FOR (s:Scene) ON (s.videoId)`,

        `CREATE INDEX scene_start_time IF NOT EXISTS
         FOR (s:Scene) ON (s.startTime)`,
      ];

      for (const query of indexes) {
        await tx.run(query);
      }
    });

    console.log("Neo4j schema initialized successfully.");
  } catch (error) {
    console.error("Failed to initialize Neo4j schema:", error);
    throw error;
  } finally {
    await session.close();
  }
}
await initializeSchema(driver);
