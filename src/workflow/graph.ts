import { StateGraph, START, END } from "@langchain/langgraph";

import {
  probeVideoNode,
  extractAudioNode,
  transcribeAudioNode,
  analyzeTranscriptNode,
  extractFramesNode,
  analyzeFramesNode,
  temporalAlignmentNode,
  semanticAlignmentNode,
  mergeAnalysisNode,
  saveTranscriptionJsonNode,
} from "./node.js";
import { VideoIngestState } from "./state.js";

const workflow = new StateGraph(VideoIngestState)

  // 1. Inspect the input video
  .addNode("probe_video", probeVideoNode)

  // 2. Extract audio
  .addNode("extract_audio", extractAudioNode)

  // 3. Transcribe audio
  .addNode("transcribe_audio", transcribeAudioNode)

  // 4. Analyze transcript using Ollama
  .addNode("analyze_transcript", analyzeTranscriptNode)

  // 5. Extract video frames
  .addNode("extract_frames", extractFramesNode)

  // 6. Analyze extracted frames using Ollama
  .addNode("analyze_frames", analyzeFramesNode)

  // 7. Align transcript and frame timestamps
  .addNode("temporal_alignment", temporalAlignmentNode)

  // 8. Perform semantic alignment
  .addNode("semantic_alignment", semanticAlignmentNode)

  // 9. Merge all analysis results
  .addNode("merge_analysis", mergeAnalysisNode)

  // 10. Save final JSON
  .addNode("save_json", saveTranscriptionJsonNode)

  // Workflow connections
  .addEdge(START, "probe_video")

  .addEdge("probe_video", "extract_audio")

  .addEdge("extract_audio", "transcribe_audio")

  .addEdge("transcribe_audio", "analyze_transcript")

  .addEdge("analyze_transcript", "extract_frames")

  .addEdge("extract_frames", "analyze_frames")

  .addEdge("analyze_frames", "temporal_alignment")

  .addEdge("temporal_alignment", "semantic_alignment")

  .addEdge("semantic_alignment", "merge_analysis")

  .addEdge("merge_analysis", "save_json")

  .addEdge("save_json", END);

export const videoIngestGraph = workflow.compile();
