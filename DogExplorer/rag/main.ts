// A small command-line RAG preparation/search tool 
import { Command } from "commander";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { readFile, readdir, writeFile, mkdir, access } from "node:fs/promises";
import { QdrantClient } from "@qdrant/js-client-rest";
import { v5 as uuidv5 } from "uuid";
import OpenAI from "openai";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { getAllBreeds } from "../src/dogApi";
import { COMMON_BREEDS } from "../src/commonBreeds";
import type { Breed } from "../src/types";


dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

const client = new QdrantClient({
  host: "localhost",
  port: 6333,
});

const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
});

// Collection configuration
const VECTOR_SIZE = 384;
const EMBEDDING_MODEL = "qwen3-embedding";

const CHUNK_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

const program = new Command();

program
  .name("npx tsx rag/main.ts")
  .description("DogExplorer Qdrant CLI")
  .version("1.0.0");


export function hello(name: string, options: { uppercase?: boolean }) {
  const message = `Hello, ${name}!`;

  return options.uppercase
    ? message.toUpperCase(): message;
}

// Convert text into an embedding vector
const embed = async (input: string): Promise<number[]> => {
  const result = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input,
    dimensions: VECTOR_SIZE,
  });

  const vector = result.data[0]?.embedding;

  if (!vector || vector.length !== VECTOR_SIZE) {
    throw new Error(`Expected ${VECTOR_SIZE} embedding dimensions, received ${vector?.length ?? 0}`);
  }

  return vector;
};


program
  .command("hello")
  .argument("<name>")
  .option("--uppercase")
  .action((name, options) => {
    console.log(hello(name, options));
  });

// Chunking a document
const makeChunksFromFile = async (filepath: string): Promise<string[]> => {

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 50,
    separators: ["\n\n\n", "\n\n", "\n", ". ", " "],
  });

  const document = await readFile(filepath, "utf8");

  // Avoid processing empty or whitespace-only files
  if (!document.trim()) {
    return [];
  }

  const chunks = await splitter.splitText(document);

  const merged: string[] = [];

  for (const chunk of chunks.map(chunk => chunk.trim()).filter(chunk => chunk.length > 0)) {
    const previous = merged.at(-1);

    if (previous !== undefined && /^[^\n]{1,60}:$/.test(previous)) {
      merged[merged.length - 1] = `${previous}\n${chunk}`;
    } else {
      merged.push(chunk);
    }
  }

  return merged;
};

// to extract the original source URL from a document
const getSourceUrl = async (filepath: string): Promise<string | undefined> => {

  const document = await readFile(filepath, "utf8");

  // Look for a line beginning with "Source:"
  const match = document.match(/^Source:\s*(https?:\/\/[^\s]+)/im);

  return match?.[1];
};

// Split command
program
  .command("split")
  .description("Split file at <path> into chunks and print.")
  .argument("<path>")
  .action(async (filepath) => {

    const chunks = await makeChunksFromFile(filepath);

    if (chunks.length === 0) {
      console.log(`No text found in ${filepath}`);
      return;
    }

    chunks.forEach((chunk, index) => {
      console.log(index, "\n", chunk);
    });
  });

// Creating a Qdrant collection
program
  .command("createCollection")
  .description("Create a Qdrant collection")
  .argument("<name>")
  .action(async (name) => {

    const exists = await client.collectionExists(name);

    if (exists.exists) {
      console.log(`Collection ${name} already exists.`);
      return;
    }

    await client.createCollection(name, {
      vectors: {
        size: VECTOR_SIZE,
        distance: "Cosine",
      },
    });

    console.log(`Successfully created collection: ${name}`);
  });

// Deleting a Qdrant collection
program
  .command("deleteCollection")
  .description("Delete a Qdrant collection")
  .argument("<name>")
  .action(async (name) => {
    await client.deleteCollection(name);
    console.log(`Deleted collection: ${name}`);
  });


const getBreedName = async (filepath: string): Promise<string> => {
  const document = await readFile(filepath, "utf8");
  const match = document.match(/^Breed:\s*(.+)$/im);

  const name = match?.[1] ?? path.parse(filepath).name.replace(/_/g, " ");

  return name.trim().toLowerCase();
};


