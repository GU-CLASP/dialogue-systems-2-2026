import prompts from "./prompts";

export const REGION = "swedencentral" as const;
export const LLM_MODEL = "llama3.2:latest" as const;

export const EMBEDDING_MODEL = "qwen3-embedding" as const;
export const EMBEDDING_DIMENSIONS = 384 as const;

export const ROLES = {
  Assistant: "assistant",
  User: "user",
  System: "system",
} as const;

export const NO_INPUT_THRESHOLD = prompts.noInput.length;
