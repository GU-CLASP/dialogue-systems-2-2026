import assert from "node:assert/strict";
import { test } from "node:test";
import { checkNumbers, parseNumbers, randomNumbers, spokenList } from "../src/numbers.ts";

test("digits and words", () => {
  assert.deepEqual(parseNumbers("7, 23 and 61"), [7, 23, 61]);
  assert.deepEqual(parseNumbers("seven, twenty-three and sixty one"), [7, 23, 61]);
  assert.deepEqual(parseNumbers("Seventy eight"), [78]);
  assert.deepEqual(parseNumbers("thirteen thirty"), [13, 30]);
});

test("hundreds and negatives are not mistaken for small numbers", () => {
  assert.deepEqual(parseNumbers("one hundred"), [100]);
  assert.deepEqual(parseNumbers("a hundred"), [100]);
  assert.deepEqual(parseNumbers("two hundred and five"), [205]);
  assert.deepEqual(parseNumbers("minus five"), [-5]);
  assert.deepEqual(parseNumbers("seven, eighty and ninety nine"), [7, 80, 99]);
  assert.deepEqual(checkNumbers([7, 80, 99], []), { accepted: [7], outOfRange: [80, 99], repeated: [] });
});

test("real Furhat ASR output: numbers heard as a time", () => {
  assert.deepEqual(parseNumbers("7:23 and 61"), [7, 23, 61]);
});

test("homophones only count inside a list of numbers", () => {
  assert.deepEqual(parseNumbers("seven for nine"), [7, 4, 9]);
  assert.deepEqual(parseNumbers("for"), [4]);
  assert.deepEqual(parseNumbers("I'd like to choose seven"), [7]);
  assert.deepEqual(parseNumbers("pick numbers for me"), []);
});

test("out of range, repeats and too many", () => {
  assert.deepEqual(checkNumbers([7, 23, 90], []), { accepted: [7, 23], outOfRange: [90], repeated: [] });
  assert.deepEqual(checkNumbers([7], [7, 23]), { accepted: [], outOfRange: [], repeated: [7] });
  assert.deepEqual(checkNumbers([1, 2, 3, 4], []).accepted, [1, 2, 3]);
  assert.deepEqual(checkNumbers([0, 61], [7, 23]), { accepted: [61], outOfRange: [0], repeated: [] });
});

test("random numbers are distinct and in range", () => {
  const nums = randomNumbers(3, [5]);
  assert.equal(new Set(nums).size, 3);
  assert.ok(nums.every((n) => n >= 1 && n <= 78 && n !== 5));
});

test("spoken lists", () => {
  assert.equal(spokenList([7, 23, 61]), "7, 23 and 61");
  assert.equal(spokenList([7]), "7");
});
