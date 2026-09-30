import { Move } from "./types";
import { objectsEqual, WHQ } from "./utils";
import { QdrantClient } from "@qdrant/js-client-rest";
import OpenAI from "openai";

const client = new QdrantClient({ host: "localhost", port: 6333 });

const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  dangerouslyAllowBrowser: true,
});


interface NLUMapping {
  [index: string]: Move[];
}
type NLGMapping = [Move, string][];

const nluMapping: NLUMapping = { // use only lower case here
  "where is the lecture?": [
    {
      type: "ask",
      content: WHQ("booking_room"),
    },
  ],
  "what's your favorite food?": [
    {
      type: "ask",
      content: WHQ("favorite_food"), // ?x.favorite_food(x)
    },
  ],
  pizza: [
    {
      type: "answer",
      content: "pizza",
    },
  ],
  "dialogue systems 2": [
    {
      type: "answer",
      content: "LT2319",
    },
  ],
  "dialogue systems": [
    {
      type: "answer",
      content: "LT2319",
    },
  ],
  "friday": [
    {
      type: "answer",
      content: "friday",
    },
  ],
  "thursday": [
    {
      type: "answer",
      content: "thursday",
    },
  ],
  "tuesday": [
    {
      type: "answer",
      content: "tuesday",
    },
  ],
  "*noinput*": [
    {
      type: "noInput",
      content: null,
    },
  ],
};
const nlgMapping: NLGMapping = [
  [{ type: "ask", content: WHQ("booking_course") }, "Which course?"],
  [{ type: "greet", content: null }, "Hello! You can ask me anything!"],
  [
    {
      type: "answer",
      content: { predicate: "favorite_food", argument: "pizza" },
    },
    "Pizza.",
  ],
  [
    {
      type: "answer",
      content: { predicate: "booking_room", argument: "G212" },
    },
    "The lecture is in G212.",
  ],
  [{ type: "ask", content: WHQ("booking_day") }, "Which day?"],
  [
    {
      type: "answer",
      content: { predicate: "booking_room", argument: "J440" },
    },
    "The lecture is in J440.",
  ],
  [
    {
      type: "noUnderstandingFeedback",
      content: null,
    },
    "Sorry, I didn't understand.",
  ],
  [
    {
      type: "noInputFeedback",
      content: null,
    },
    "Sorry, I didn't hear you.",
  ],
];

export function nlg(moves: Move[]): string {
  console.log("generating moves", moves);
  function generateMove(move: Move): string {
    const mapping = nlgMapping.find((x) => objectsEqual(x[0], move));
    if (mapping) {
      return mapping[1];
    }
    throw new Error(`Failed to generate move ${JSON.stringify(move)}`);
  }
  const utterance = moves.map(generateMove).join(" ");
  console.log("generated utterance:", utterance);
  return utterance;
}

/** NLU mapping function can be replaced by statistical NLU
 */
export function nlu(utterance: string): Move[] {
  return nluMapping[utterance.toLowerCase()] || []; // here is returned the empty array in case not understanding
}

export async function nluQdrant(utterance: string): Promise<Move[]> {
  const embedding = await openai.embeddings
    .create({
      model: "qwen3-embedding",
      input: utterance,
      dimensions: 384,
    })
    .then((result) => result.data[0].embedding);
  const points = (await client.query("NLUdata", {
    with_payload: true,
    query: embedding,
    limit: 1,
  })).points;
  if (points.length === 0) {
    return []
  };
  const retrieved_nlu = points.map((item) => ({
    utterance: item.payload?.utterance,
    move: item.payload?.move as Move,
    score: item.score
  }))
  if (retrieved_nlu[0].score < 0.6) {
    return [] }
  return [retrieved_nlu[0].move]
}
