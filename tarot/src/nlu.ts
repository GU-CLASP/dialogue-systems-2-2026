// Rule-based understanding. Fast and predictable; the LLM classifier in llm.ts
// is only consulted when these rules find nothing.
import type { FollowUpIntent } from "./llm.ts";
import { findCardInText, type Card } from "./tarot.ts";

const norm = (text: string) =>
  ` ${text.toLowerCase().replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").trim()} `;
const has = (text: string, phrases: string[]) => phrases.some((p) => norm(text).includes(` ${p} `));

export function isYes(text: string) {
  return has(text, ["yes", "yeah", "yep", "sure", "ok", "okay", "please", "go ahead", "do it", "correct", "right", "that's right", "turn them"]);
}

export function isNo(text: string) {
  return has(text, ["no", "nope", "not", "wrong", "wait", "change", "different"]);
}

export function wantsRandom(text: string) {
  return has(text, ["you choose", "you pick", "random", "surprise me", "any", "anything", "you decide", "don't know", "i don't know"]);
}

export function isGoodbye(text: string) {
  return has(text, ["bye", "goodbye", "that's all", "that is all", "nothing else", "no thanks", "no thank you", "stop", "i'm done", "im done", "enough", "quit"]);
}

const POSITION_WORDS: [string[], number][] = [
  [["first", "1st", "past", "number one", "card one"], 0],
  [["second", "2nd", "present", "middle", "number two", "card two"], 1],
  [["third", "3rd", "future", "last", "final", "number three", "card three"], 2],
];

const EVALUATIVE = ["good", "bad", "positive", "negative", "lucky", "unlucky", "scary", "dangerous", "worry", "worried", "worrying", "dark", "evil"];
// "it/this/that" point back to the card under discussion.
const POINTING = ["it", "this", "that", "this one", "that one"];

function positionIn(text: string): number | undefined {
  for (const [words, position] of POSITION_WORDS) if (has(text, words)) return position;
  return undefined;
}

/** Rule-based follow-up understanding; returns undefined when unsure. */
export function followUpIntent(text: string, deck: Card[]): FollowUpIntent | undefined {
  if (!text.trim()) return undefined;
  // Checked first: "say that again" must not count as "do it again".
  if (has(text, ["repeat", "say that again", "pardon", "what did you say", "come again"])) return { intent: "repeat" };
  if (has(text, ["another reading", "new reading", "another question", "one more reading", "new question", "start over", "draw again", "read again", "shuffle"]))
    return { intent: "another_reading" };
  if (isGoodbye(text) || has(text, ["good bye"]) || norm(text).trim() === "no") return { intent: "goodbye" };
  if (has(text, ["thank you", "thanks", "thank"])) return { intent: "thanks" };

  // The questions real clients ask most after a reading.
  if (has(text, ["is this real", "is it real", "is tarot real", "do you believe", "do you really believe", "is this true", "is that true", "does tarot work", "does this work", "is it accurate", "can you really", "are you sure"]))
    return { intent: "is_it_real" };
  if (has(text, ["when", "how long", "how soon", "what year", "which year", "what month"])) return { intent: "when" };
  if (has(text, ["what should i do", "what can i do", "what do i do", "advice", "what do you suggest", "what would you suggest", "what now", "next step", "how can i"]))
    return { intent: "advice" };
  if (has(text, ["yes or no", "a yes", "a no", "so yes", "is that good news", "will it happen", "will it work", "will he", "will she", "will they", "will i", "does he", "does she", "do they"]))
    return { intent: "yes_or_no" };

  const named = findCardInText(text, deck);
  const position = positionIn(text);
  const asksWhichCard = has(text, ["which", "what card", "which card", "what cards"]);

  // "Is it a good card?", "was it a good car" (ASR), "Is the Tower bad?", "is the second one bad?"
  if (has(text, EVALUATIVE) && !asksWhichCard) {
    return { intent: "good_or_bad", ...(named ? { card: named.name } : {}), ...(position !== undefined ? { position } : {}) };
  }
  if (named) return { intent: "ask_card_meaning", card: named.name };

  const words = norm(text).trim().split(" ");
  const refersToCard = has(text, ["card", "cards", "one", "past", "present", "future", "mean", "meaning"]);
  // "the second", "the last one" — also the answer to "Which card do you mean?"
  if (position !== undefined && (refersToCard || words.length <= 4)) return { intent: "ask_drawn_card", position };

  // "What does it mean?", "tell me more about that"
  if (has(text, POINTING) && has(text, ["mean", "means", "meaning", "about", "more", "explain"])) return { intent: "ask_it" };
  return undefined;
}

// ---------- The opening question ----------

export type Sensitive = "crisis" | "health" | "money" | "legal";

// Ethical tarot readers do not read on these: health, investments, the law.
// Crisis is checked first, since it overlaps with health ("want to die").
const SENSITIVE: [Sensitive, string[]][] = [
  ["crisis", ["suicide", "suicidal", "kill myself", "end my life", "hurt myself", "self harm", "want to die"]],
  ["health", ["cancer", "illness", "sick", "disease", "health", "die", "dying", "pregnant", "pregnancy", "surgery", "hospital", "doctor", "diagnosis", "tumour", "tumor", "covid"]],
  ["money", ["invest", "investment", "investing", "stock", "stocks", "shares", "bitcoin", "crypto", "lottery", "gamble", "gambling", "casino", "loan", "mortgage", "debt"]],
  ["legal", ["court", "lawsuit", "sue", "lawyer", "trial", "custody", "police", "arrested", "jail", "prison"]],
];

export function sensitiveTopic(text: string): Sensitive | undefined {
  for (const [topic, words] of SENSITIVE) if (has(text, words)) return topic;
  return undefined;
}

export type Topic = "love" | "work" | "self" | "general";

const TOPICS: [Topic, string[]][] = [
  ["love", ["love", "relationship", "relationships", "romance", "partner", "dating", "boyfriend", "girlfriend", "crush", "ex", "marriage", "heart"]],
  ["work", ["work", "job", "career", "study", "studies", "school", "university", "exam", "exams", "money"]],
  ["general", ["general", "anything", "everything", "you choose", "surprise me", "don't know", "all of it"]],
  ["self", ["myself", "me", "yourself", "self", "personal", "my life", "life"]],
];

export function topicOf(text: string): Topic | undefined {
  for (const [topic, words] of TOPICS) if (has(text, words)) return topic;
  return undefined;
}

/** "Tell me about my life": too open to read on, so we ask which area. */
export function isVague(text: string): boolean {
  const vague = has(text, ["my life", "my future", "my fortune", "about me", "anything", "something", "general", "a reading", "what the cards say", "what do the cards say"]);
  const focused = topicOf(text) === "love" || topicOf(text) === "work";
  return vague && !focused;
}
