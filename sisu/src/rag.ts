#!/usr/bin/env node

import { Command } from "commander";
//import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
//import { readFile } from "node:fs/promises";
import { QdrantClient } from "@qdrant/js-client-rest";
import { v4 as uuidv4 } from "uuid";
import OpenAI from "openai";
import { Move } from "./types";
import { WHQ } from "./utils";

const client = new QdrantClient({ host: "localhost", port: 6333 });

const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  dangerouslyAllowBrowser: true,
});

const program = new Command();
program.name("npx tsx src/main.ts").description("Qdrant CLI").version("1.0.0");


type NLUexample = {
  mainUtt : string,
  altUtt : string[],
  move: Move,
};

type NLUentry = {
  utterance: string,
  move: Move
};

const utt_booking_room : NLUexample = {
  mainUtt: "where is the lecture?",
  altUtt: ["where is the lecture?",
    "what is the lecture room?",
    "where will the lecture be?",
    "what room is the lecture in?",
    "which room is the lecture in?",
    "where are we having the lecture?",
    "where is the class?",
  ],
  move: {
    type: "ask",
    content: WHQ("booking_room"),
  },
};

const utt_favorite_food : NLUexample = {
  mainUtt: "what is your favorite food?",
  altUtt: ["what is your favorite food?",
    "what food do you like the most?",
    "which food do you like best?",
    "what's your favourite dish?",
    "which dish is your favorite?",
    "what do you like to eat?",
    "what kind of food do you like?",
  ],
  move: {
    type: "ask",
    content: WHQ("favorite_food"),
  },
};

const utt_pizza : NLUexample = {
  mainUtt: "pizza",
  altUtt: ["pizza",
    "it's pizza",
    "i like pizza",
    "i love pizza",
    "my favorite food is pizza",
    "pizza is my favorite",
    "probably pizza",
  ],
  move: {
    type: "answer",
    content: "pizza",
  },
};

const utt_LT2319: NLUexample = {
  mainUtt: "dialogue systems 2",
  altUtt: ["dialogue systems 2",
    "dialogue systems",
    "LT2319",
    "i have dialogue systems 2",
    "dialogue systems course",
    "course in dialogue systems",
    "it's dialogue systems 2",
    "it's LT2319",
    "i'm taking LT2319",
    "i'm taking dialogue systems",
    "the course is dialogue systems"
  ],
  move: {
    type: "answer",
    content: "LT2319",
  },
};

const utt_friday : NLUexample = {
  mainUtt: "friday",
  altUtt: ["friday",
    "on friday",
    "it's friday",
    "the lecture is on friday",
    "friday please",
    "this friday",
    "the day is friday",
  ],
  move: {
    type: "answer",
    content: "friday",
  },
};

const utt_thursday : NLUexample = {
  mainUtt: "thursday",
  altUtt: ["thursday",
    "on thursday",
    "it's thursday",
    "the lecture is on thursday",
    "thursday please",
    "this thursday",
    "the day is thursday",
  ],
  move: {
    type: "answer",
    content: "thursday",
  },
};

const utt_tuesday : NLUexample = {
  mainUtt: "tuesday",
  altUtt: ["tuesday",
    "on tuesday",
    "it's tuesday",
    "the lecture is on tuesday",
    "tuesday please",
    "this tuesday",
    "the day is tuesday",
  ],
  move: {
    type: "answer",
    content: "tuesday",
  },
};

function buildNLUdatabase(utterances: NLUexample[]): NLUentry[] {
  const database : NLUentry[] = [];
  for (const utterance of utterances) {
    for (const example of utterance.altUtt) {
      database.push({
        utterance: example,
        move: utterance.move
      })
    }
  }
  return database
};

const NLUdatabase = buildNLUdatabase([
  utt_booking_room,
  utt_favorite_food,
  utt_pizza,
  utt_LT2319,
  utt_friday,
  utt_thursday,
  utt_tuesday,
])

program
  .command("prepareData")
  .description("build data as list of NLU entries")
  .action(() => {
    const database: NLUentry[] = buildNLUdatabase([
      utt_booking_room,
      utt_favorite_food,
      utt_pizza,
      utt_LT2319,
      utt_friday,
      utt_thursday,
      utt_tuesday,
    ]);
    console.log(database)
  });

const embed = async (input: string) =>
  openai.embeddings
    .create({
      model: "qwen3-embedding",
      input: input,
      dimensions: 384,
    })
    .then((result) => result.data[0].embedding);

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
  .command("addAllData")
  .description("build data as a list of NLUentries and add them to a collection")
  .argument("<collection>", "collection name")
  .action(async (collection) => {
    const database: NLUentry[] = buildNLUdatabase([
      utt_booking_room,
      utt_favorite_food,
      utt_pizza,
      utt_LT2319,
      utt_friday,
      utt_thursday,
      utt_tuesday,
    ]);
    const points = await Promise.all(
      database.map(async (entry) => {
        const embedding = await embed(entry.utterance);
        return {
          id: uuidv4(),
          vector: embedding,
          payload: { utterance: entry.utterance, move: entry.move },
        };
      }),
    );
    await client.upsert(collection, { wait: true, points: points });
    console.log(
    `Succesfully added ${database.length} points into collection: ${collection}`,
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
