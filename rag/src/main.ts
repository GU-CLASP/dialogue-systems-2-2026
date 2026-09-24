#!/usr/bin/env node

import { Command } from "commander";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { readFile, readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { QdrantClient } from "@qdrant/js-client-rest";
import { v4 as uuidv4 } from "uuid";
import OpenAI from "openai";

/** 连本机 Docker 里的 Qdrant（端口 6333） */
const client = new QdrantClient({ host: "localhost", port: 6333 });

/** 连 Ollama，用来算向量 embedding（以及以后若需要也可聊天） */
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

/** 把一段文字变成 384 维向量（须与 createCollection 的 size 一致） */
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

/**
 * 读一个文件并切成小块（chunks）
 * 优先按 \n\n\n（爬虫导出的章节分隔）切开，便于检索更准
 */
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

/**
 * 简易进度条（类似 tqdm），同一行刷新：
 *   [ 3/21] 14% |███░░░░░░░░░░░░░░░░░| page-002-....txt
 */
const renderProgress = (
  current: number,
  total: number,
  label: string,
  width = 20,
) => {
  const ratio = total === 0 ? 1 : current / total;
  const filled = Math.round(ratio * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  const pct = String(Math.floor(ratio * 100)).padStart(3, " ");
  const cur = String(current).padStart(String(total).length, " ");
  // \r 回到行首覆盖；process.stdout 才能做单行刷新
  process.stdout.write(
    `\r[${cur}/${total}] ${pct}% |${bar}| ${label}`.padEnd(100),
  );
  if (current >= total) process.stdout.write("\n");
};

/**
 * 把若干文本块变成 Qdrant points：
 * - vector: embedding
 * - payload.text: 原文（检索后给 LLM 用）
 * - payload.source: 来源文件名（metadata，方便调试/过滤）
 * 顺序处理 chunk，才能稳定刷新进度条
 */
const chunksToPoints = async (
  chunks: string[],
  sourcePath: string,
  onChunk?: (done: number, total: number) => void,
) => {
  const source = basename(sourcePath);
  const points = [];
  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embed(chunks[i]);
    points.push({
      id: uuidv4(),
      vector: embedding,
      payload: {
        text: chunks[i],
        source,
      },
    });
    onChunk?.(i + 1, chunks.length);
  }
  return points;
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

/** 导入单个文件 */
program
  .command("addData")
  .description("Chunk data at <path> and add it to a collection.")
  .argument("<collection>", "collection name")
  .argument("<path>", "file path")
  .action(async (collection, path) => {
    const chunks = await makeChunksFromFile(path);
    const points = await chunksToPoints(chunks, path);
    console.log(
      `Done chunking into ${chunks.length} documents. Adding them into collection: ${collection}...`,
    );
    await client.upsert(collection, { wait: true, points: points });
    console.log(
      `Succesfully added ${chunks.length} document into collection: ${collection}`,
    );
  });

/**
 * Lab 建议的批量导入：扫描文件夹里所有 .txt，逐个入库
 * 用法：npx tsx src/main.ts addFolder gu_support_all ../labs/lab1/data
 */
program
  .command("addFolder")
  .description("Add all .txt files from a folder into a collection.")
  .argument("<collection>", "collection name")
  .argument("<folder>", "folder path")
  .action(async (collection, folder) => {
    // 1) 列出文件夹中的 .txt
    const files = (await readdir(folder))
      .filter((name) => name.endsWith(".txt"))
      .map((name) => join(folder, name));

    console.log(`Found ${files.length} .txt files in ${folder}`);

    // 2) 逐个文件：切块 → embedding → upsert（顺序处理，避免一次打爆 Ollama）
    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      const name = basename(filePath);
      console.log(`\nFile ${i + 1}/${files.length}: ${name}`);

      const chunks = await makeChunksFromFile(filePath);
      const points = await chunksToPoints(chunks, filePath, (done, total) => {
        renderProgress(done, total, `embed ${name}`);
      });

      process.stdout.write("  upserting to Qdrant...");
      await client.upsert(collection, { wait: true, points });
      process.stdout.write(" done.\n");

      // 文件级总进度
      renderProgress(i + 1, files.length, "files complete");
    }

    console.log(`\nDone. Added ${files.length} files into ${collection}`);
  });

/** 用自然语言查询：先 embed 问题，再在 collection 里找最相似的若干块 */
program
  .command("queryCollection")
  .description("Query the collection")
  .argument("<collection>", "collection name")
  .argument("<query>", "text of the query")
  .option("-k, --limit <n>", "number of results to return", "5")
  .action(async (collection, query, options) => {
    const limit = Number(options.limit) || 5;
    const embedding = await embed(query);
    const results = await client.query(collection, {
      with_payload: true,
      query: embedding,
      limit,
    });
    // Compact print for VG top-k experiments
    console.log(`limit=${limit}, hits=${results.points?.length ?? 0}`);
    for (const [i, p] of (results.points ?? []).entries()) {
      const payload = p.payload as { text?: string; source?: string } | null;
      const text = (payload?.text ?? "").replace(/\s+/g, " ").slice(0, 120);
      console.log(
        `#${i + 1} score=${p.score?.toFixed(4)} source=${payload?.source ?? "?"} | ${text}`,
      );
    }
  });

program.parse();
