// Varied wording for turning the cards, so the reading sounds like a person
// rather than "Your past... Your present... Your future...".
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
  const tone = cardTone(drawn.card);
  const verdict =
    tone === "bright"
      ? `${name} is one of the brightest cards in the deck, so yes, it is a good sign.`
      : tone === "hard"
        ? `${name} is a challenging card, but not a bad one. On its bright side, it speaks of ${brightSide}.`
        : `${name} is neither good nor bad; it depends on how you use its energy. At its best, it speaks of ${brightSide}.`;
  return drawn.reversed ? `${verdict} It came up reversed, so its energy is held back for now, but that can change.` : verdict;
}

/** e.g. "Now, where you stand today. Hmm... the Tower." */
export function revealLine(index: number, drawn: DrawnCard, explainReversed: boolean, rand = Math.random): string {
  const opener = pick(OPENERS[index] ?? ["Next,"], rand);
  const turned = !drawn.reversed
    ? ""
    : explainReversed
      ? ", upside down. When a card appears reversed, its energy is held back or turned inward"
      : ", reversed";
  const name = `${cardWithArticle(drawn)}${turned}.`;
  // An opener that ends mid-sentence ("Looking back, the cards show me") flows straight into the card.
  if (!/[.!?]$/.test(opener)) return `${opener} ${name}`;
  const reaction = pick(REACTIONS[toneOf(drawn)], rand);
  return `${opener} ${reaction ? `${reaction} ${name}` : capitalise(name)}`;
}
