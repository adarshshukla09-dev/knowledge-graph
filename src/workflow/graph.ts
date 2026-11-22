import { StateGraph, START, END } from "@langchain/langgraph";

import { VideoIngestState } from "./state.js";

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

const workflow = new StateGraph(VideoIngestState)
  .addNode("probe_video", probeVideoNode)
  .addNode("extract_audio", extractAudioNode)
  .addNode("transcribe_audio", transcribeAudioNode)
  .addNode("analyze_transcript", analyzeTranscriptNode)
  .addNode("extract_frames", extractFramesNode)
  .addNode("analyze_frames", analyzeFramesNode)
  .addNode("temporal_alignment", temporalAlignmentNode)
  .addNode("semantic_alignment", semanticAlignmentNode)
  .addNode("merge_analysis", mergeAnalysisNode)
  .addNode("save_json", saveTranscriptionJsonNode)

  .addEdge(START, "probe_video")
  .addEdge("probe_video", "extract_audio")
  .addEdge("extract_audio", "transcribe_audio")

  // Independent branches after transcription.
  .addEdge("transcribe_audio", "analyze_transcript")
  .addEdge("transcribe_audio", "extract_frames")

  .addEdge("extract_frames", "analyze_frames")

  // Join both branches.
  .addEdge("analyze_transcript", "temporal_alignment")
  .addEdge("analyze_frames", "temporal_alignment")

  .addEdge("temporal_alignment", "semantic_alignment")
  .addEdge("semantic_alignment", "merge_analysis")
  .addEdge("merge_analysis", "save_json")
  .addEdge("save_json", END);

export const videoIngestGraph = workflow.compile();
