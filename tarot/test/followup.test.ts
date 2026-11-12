import assert from "node:assert/strict";
import { test } from "node:test";
import { planFollowUp, type Subject } from "../src/followup.ts";
import { goodOrBadAnswer } from "../src/phrases.ts";
import type { Card, DrawnCard } from "../src/tarot.ts";

const card = (name: string, type: "major" | "minor" = "major"): Card => ({
  name, spokenName: name, type, keywords: ["change"], light: ["Breaking old habits."], shadow: [], fortune: [], waiteUpright: "", waiteReversed: "",
});
const deck = [card("The Tower"), card("The Sun"), card("Five of Cups", "minor"), card("Temperance")];
const drawn: DrawnCard[] = [
  { card: deck[1], reversed: false, number: 3 },
  { card: deck[0], reversed: false, number: 15 },
  { card: deck[2], reversed: false, number: 27 },
];
const base = { deck, drawn, focus: null as Subject | null, pendingGoodOrBad: false };

test("'is it good?' refers to the card under discussion", () => {
  const focus = { drawn: drawn[2], index: 2 };
  const plan = planFollowUp({ intent: "good_or_bad" }, { ...base, focus });
  assert.equal(plan.route, "GoodOrBad");
  assert.equal(plan.subject?.drawn.card.name, "Five of Cups");
});

test("without a card under discussion, ask which one, then answer the original question", () => {
  const ask = planFollowUp({ intent: "good_or_bad" }, base);
  assert.deepEqual(ask, { route: "AskWhichCard", pendingGoodOrBad: true });
  const answer = planFollowUp({ intent: "ask_drawn_card", position: 1 }, { ...base, pendingGoodOrBad: true });
  assert.equal(answer.route, "GoodOrBad");
  assert.equal(answer.subject?.drawn.card.name, "The Tower");
});

test("named and positional good/bad questions", () => {
  assert.equal(planFollowUp({ intent: "good_or_bad", card: "Temperance" }, base).subject?.index, -1);
  assert.equal(planFollowUp({ intent: "good_or_bad", card: "The Tower" }, base).subject?.index, 1);
  assert.equal(planFollowUp({ intent: "good_or_bad", position: 0 }, base).subject?.drawn.card.name, "The Sun");
});

test("'what does it mean?' follows the focus", () => {
  assert.equal(planFollowUp({ intent: "ask_it" }, { ...base, focus: { drawn: drawn[0], index: 0 } }).route, "AnswerDrawnCard");
  assert.equal(planFollowUp({ intent: "ask_it" }, base).route, "AskWhichCard");
});

test("good/bad answers are direct but never call a card bad", () => {
  assert.match(goodOrBadAnswer(drawn[0]), /^The Sun is one of the brightest cards/);
  assert.match(goodOrBadAnswer(drawn[1]), /^The Tower is a challenging card, but not a bad one\. On its bright side, it speaks of breaking old habits\.$/);
  assert.match(goodOrBadAnswer({ ...drawn[2], reversed: true }), /^The Five of Cups is .*reversed/);
});
