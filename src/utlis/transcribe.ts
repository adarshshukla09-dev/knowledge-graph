import fs from "node:fs/promises";
import path from "node:path";

async function transcribeAudio(audioPath: string): Promise<string> {
  try {
    const fileBuffer = await fs.readFile(audioPath);

    const fileName = path.basename(audioPath);
    const videoName = path.parse(fileName).name;

    const formData = new FormData();

    const audioBlob = new Blob([fileBuffer]);

    formData.append("file", audioBlob, fileName);
    formData.append("model", "gemma4:e4b");
    formData.append("response_format", "json");

    console.log("Sending audio to Ollama...");

    const response = await fetch(
      "http://127.0.0.1:11434/v1/audio/transcriptions",
      {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(600000),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Ollama API Error: ${response.status} ${await response.text()}`,
      );
    }

    const result = (await response.json()) as { text: string };

    const outputDir = "./transcribe";

    await fs.mkdir(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, `${videoName}.txt`);

    await fs.writeFile(outputPath, result.text, "utf8");

    console.log(`Transcript saved: ${outputPath}`);

    return result.text;
  } catch (error) {
    console.error("Transcription failed:", error);
    throw error;
  }
}

export default transcribeAudio;
