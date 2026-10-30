// Varied wording for turning the cards, so the reading sounds like a person
// rather than "Your past... Your present... Your future...".
import type { Sensitive, Topic } from "./nlu.ts";
import { cardTone, toneOf, type DrawnCard } from "./tarot.ts";

const pick = <T>(items: T[], rand = Math.random) => items[Math.floor(rand() * items.length)];

const OPENERS: string[][] = [
  [
    "Let us begin with what lies behind you.",
    "The first card speaks of your past.",
    "Looking back, the cards show me",
  ],
  [
    "Now, where you stand today.",
    "And in this very moment,",
    "The second card shows me your present.",
  ],
  [
    "And finally, what lies ahead.",
    "Let us see where this path is leading you.",
    "The last card reveals what is coming.",
  ],
];

const REACTIONS = {
  bright: ["Ah,", "Oh, how lovely,", "Wonderful,"],
  hard: ["Hmm...", "I see...", "Ah... interesting,"],
  neutral: ["", "Mm,", ""],
};

/** "the Two of Wands", "the Tower", "Death". */
export function cardWithArticle(drawn: DrawnCard): string {
  const name = drawn.card.spokenName;
  if (name.startsWith("The ")) return `the ${name.slice(4)}`;
  return drawn.card.type === "minor" || name === "Wheel of Fortune" ? `the ${name}` : name;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * "Is it a good card?" — answer the question directly first, then the bright side.
 * Never calls a card simply "bad": hard cards are "challenging".
 */
export function goodOrBadAnswer(drawn: DrawnCard): string {
  const name = capitalise(cardWithArticle(drawn));
  const brightSide = drawn.card.light[0]?.replace(/\.$/, "").toLowerCase() ?? drawn.card.keywords.slice(0, 2).join(" and ");
  let verdict: string;
  const tone = cardTone(drawn.card);
  if (tone === "bright") {
    verdict = `${name} is one of the brightest cards in the deck, so yes, it is a good sign.`;
  } else if (tone === "hard") {
    verdict = `${name} is a challenging card, but not a bad one. On its bright side, it speaks of ${brightSide}.`;
  } else {
    verdict = `${name} is neither good nor bad; it depends on how you use its energy. At its best, it speaks of ${brightSide}.`;
  }

  if (drawn.reversed) {
    verdict += " It came up reversed, so its energy is held back for now, but that can change.";
  }
  return verdict;
}

/** e.g. "Now, where you stand today. Hmm... the Tower." */
export function revealLine(index: number, drawn: DrawnCard, explainReversed: boolean, rand = Math.random): string {
  const opener = pick(OPENERS[index] ?? ["Next,"], rand);
  let turned = "";
  if (drawn.reversed && explainReversed) {
    turned = ", upside down. When a card appears reversed, its energy is held back or turned inward";
  } else if (drawn.reversed) {
    turned = ", reversed";
  }
  const name = `${cardWithArticle(drawn)}${turned}.`;
  // An opener that ends mid-sentence ("Looking back, the cards show me") flows straight into the card.
  if (!/[.!?]$/.test(opener)) return `${opener} ${name}`;
  const reaction = pick(REACTIONS[toneOf(drawn)], rand);
  return `${opener} ${reaction ? `${reaction} ${name}` : capitalise(name)}`;
}

/** The last card, as spoken: "the Six of Wands", "the Devil, reversed,". */
function lastCard(drawn: DrawnCard[]): { name: string; hint: string } {
  const last = drawn[drawn.length - 1];
  const name = `${cardWithArticle(last)}${last.reversed ? ", reversed," : ""}`;
  const hint = last.card.keywords[0]?.toLowerCase() ?? "change";
  return { name, hint };
}

/**
 * "So is that a yes or no?" Tarot shows tendencies, so the answer is a lean,
 * never a flat no. The last card counts double: it is about what is coming.
 */
export function yesOrNoAnswer(drawn: DrawnCard[]): { text: string; lean: "yes" | "unclear" | "open" } {
  let score = 0;
  drawn.forEach((d, i) => {
    const weight = i === drawn.length - 1 ? 2 : 1;
    const tone = toneOf(d);
    if (tone === "bright") score += weight;
    if (tone === "hard") score -= weight;
  });

  const { name, hint } = lastCard(drawn);
  if (score > 0) {
    return { lean: "yes", text: `The cards lean towards yes, especially ${name} at the end. Still, tarot shows possibilities, not promises, so what you do next matters most.` };
  }
  if (score < 0) {
    return { lean: "unclear", text: `The cards do not give a clear yes just now. ${capitalise(name)} at the end asks for patience, so the answer may depend on what you do next.` };
  }
  return { lean: "open", text: `The cards do not give a simple yes or no. ${capitalise(name)} at the end points to ${hint}, so the answer is still open, and partly in your hands.` };
}

/** "When will it happen?" Tarot cannot give dates, so say so honestly. */
export function whenAnswer(drawn: DrawnCard[]): string {
  const { name, hint } = lastCard(drawn);
  return `The cards cannot show me a date: tarot speaks of how things unfold, not when. But ${name} at the end suggests that the next chapter is about ${hint}.`;
}

export const IS_IT_REAL =
  "Honestly? I am a robot, and your cards were drawn at random. Tarot cannot see the future, " +
  "but it can be a nice way to look at your question from a new angle.";

/** What to say instead of reading on a sensitive question, and a gentler question to offer. */
export const SENSITIVE_REPLY: Record<Exclude<Sensitive, "crisis">, { reply: string; reframe: string }> = {
  health: {
    reply: "That is a question for doctors, not for the cards, and I would never want to guess about something so important.",
    reframe: "What can help me support myself and the people I love right now?",
  },
  money: {
    reply: "The cards cannot give financial advice, and I would hate for them to decide what you do with your money.",
    reframe: "What can help me feel calmer and wiser about money?",
  },
  legal: {
    reply: "Legal matters are for a lawyer, not for the cards.",
    reframe: "What can help me face this situation with a clear head?",
  },
};

export const CRISIS_REPLY =
  "That sounds really heavy, and it is far too important for the cards. Please talk to someone you trust, or call a support line: " +
  "in Sweden, Mind's helpline is 90101, and in an emergency, call 112. " +
  "If you would still like a reading about something else, tell me your question, or say goodbye.";

export const TOPIC_QUESTION: Record<Exclude<Topic, "general">, string> = {
  love: "What do I need to know about love right now?",
  work: "What do I need to know about my work and studies?",
  self: "What do I need to know about myself right now?",
};
