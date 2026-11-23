import { ChatOllama } from "@langchain/ollama";
import { Agent, setGlobalDispatcher } from "undici";

const ollamaAgent = new Agent({
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 120_000,

  // Disable header and body timeouts for long LLM inference.
  headersTimeout: 0,
  bodyTimeout: 0,

  // Allow enough time for local model initialization.
  connectTimeout: 30_000,
});

setGlobalDispatcher(ollamaAgent);

export const model = new ChatOllama({
  baseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",

  model: process.env.OLLAMA_MODEL ?? "gemma4:e4b",

  temperature: 0,

  numCtx: Number(process.env.OLLAMA_NUM_CTX ?? 16384),

  // Allow larger structured JSON responses.
  numPredict: 8192,
});
