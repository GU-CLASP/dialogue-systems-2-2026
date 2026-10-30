import assert from "node:assert/strict";
import { test } from "node:test";
import { cardWithArticle, revealLine } from "../src/phrases.ts";
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
