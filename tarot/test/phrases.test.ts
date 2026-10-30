import assert from "node:assert/strict";
import { test } from "node:test";
import { cardWithArticle, revealLine, whenAnswer, yesOrNoAnswer } from "../src/phrases.ts";
import type { Card, DrawnCard } from "../src/tarot.ts";

const drawn = (name: string, type: "major" | "minor", reversed = false): DrawnCard => ({
  card: { name, spokenName: name, type, keywords: [], light: [], shadow: [], fortune: [], waiteUpright: "", waiteReversed: "" } as Card,
  reversed,
  number: 1,
});

test("articles for spoken card names", () => {
  assert.equal(cardWithArticle(drawn("The Tower", "major")), "the Tower");
  assert.equal(cardWithArticle(drawn("Two of Wands", "minor")), "the Two of Wands");
  assert.equal(cardWithArticle(drawn("Death", "major")), "Death");
  assert.equal(cardWithArticle(drawn("Wheel of Fortune", "major")), "the Wheel of Fortune");
});

test("reveal lines read naturally for every opener", () => {
  for (let i = 0; i < 3; i++) {
    for (let r = 0; r < 1; r += 0.1) {
      const line = revealLine(i, drawn("The Tower", "major"), false, () => r);
      assert.match(line, /the Tower\.$|The Tower\.$/, line);
      assert.doesNotMatch(line, /\b(past|present|future)\.\.\./i, line);
      assert.doesNotMatch(line, /  |me [A-Z]/, line);
    }
  }
  assert.match(revealLine(0, drawn("Death", "major", true), true, () => 0), /upside down\. When a card appears reversed/);
});

test("yes or no: a lean, never a flat no; the last card counts double", () => {
  const sun = drawn("The Sun", "major");
  const tower = drawn("The Tower", "major");
  const page = drawn("Page of Swords", "minor");
  assert.equal(yesOrNoAnswer([tower, page, sun]).lean, "yes"); // -1 + 0 + 2
  assert.equal(yesOrNoAnswer([sun, page, tower]).lean, "unclear"); // 1 + 0 - 2
  assert.equal(yesOrNoAnswer([sun, tower, page]).lean, "open"); // 1 - 1 + 0
  for (const cards of [[tower, page, sun], [sun, page, tower], [sun, tower, page]]) {
    assert.doesNotMatch(yesOrNoAnswer(cards).text, /towards no|answer is no|\bwill not\b/i);
  }
});

test("when: no dates, but points to the last card", () => {
  assert.match(whenAnswer([drawn("Death", "major"), drawn("The Moon", "major"), drawn("Six of Wands", "minor", true)]), /cannot show me a date.*the Six of Wands, reversed,/);
});
