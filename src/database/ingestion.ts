import driver from "./neo4j.js";

interface VideoKnowledge {
  videoId: string;
  transcript: string;
  duration: number;
  analysis: any;
  frameAnalysis: any;
}

export async function storeVideoKnowledge(data: VideoKnowledge) {
  console.log("================================");
  console.log("STORE VIDEO KNOWLEDGE CALLED");
  console.log("Video ID:", data?.videoId);
  console.log("================================");
  const session = driver.session();

  try {
    console.log("Creating Neo4j session...");

    console.log("Neo4j session created.");

    console.log("Analysis exists:", !!data?.analysis);
    console.log("Scene analysis:", data?.analysis?.sceneAnalysis);
    console.log("Frame analysis:", data?.frameAnalysis);
    await session.executeWrite(async (tx) => {
      console.log("Transaction started.");

      await tx.run(
        `
        MERGE (v:Video {id: $videoId})
        SET v.duration = $duration,
            v.transcript = $transcript,
            v.title = $title,
            v.summary = $summary,
            v.category = $category
        `,
        {
          videoId: data.videoId,
          duration: data.duration,
          transcript: data.transcript,
          title: data.analysis?.overview?.title ?? null,
          summary: data.analysis?.overview?.summary ?? null,
          category: data.analysis?.overview?.category ?? null,
        },
      );

      console.log("Video node stored.");
    });

    console.log("Transaction completed.");
  } catch (error) {
    console.error("INGESTION ERROR:", error);
    throw error;
  } finally {
    await session.close();
    console.log("Ingestion function finished.");
  }
}
