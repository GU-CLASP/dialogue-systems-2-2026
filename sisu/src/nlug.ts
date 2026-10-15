import { Move } from "./types";
import { objectsEqual, WHQ } from "./utils";

interface NLUMapping {
  [index: string]: Move[];
}
type NLGMapping = [Move, string][];

const nluMapping: NLUMapping = {
  "where is the lecture?": [
    {
      type: "ask",
      content: WHQ("booking_room"),
    },
  ],
  "what's your favorite food?": [
    {
      type: "ask",
      content: WHQ("favorite_food"),
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
  // adding friday, thursday and tuesday
  friday: [
    {
      type: "answer",
      content: "Friday",
    },
  ],
  thursday: [
    {
      type: "answer",
      content: "Thursday",
    },
  ],
  tuesday: [
    {
      type: "answer",
      content: "Tuesday",
    },
  ],

  // for vg
  fridayish: [ // noisy variant of friday
    {
      type: "answer",
      content: "Friday",
    },
  ],
  yes: [
    {
      type: "confirm",
      content: "yes"
    },
  ],
  no: [
    {
      type: "confirm",
      content: "no",
    },
  ],
};

const nluConfidenceMapping: {[index: string]: number} = {
  fridayish: 0.4,
};

export function nluScore(utterance: string): number {
  const key = utterance.toLowerCase();
  return key in nluConfidenceMapping ? nluConfidenceMapping[key] : 1.0;
}

const nlgMapping: NLGMapping = [
  [{ type: "ask", content: WHQ("booking_course") }, "Which course?"],
  //; for which day
  [{ type: "ask", content: WHQ("booking_day") }, "Which day?"],
  [{ type: "icm:neg:understanding", content: null},
    "Sorry, I don't understand.",
  ],
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
  [
    {
      type: "answer",
      content: { predicate: "booking_room", argument: "J440" },
    },
    "The lecture is in J440.",
  ],
  
];

function shortContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object" && "argument" in (content as any)) {
    return (content as { argument: string }).argument;
  }
  return "";
}

export function nlg(moves: Move[]): string {
  function generateMove(move: Move): string {
    if (move.type === "icm:usr:confirm") {
      return `Did you say ${shortContentText(move.content.content)}?`;
    }
    const mapping = nlgMapping.find((x) => objectsEqual(x[0], move));
    if (mapping) return mapping[1];
    throw new Error(`Failed to generate move ${JSON.stringify(move)}`);
  }
  return moves.map(generateMove).join(" ");
}


/** NLU mapping function can be replaced by statistical NLU
 */
export function nlu(utterance: string): Move[] {
  return nluMapping[utterance.toLowerCase()] || [];
}
