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
