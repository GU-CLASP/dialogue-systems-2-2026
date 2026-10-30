import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanForSpeech, isUsable } from "../src/llm.ts";
import { followUpIntent, isNo, isYes, wantsRandom } from "../src/nlu.ts";
import { apiNameFor, findCardInText, mergeSources, type Card } from "../src/tarot.ts";

const card = (name: string): Card => ({
  name, spokenName: name === "Fortitude" ? "Strength" : name, type: "major",
  keywords: [], light: [], shadow: [], fortune: [], waiteUpright: "", waiteReversed: "",
});
const deck = ["The Tower", "Death", "Temperance", "Fortitude", "Ace of Cups", "Two of Cups"].map(card);

test("confirmation", () => {
  assert.ok(isYes("yes please"));
  assert.ok(isYes("okay go ahead"));
  assert.ok(isNo("no wait"));
  assert.ok(!isYes("hmm"));
  assert.ok(wantsRandom("you choose for me"));
});

test("follow-up: reference to a drawn card", () => {
  assert.deepEqual(followUpIntent("what was the second card again?", deck), { intent: "ask_drawn_card", position: 1 });
  assert.deepEqual(followUpIntent("tell me more about the future card", deck), { intent: "ask_drawn_card", position: 2 });
  assert.deepEqual(followUpIntent("what about the last one", deck), { intent: "ask_drawn_card", position: 2 });
});

test("follow-up: good or bad, including real ASR errors from user tests", () => {
  assert.deepEqual(followUpIntent("is it a good car", deck), { intent: "good_or_bad" });
  assert.deepEqual(followUpIntent("we did a good card or the bad card", deck), { intent: "good_or_bad" });
  assert.deepEqual(followUpIntent("was it a good card or a bad card?", deck), { intent: "good_or_bad" });
  assert.deepEqual(followUpIntent("Is the Tower always a bad card?", deck), { intent: "good_or_bad", card: "The Tower" });
  assert.deepEqual(followUpIntent("is the second one bad", deck), { intent: "good_or_bad", position: 1 });
  assert.equal(followUpIntent("which card means good luck", deck), undefined);
  assert.deepEqual(followUpIntent("good bye", deck), { intent: "goodbye" });
});

test("follow-up: 'it' and short answers to 'which card do you mean?'", () => {
  assert.deepEqual(followUpIntent("what does it mean", deck), { intent: "ask_it" });
  assert.deepEqual(followUpIntent("tell me more about that", deck), { intent: "ask_it" });
  assert.deepEqual(followUpIntent("the second", deck), { intent: "ask_drawn_card", position: 1 });
});

test("follow-up: asking about a named card", () => {
  assert.deepEqual(followUpIntent("what does strength mean", deck), { intent: "ask_card_meaning", card: "Fortitude" });
  assert.deepEqual(followUpIntent("and two of cups?", deck), { intent: "ask_card_meaning", card: "Two of Cups" });
});

test("follow-up: other intents", () => {
  assert.deepEqual(followUpIntent("can you say that again", deck), { intent: "repeat" });
  assert.deepEqual(followUpIntent("I want another reading", deck), { intent: "another_reading" });
  assert.deepEqual(followUpIntent("no, that's all, thanks", deck), { intent: "goodbye" });
  assert.equal(followUpIntent("which card means good luck", deck), undefined);
});

test("card name mapping between the two sources", () => {
  assert.equal(apiNameFor("Seven of Coins"), "seven of pentacles");
  assert.equal(apiNameFor("Strength"), "fortitude");
  assert.equal(apiNameFor("The Tower"), "the tower");
  const merged = mergeSources(
    [{ name: "Fortitude", type: "major", meaning_up: "old", meaning_rev: "old rev" }],
    [{ name: "Strength", keywords: ["courage"], meanings: { light: ["be brave"], shadow: ["doubt"] }, fortune_telling: [] }],
  );
  assert.equal(merged[0].spokenName, "Strength");
  assert.deepEqual(merged[0].keywords, ["courage"]);
  assert.equal(findCardInText("tell me about death", deck)?.name, "Death");
});

test("LLM output is made speakable", () => {
  assert.equal(cleanForSpeech("**The Tower** shakes things up! 🌩️ Expect change. Stay calm."), "The Tower shakes things up! Expect change.");
  assert.ok(!isUsable(""));
  assert.ok(!isUsable("As an AI language model, I cannot predict the future."));
  assert.ok(isUsable("Something unexpected may shake your plans."));
});
