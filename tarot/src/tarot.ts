// Card data comes from two existing sources:
// - tarotapi.dev: the 78 Rider–Waite–Smith cards (A.E. Waite, 1910) and a search endpoint
// - dariusk/corpora: modern keywords and interpretations from Mark McElroy's
//   "A Guide to Tarot Meanings", which read far better aloud than Waite's prose.
// The merged deck is cached in data/deck.json so a demo still works offline.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const TAROT_API = "https://tarotapi.dev/api/v1";
const MODERN_MEANINGS =
  "https://cdn.jsdelivr.net/gh/dariusk/corpora/data/divination/tarot_interpretations.json";
const CACHE = new URL("../data/deck.json", import.meta.url);

export interface Card {
  name: string; // name in tarotapi.dev, used for search
  spokenName: string; // what Furhat says
  type: "major" | "minor";
  keywords: string[];
  light: string[]; // upright reading
  shadow: string[]; // reversed reading
  fortune: string[];
  waiteUpright: string;
  waiteReversed: string;
}

export interface DrawnCard {
  card: Card;
  reversed: boolean;
  number: number; // the number the user chose
}

interface ApiCard {
  name: string;
  type: "major" | "minor";
  meaning_up: string;
  meaning_rev: string;
}

interface ModernCard {
  name: string;
  keywords: string[];
  meanings: { light: string[]; shadow: string[] };
  fortune_telling: string[];
}

// The two sources name 19 cards differently.
const MODERN_TO_API: Record<string, string> = {
  strength: "fortitude",
  "the wheel": "wheel of fortune",
  "the papess/high priestess": "the high priestess",
  "the pope/hierophant": "the hierophant",
  judgement: "the last judgment",
};

const SPOKEN_NAME: Record<string, string> = {
  Fortitude: "Strength",
  "The Last Judgment": "Judgement",
};

export function apiNameFor(modernName: string): string {
  const lower = modernName.toLowerCase();
  return MODERN_TO_API[lower] ?? lower.replace(/ of coins$/, " of pentacles");
}

export function mergeSources(apiCards: ApiCard[], modern: ModernCard[]): Card[] {
  const byApiName = new Map(modern.map((m) => [apiNameFor(m.name), m]));
  return apiCards.map((c) => {
    const m = byApiName.get(c.name.toLowerCase());
    return {
      name: c.name,
      spokenName: SPOKEN_NAME[c.name] ?? c.name,
      type: c.type,
      keywords: m?.keywords ?? [],
      light: m?.meanings.light ?? [c.meaning_up],
      shadow: m?.meanings.shadow ?? [c.meaning_rev],
      fortune: m?.fortune_telling ?? [],
      waiteUpright: c.meaning_up,
      waiteReversed: c.meaning_rev,
    };
  });
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function loadDeck(): Promise<Card[]> {
  try {
    const [api, modern] = await Promise.all([
      getJson<{ cards: ApiCard[] }>(`${TAROT_API}/cards`),
      getJson<{ tarot_interpretations: ModernCard[] }>(MODERN_MEANINGS),
    ]);
    const deck = mergeSources(api.cards, modern.tarot_interpretations);
    const unmatched = deck.filter((c) => c.keywords.length === 0).map((c) => c.name);
    if (unmatched.length) console.warn(`No modern meanings for: ${unmatched.join(", ")} (check MODERN_TO_API)`);
    mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
    writeFileSync(CACHE, JSON.stringify(deck, null, 1));
    return deck;
  } catch (err) {
    if (existsSync(CACHE)) {
      console.warn(`Card sources unreachable (${err}); using cached deck.`);
      return JSON.parse(readFileSync(CACHE, "utf8")) as Card[];
    }
    throw err;
  }
}

/** Look a card up by name through the API's search endpoint, falling back to the local deck. */
export async function searchCard(query: string, deck: Card[]): Promise<Card | undefined> {
  const local = findCardInText(query, deck);
  if (local) return local;
  try {
    const res = await getJson<{ cards: ApiCard[] }>(
      `${TAROT_API}/cards/search?q=${encodeURIComponent(query)}`,
    );
    // The API also matches words in meanings; only accept hits whose *name* matches.
    const q = query.toLowerCase().replace(/^the /, "");
    const hit = res.cards.find((c) => c.name.toLowerCase().includes(q));
    return hit && deck.find((c) => c.name === hit.name);
  } catch {
    return undefined;
  }
}

/** Finds a card named anywhere in an utterance ("is the tower bad?"), longest name first. */
export function findCardInText(text: string, deck: Card[]): Card | undefined {
  const t = ` ${text.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ")} `;
  const candidates = deck.flatMap((c) => {
    const names = new Set([c.name, c.spokenName].map((n) => n.toLowerCase()));
    for (const n of [...names]) if (n.startsWith("the ")) names.add(n.slice(4));
    return [...names].map((n) => ({ n, c }));
  });
  candidates.sort((a, b) => b.n.length - a.n.length);
  return candidates.find(({ n }) => t.includes(` ${n} `))?.c;
}

export function shuffle<T>(items: T[], rand = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function draw(shuffled: Card[], numbers: number[], rand = Math.random): DrawnCard[] {
  // Upright or reversed with equal chance, as when a real deck is shuffled.
  return numbers.map((n) => ({ card: shuffled[n - 1], reversed: rand() < 0.5, number: n }));
}

const HARD_CARDS = new Set([
  "The Tower", "Death", "The Devil", "The Moon", "Ten of Swords", "Nine of Swords",
  "Three of Swords", "Five of Cups", "Five of Pentacles", "Eight of Swords", "Five of Swords",
]);
const BRIGHT_CARDS = new Set([
  "The Sun", "The Star", "The World", "The Lovers", "Ten of Cups", "Nine of Cups",
  "Ace of Cups", "Six of Wands", "Four of Wands", "Wheel of Fortune", "Ace of Pentacles",
]);

/** The card's character in general, ignoring orientation. */
export function cardTone(card: Card): "bright" | "hard" | "neutral" {
  if (HARD_CARDS.has(card.name)) return "hard";
  if (BRIGHT_CARDS.has(card.name)) return "bright";
  return "neutral";
}

/** How Furhat's face should react when a card is turned. */
export function toneOf({ card, reversed }: DrawnCard): "bright" | "hard" | "neutral" {
  const tone = cardTone(card);
  if (tone === "bright") return reversed ? "neutral" : "bright";
  if (tone === "neutral") return reversed ? "hard" : "neutral";
  return "hard";
}