const indexFile = async (collection: string, filepath: string, sourceName: string): Promise<number> => {

  const chunks = await makeChunksFromFile(filepath);

  // Skip empty files to avoid Qdrant's "Empty update request" error
  if (chunks.length === 0) {
    console.log(`Skipping ${sourceName}: file is empty.`);
    return 0;
  }

  const breed = await getBreedName(filepath);

  // Get the original source URL
  const sourceUrl = await getSourceUrl(filepath);

  const points = await Promise.all(
    chunks.map(async (chunk, index) => {

      const embedding = await embed(chunk);

      return {
        // Stable ID prevents duplicate points on re-indexing
        id: uuidv5(
          `${collection}:${sourceName}:${index}`,
          CHUNK_NAMESPACE
        ),

        vector: embedding,

        payload: {
          text: chunk,
          breed,
          source: sourceName,
          sourceUrl: sourceUrl ?? null,
          chunkIndex: index,
        },
      };
    })
  );

  await client.upsert(collection, {
    wait: true,
    points,
  });

  console.log(`Added ${points.length} chunks for ${breed} (${sourceName})`);

  return points.length;
};

// Add data from a single file
program
  .command("addData")
  .description("Chunk a single file and add it to a collection.")
  .argument("<collection>")
  .argument("<filepath>")
  .action(async (collection, filepath) => {
    await indexFile(collection, filepath, path.basename(filepath));
  });

//adding every text file in a folder, including subfolders
program
  .command("addDataFolder")
  .description("Chunk all text files in a folder and its subfolders and add them to a collection.")
  .argument("<collection>")
  .argument("<folder>")
  .action(async (collection, folder) => {

    // e.g. "beagle.txt" and "wikipedia/beagle.txt"
    const files = (await readdir(folder, { recursive: true }))
      .filter(file => file.toLowerCase().endsWith(".txt"))
      .sort();

    let total = 0;

    for (const file of files) {
      total += await indexFile(collection, path.join(folder, file), file);
    }

    console.log(`Finished. Added ${total} chunks from ${files.length} files in: ${folder}`);
  });

// "Poodle (Miniature)" -> "poodle_miniature"
const toFileName = (breedName: string): string =>
  breedName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") + ".txt";

// One document per breed from TheDogAPI, so every breed has some text in the knowledge base
program
  .command("fetchApiData")
  .description("Write one text file per breed from TheDogAPI into <folder>.")
  .argument("<folder>")
  .action(async (folder) => {

    const apiKey = process.env.DOG_API_KEY;
    if (!apiKey) {
      throw new Error("DOG_API_KEY is missing");
    }

    const breeds = await getAllBreeds(apiKey) as (Breed & { history?: string | null; bred_for?: string | null })[];

    await mkdir(folder, { recursive: true });

    for (const breed of breeds) {
      const lines = [
        `Breed: ${breed.name}`,
        `Source: https://thedogapi.com`,
        " ",
        breed.description ? `Description:\n${breed.description}\n` : "",
        breed.history ? `History:\n${breed.history}\n` : "",
        breed.temperament ? `Temperament: ${breed.temperament}` : "",
        breed.bred_for ? `Bred for: ${breed.bred_for}` : "",
        breed.breed_group ? `Breed group: ${breed.breed_group}` : "",
        breed.origin ? `Origin: ${breed.origin}` : "",
        breed.life_span ? `Life span: ${breed.life_span} years` : "",
        breed.weight?.metric ? `Weight: ${breed.weight.metric} kg` : "",
        breed.height?.metric ? `Height: ${breed.height.metric} cm` : "",
      ].filter(line => line !== "");

      await writeFile(path.join(folder, toFileName(breed.name)), lines.join("\n").replace("\n \n", "\n\n") + "\n");
    }

    console.log(`Wrote ${breeds.length} breed files to ${folder}`);
  });


// Only sections that help answer questions about living with the dog
const USEFUL_SECTION = /appearance|coat|colou?r|size|description|characteristics|temperament|behaviou?r|personality|health|care|grooming|exercise|training|activit|uses|work|lifespan|life expectancy|living/i;
const MAX_SECTION_LENGTH = 1500;

type WikipediaSection = { title: string; parent?: string; text: string };

const splitWikipediaArticle = (text: string): WikipediaSection[] => {
  const sections: WikipediaSection[] = [{ title: "Overview", text: "" }];
  let parent: string | undefined;

  for (const line of text.split("\n")) {
    const heading = line.match(/^(=+) (.+?) =+$/);

    if (heading) {
      const level = heading[1].length;
      const title = heading[2];

      if (level === 2) {
        parent = title;
        sections.push({ title, text: "" });
      } else {
        sections.push({ title, parent, text: "" });
      }
      continue;
    }

    if (line.trim()) {
      sections[sections.length - 1].text += line.trim() + "\n";
    }
  }

  return sections.map(section => ({ ...section, text: section.text.trim() }));
};

