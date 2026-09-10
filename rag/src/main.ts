#!/usr/bin/env node

import { Command } from "commander";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { readFile } from "node:fs/promises";
import { QdrantClient } from "@qdrant/js-client-rest";
import { v4 as uuidv4 } from "uuid";
import OpenAI from "openai";

const client = new QdrantClient({ host: "localhost", port: 6333 });

const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  dangerouslyAllowBrowser: true,
});

const program = new Command();
program.name("npx tsx src/main.ts").description("Qdrant CLI").version("1.0.0");

export function hello(name: string, options: any) {
  const message = `Hello, ${name}!`;
  return options.uppercase ? message.toUpperCase() : message;
}

const embed = async (input: string) =>
  openai.embeddings
    .create({
      model: "qwen3-embedding",
      input: input,
      dimensions: 384,
    })
    .then((result) => result.data[0].embedding);

/** Commander demonstration */
program
  .command("hello")
  .argument("<name>")
  .action((name, options) => {
    console.log(hello(name, options));
  });

/** Chunking a document */
const makeChunksFromFile = async (filepath: string) => {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 50,
    separators: ["\n\n\n", "\n\n", "\n", ". ", " "],
  });

  const document = await readFile(filepath, "utf8");
  const chunks = await splitter.splitText(document);
  return chunks;
};

program
  .command("split")
  .description("Split file at <path> into chunks and print.")
  .argument("<path>", "file path")
  .action(async (path, _options) => {
    const chunks = await makeChunksFromFile(path);
    chunks.forEach((c, ix) => console.log(ix, "\n", c));
  });

program
  .command("createCollection")
  .description("Create a collection")
  .argument("<name>", "collection name")
  .action(async (name) => {
    await client.createCollection(name, {
      vectors: { size: 384, distance: "Cosine" },
    });
    console.log(`Succesfully created collection: ${name}`);
  });

program
  .command("addData")
  .description("Chunk data at <path> and add it to a collection.")
  .argument("<collection>", "collection name")
  .argument("<path>", "file path")
  .action(async (collection, path) => {
    const chunks = await makeChunksFromFile(path);
    const points = await Promise.all(
      chunks.map(async (chunk) => {
        const embedding = await embed(chunk);
        return {
          id: uuidv4(),
          vector: embedding,
          payload: { text: chunk },
        };
      }),
    );
    console.log(
      `Done chunking into ${chunks.length} documents. Adding them into collection: ${collection}...`,
    );
    await client.upsert(collection, { wait: true, points: points });
    console.log(
      `Succesfully added ${chunks.length} document into collection: ${collection}`,
    );
  });

program
  .command("queryCollection")
  .description("Query the collection")
  .argument("<collection>", "collection name")
  .argument("<query>", "text of the query")
  .action(async (collection, query) => {
    const embedding = await embed(query);
    const results = await client.query(collection, {
      with_payload: true,
      query: embedding,
      limit: 5,
    });
    console.log(results.points);
  });

program.parse();
