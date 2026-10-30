// The LLM only *phrases* readings. Cards come from the API and meanings from the
// dataset; every reply is cleaned, checked, and replaced by a template if it fails.
import type { Card, DrawnCard } from "./tarot.ts";

const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = process.env.LLM_MODEL ?? "gemma4";
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 20_000);

const PERSONA = `You are Madame Furhat, a warm and slightly mysterious tarot reader.
You speak aloud through a robot, so:
- reply in at most two short sentences of plain spoken English;
- no lists, no markdown, no emojis, no stage directions;
- use only the card meaning you are given, and relate it to the user's question;
- never mention any other card;
- be kind: frame difficult cards gently, as advice or a chance to grow, never as doom;
- this is entertainment: never predict illness, disaster or failure, and never give medical, legal or financial instructions.`;

type Message = { role: "system" | "user" | "assistant"; content: string };

export async function chat(messages: Message[], opts: { json?: boolean; maxTokens?: number } = {}) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      think: false,
      ...(opts.json ? { format: "json" } : {}),
      options: { temperature: opts.json ? 0 : 0.7, num_predict: opts.maxTokens ?? 120 },
      messages,
    }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? "";
}

/** Makes LLM text safe to speak: no markdown or emoji, at most `maxSentences` sentences. */
export function cleanForSpeech(text: string, maxSentences = 2): string {
  const plain = text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/[*_#`~>|\[\]]/g, "")
    .replace(/[\p{Extended_Pictographic}️‍]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = plain.match(/[^.!?]+[.!?]+/g) ?? (plain ? [plain] : []);
  return sentences.slice(0, maxSentences).map((s) => s.trim()).join(" ");
}

const BAD_SIGNS = /\b(as an ai|language model|i cannot|i can't help)\b/i;

/** A reply is usable if it is non-empty, short enough to say, and stays in character. */
export function isUsable(text: string): boolean {
  return text.length >= 15 && text.length <= 320 && !BAD_SIGNS.test(text);
}

async function phrase(prompt: string, fallback: string, maxSentences = 2): Promise<{ text: string; source: "llm" | "template" }> {
  try {
    const raw = await chat([{ role: "system", content: PERSONA }, { role: "user", content: prompt }]);
    const text = cleanForSpeech(raw, maxSentences);
    if (isUsable(text)) return { text, source: "llm" };
    console.warn(`LLM reply rejected, using template: ${JSON.stringify(raw)}`);
  } catch (err) {
    console.warn(`LLM unavailable, using template: ${err}`);
  }
  return { text: fallback, source: "template" };
}

const POSITIONS = [
  { name: "past", hint: "what led to the situation; speak in the past tense" },
  { name: "present", hint: "what is happening now; speak in the present tense" },
  { name: "future", hint: "where things are heading; speak about what may come" },
];

export function positionName(i: number) {
  return POSITIONS[i]?.name ?? "card";
}

function meaningOf({ card, reversed }: DrawnCard) {
  return (reversed ? card.shadow : card.light).slice(0, 3);
}

export function templateReading(drawn: DrawnCard): string {
  const kw = drawn.card.keywords.slice(0, 2).join(" and ");
  const meaning = meaningOf(drawn)[0]?.toLowerCase();
  if (drawn.reversed) return `Reversed, it warns of ${meaning ?? kw}.`;
  return kw ? `It speaks of ${kw}. ${meaning ? `Think of ${meaning}.` : ""}`.trim() : `Think of ${meaning}.`;
}

export function interpretCard(question: string, drawn: DrawnCard, index: number, earlier: DrawnCard[] = []) {
  const pos = POSITIONS[index];
  const before = earlier.length
    ? `Cards already read: ${earlier.map((d, i) => `${positionName(i)} = ${d.card.spokenName} (${d.card.keywords.slice(0, 2).join(", ")})`).join("; ")}
You may link briefly to the previous card so the reading flows like one story.`
    : "This is the first card of the reading.";
  const prompt = `User's question: ${question || "(a general reading)"}
Position: ${pos.name} (${pos.hint})
Card: ${drawn.card.spokenName}${drawn.reversed ? " (reversed)" : ""}
Keywords: ${drawn.card.keywords.join(", ")}
Meaning to use: ${meaningOf(drawn).join("; ")}
Fortune-telling hint: ${drawn.card.fortune.slice(0, 2).join("; ")}
${before}
The card's name has just been announced, so do not repeat it, and do not say the words "past", "present" or "future".
Explain what this card says about the user's question, as if talking to them face to face.`;
  return phrase(prompt, templateReading(drawn));
}

export async function summarise(question: string, drawn: DrawnCard[]) {
  const cards = drawn
    .map((d, i) => `${positionName(i)}: ${d.card.spokenName}${d.reversed ? " (reversed)" : ""} — ${d.card.keywords.slice(0, 3).join(", ")}`)
    .join("\n");
  const prompt = `User's question: ${question || "(a general reading)"}
The three cards:
${cards}
In ONE warm, encouraging sentence starting with "In short,", give the overall message of the reading for the user's question.
Even if some cards are difficult, turn them into advice and end on a hopeful note.`;
  const fallback = "In short, the cards suggest that with patience and a clear plan, things can turn in your favour.";
  const result = await phrase(prompt, fallback, 1);
  // Keep the promised shape even if the model forgets the opening words.
  if (result.source === "llm" && !/^in short/i.test(result.text)) {
    result.text = `In short, ${result.text.charAt(0).toLowerCase()}${result.text.slice(1)}`;
  }
  return result;
}

/** For "what does the Tower mean?" — general meaning, not tied to a position. */
export function describeCard(card: Card, question: string) {
  const prompt = `The user asks about a card in general. Their original question was: ${question || "(none)"}
Card: ${card.spokenName}
Keywords: ${card.keywords.join(", ")}
Bright side: ${card.light.slice(0, 2).join("; ")}
Shadow side: ${card.shadow.slice(0, 2).join("; ")}
Briefly explain what this card means, mentioning both its bright and shadow side.`;
  const fallback = `${card.spokenName} stands for ${card.keywords.slice(0, 3).join(", ")}.`;
  return phrase(prompt, fallback);
}

export type FollowUpIntent =
  | { intent: "ask_drawn_card"; position: number }
  | { intent: "ask_card_meaning"; card: string }
  | { intent: "good_or_bad"; position?: number; card?: string } // neither given: "it" = the card under discussion
  | { intent: "ask_it" } // "what does it mean?"
  | { intent: "another_reading" | "repeat" | "goodbye" | "other" };

/** LLM fallback for follow-ups the rule-based NLU did not understand. */
export async function classifyFollowUp(utterance: string): Promise<FollowUpIntent> {
  const system = `Classify a user's utterance after a three-card tarot reading (cards 1=past, 2=present, 3=future).
Return ONLY JSON: {"intent": "ask_drawn_card"|"ask_card_meaning"|"good_or_bad"|"ask_it"|"another_reading"|"repeat"|"goodbye"|"other", "position": 1|2|3|null, "card": string|null}
- ask_drawn_card: asks about one of the drawn cards (give position)
- ask_card_meaning: asks what a named tarot card means (give card name)
- good_or_bad: asks whether a card is good or bad (give position or card name if mentioned, else null for "it")
- ask_it: asks about "it" / "this" / "that" card without naming it
- another_reading: wants a new reading or new question
- repeat: wants the last thing repeated
- goodbye: wants to stop
- other: anything else`;
  try {
    const raw = await chat([{ role: "system", content: system }, { role: "user", content: utterance }], { json: true, maxTokens: 60 });
    const parsed = JSON.parse(raw) as { intent?: string; position?: number | null; card?: string | null };
    if (parsed.intent === "ask_drawn_card" && parsed.position && parsed.position >= 1 && parsed.position <= 3)
      return { intent: "ask_drawn_card", position: parsed.position - 1 };
    if (parsed.intent === "ask_card_meaning" && parsed.card) return { intent: "ask_card_meaning", card: parsed.card };
    if (parsed.intent === "good_or_bad") {
      const pos = parsed.position && parsed.position >= 1 && parsed.position <= 3 ? parsed.position - 1 : undefined;
      return { intent: "good_or_bad", ...(pos !== undefined ? { position: pos } : {}), ...(parsed.card ? { card: parsed.card } : {}) };
    }
    if (parsed.intent === "ask_it") return { intent: "ask_it" };
    if (parsed.intent === "another_reading" || parsed.intent === "repeat" || parsed.intent === "goodbye")
      return { intent: parsed.intent };
  } catch (err) {
    console.warn(`LLM classification failed: ${err}`);
  }
  return { intent: "other" };
}
