import path from "node:path";

export function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    secs.toFixed(2).padStart(5, "0"),
  ].join(":");
}
export function getVideoOutputPaths(videoPath: string, outputDir = "./output") {
  const parsedName = path.parse(videoPath).name;
  const extension = path.extname(videoPath).replace(".", "");

  const videoFolderName = `${parsedName}_${extension}`;

  const videoOutputDir = path.resolve(outputDir, videoFolderName);

  return {
    videoOutputDir,
    audioDir: path.join(videoOutputDir, "audio"),
    framesDir: path.join(videoOutputDir, "frames"),
    jsonPath: path.join(videoOutputDir, `${videoFolderName}.json`),
  };
}