// Care-related text about common breeds from Wikipedia (CC BY-SA 4.0)
program
  .command("fetchWikipedia")
  .description("Write one text file per common breed from Wikipedia into <folder>.")
  .argument("<folder>")
  .action(async (folder) => {

    await mkdir(folder, { recursive: true });

    let written = 0;

    for (const [breedName, title] of Object.entries(COMMON_BREEDS)) {

      const filepath = path.join(folder, toFileName(breedName));

      // already downloaded, so the command can be re-run after a failure
      const exists = await access(filepath).then(() => true, () => false);
      if (exists) {
        continue;
      }

      const url = "https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=" + encodeURIComponent(title);

      // Wikipedia asks API users to identify themselves
      let response = await fetch(url, {
        headers: { "User-Agent": "DogExplorer (university course project)" },
      });

      // too many requests: wait as long as Wikipedia asks, then try a few more times
      for (let attempt = 1; response.status === 429 && attempt <= 5; attempt++) {
        const waitSeconds = Number(response.headers.get("retry-after")) || 5 * attempt;
        console.log(`Rate limited, waiting ${waitSeconds} seconds...`);
        await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));

        response = await fetch(url, {
          headers: { "User-Agent": "DogExplorer (university course project)" },
        });
      }

      if (!response.ok) {
        console.log(`Skipping ${breedName}: Wikipedia returned ${response.status}`);
        continue;
      }

      const data = await response.json() as { query: { pages: Record<string, { title: string; extract?: string }> } };
      const page = Object.values(data.query.pages)[0];

      // making sure we got an article about a dog and not something else with the same name
      if (!page?.extract || !/\b(dog|hound|breed)\b/i.test(page.extract.slice(0, 1000))) {
        console.log(`Skipping ${breedName}: no dog article found for "${title}"`);
        continue;
      }

      // a subsection is kept if its own title or its parent's title is useful
      const sections = splitWikipediaArticle(page.extract)
        .filter(section => section.title === "Overview" || USEFUL_SECTION.test(section.title) || USEFUL_SECTION.test(section.parent ?? ""))
        .filter(section => section.text.length > 0)
        .map(section => `${section.title}:\n${section.text.slice(0, MAX_SECTION_LENGTH)}`);

      const document = [
        `Breed: ${breedName}`,
        `Source: https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
        `License: CC BY-SA 4.0, text from Wikipedia`,
        "",
        // three newlines between sections, so the splitter prefers to break there
        sections.join("\n\n\n"),
      ].join("\n");

      await writeFile(filepath, document + "\n");

      written++;
      console.log(`Wrote ${breedName} (${sections.length} sections)`);

      // being polite to the Wikipedia API
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`Wrote ${written} Wikipedia files to ${folder}`);
  });

// Query the collection using semantic search
program
  .command("queryCollection")
  .description("Query a collection, optionally filtering by breed.")
  .argument("<collection>")
  .argument("<query>")
  .option("--breed <breed>", "Filter results by dog breed")
  .action(async (collection, query, options) => {

    const embedding = await embed(query);

    // Normalize the breed name for matching
    const breed = options.breed
      ? String(options.breed)
          .replace(/_/g, " ")
          .trim()
          .toLowerCase()
      : undefined;

    const results = await client.query(collection, {
      query: embedding,
      with_payload: true,
      limit: 5,

      // Only retrieve chunks belonging to the selected breed
      ...(breed
        ? {
            filter: {
              must: [
                {
                  key: "breed",
                  match: {
                    value: breed,
                  },
                },
              ],
            },
          }
        : {}),
    });

    console.log(
      `Found ${results.points.length} results`
    );

    results.points.forEach((point, index) => {
      console.log(`\nResult ${index + 1}`);
      console.log("Score:", point.score);
      console.log("Breed:", point.payload?.breed);
      console.log("Source:", point.payload?.source);
      console.log("Source URL:", point.payload?.sourceUrl);
      console.log("Text:", point.payload?.text);
    });
  });

// Run the selected command
program.parseAsync().catch(error => {
  console.error("RAG command failed:", error);
  process.exitCode = 1;
});
