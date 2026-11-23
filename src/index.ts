import { videoIngestGraph } from "./workflow/graph.js";

async function main() {
  const videoPath = process.argv[2] ?? "./videos/1.mp4";
  const graph = videoIngestGraph;

  const result = await graph.invoke({
    ingest_video_path: videoPath,
    output_dir: "./output",
  });

  console.log("Duration (s):", result.videoMetadata?.duration);
  console.log("Audio WAV:", result.audioPath);
  console.log("Transcript:", result.transcript);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
