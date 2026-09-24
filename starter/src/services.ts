import OpenAI from "openai";

import { QdrantClient } from "@qdrant/js-client-rest";

import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, LLM_MODEL } from "./constants";
import { Message } from "./types";

const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  dangerouslyAllowBrowser: true,
});

const client = new QdrantClient({ host: "localhost", port: 6333 });

const queryQdrant = async (collection: string, query: string) => {
  const embed = async (input: string) =>
    openai.embeddings
      .create({
        model: EMBEDDING_MODEL,
        input: input,
        dimensions: EMBEDDING_DIMENSIONS,
      })
      .then((result) => result.data[0].embedding);

  const embedding = await embed(query);

  const results = await client.query(collection, {
    with_payload: true,
    query: embedding,
    limit: 5,
    score_threshold: 0.6,
  });

  console.log(results);

  console.log(results.points.map((point) => point.payload));

  const chunks = results.points.map((point) => point.payload?.text);

  return chunks.join("\n\n").trim() || "No relevant documents found.";
};

const getChatCompletions = async (messages: Message[]) => {
  const completion = await openai.chat.completions.create({
    messages,
    model: LLM_MODEL,
    store: true,
  });

  const outputContent = completion.choices[0]?.message?.content ?? "";
  const output = outputContent.replace(/^assistant\s*/i, "").trim();
  console.log(`LLM output: ${output}`);

  return output;
};

export { queryQdrant, getChatCompletions };
