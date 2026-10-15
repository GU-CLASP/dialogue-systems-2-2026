#!/usr/bin/env node
// a samll command-line RAG preparation/search tool

import { Command } from "commander";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters"; // breaks large documents into smaller chunks
import { readFile } from "node:fs/promises"; // reads files from disk asynchronously
import { QdrantClient } from "@qdrant/js-client-rest"; // lets typescript communicate with the Qdrant vector database
import { v4 as uuidv4 } from "uuid"; // it creates unique IDs
import OpenAI from "openai"; // to communicate with the local Ollama

import {readdir} from "node:fs/promises";
import path from "node:path";

// with this u connect to the Qdrant container in docer-compose.yml
const client = new QdrantClient({ host: "localhost", port: 6333 });

const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  dangerouslyAllowBrowser: true,
});

// the commander setup
const program = new Command();
program.name("npx tsx src/main.ts").description("Qdrant CLI").version("1.0.0");

// a demonstration/test of Commmander and TypeScript
export function hello(name: string, options: any) {
  const message = `Hello, ${name}!`;
  return options.uppercase ? message.toUpperCase() : message;
}

// this function: takes text -> convert into array of numbers
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
const makeChunksFromFile = async (filepath: string) => { // takes filepath
  const splitter = new RecursiveCharacterTextSplitter({ // u are telling LangChain
    chunkSize: 500, // make 500 chars long
    chunkOverlap: 50, // adjacent chunks share about 50 chars
    separators: ["\n\n\n", "\n\n", "\n", ". ", " "], // tells splitter where it should prefer to break text
    // first try large paragraph boundaries, then smaller paragraph boundaries, then lines, sentences and finally spaces
  });

  const document = await readFile(filepath, "utf8"); // reads the text file
  const chunks = await splitter.splitText(document); //split it
  return chunks;
};

program
  .command("split") // create a terminal command called split
  .description("Split file at <path> into chunks and print.")
  .argument("<path>", "file path")
  .action(async (path, _options) => {
    const chunks = await makeChunksFromFile(path); // splits the file
    chunks.forEach((c, ix) => 
      console.log(ix, "\n", c)); // prints every chunk
  });

  // creating the Qdrant collection
program
  .command("createCollection")
  .description("Create a collection")
  .argument("<name>", "collection name")
  .action(async (name) => {
    await client.createCollection(name, {
      vectors: { 
        size: 384, 
        distance: "Cosine" 
      },
    });
    console.log(`Succesfully created collection: ${name}`);
  });


  // adding data
program
  .command("addData")
  .description("Chunk data at <path> and add it to a collection.")
  .argument("<collection>", "collection name")
  .argument("<path>", "file path")
  .action(async (collection, path) => {
    const chunks = await makeChunksFromFile(path);
    const points = await Promise.all( // start creating embeddings for all the chunks and wait until they have all finished
      chunks.map(async (chunk) => { // for every chunk, perform an asynchronous operation
        const embedding = await embed(chunk); // convert the chunk into vector
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
    await client.upsert(collection, { // stores all the points in Qdrant
      wait: true, 
      points: points 
    });
    console.log(
      `Succesfully added ${chunks.length} document into collection: ${collection}`,
    );
  });

  // command for adding data folder ***
  program
  .command("addDataFolder")
  .description("Chunk every file in <folder> and add them all to a collection.")
  .argument("<collection>", "collection name")
  .argument("<folder>", "folder path")
  .action(async(collection, folder) => {
    const files = await readdir(folder);
    let total = 0;
    for (const file of files){
      const filepath = path.join(folder, file);
      const chunks = await makeChunksFromFile(filepath);
      const points = await Promise.all(
        chunks.map(async (chunk, ix) => {
          const embedding = await embed(chunk);
          return {
            id: uuidv4(),
            vector: embedding,
            payload: {
              text: chunk,
              source: file, // which file this chunk came from
              chunkIndex: ix, // position within the file
            },
          };
        }),
      );
      await client.upsert(collection, {wait: true, points});
      total += points.length;
      console.log(`Added ${points.length} chunks from ${file}`);
    }
    console.log(`Finished. Added ${total} chunks total from folder: ${folder}`);
  });

  // querycollection
program
  .command("queryCollection")
  .description("Query the collection")
  .argument("<collection>", "collection name")
  .argument("<query>", "text of the query")
  .action(async (collection, query) => {
    const embedding = await embed(query); // convert the question into a vector using the same embedding model
    const results = await client.query(collection, { //find the five stored vectors most similar to this question vector
      with_payload: true, // also give the stored text, not just the vector and id
      query: embedding,
      limit: 5,
    });
    console.log(results.points);
  });

program.parse();
