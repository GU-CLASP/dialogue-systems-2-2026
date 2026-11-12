import assert from "node:assert/strict";
import { test } from "node:test";
import { checkNumbers, correctedNumbers, parseNumbers, randomNumbers, repairChosen, spokenList } from "../src/numbers.ts";

// Both from a real user session (2 Nov): the system kept the first number.
test("self-corrections in the same utterance", () => {
  assert.deepEqual(correctedNumbers("50 no 54"), [54]);
  assert.deepEqual(correctedNumbers("21 know it's 22"), [22]);
  assert.deepEqual(correctedNumbers("thirty, not thirteen"), [30]);
  assert.deepEqual(correctedNumbers("not 13 but 30"), [30]);
  assert.deepEqual(correctedNumbers("seven, no wait, eight, 23 and 61"), [8, 23, 61]);
  assert.deepEqual(correctedNumbers("7, 23 and 61"), [7, 23, 61]);
  assert.deepEqual(correctedNumbers("no idea"), []);
});

test("a correction at the confirmation keeps the other numbers", () => {
  assert.deepEqual(repairChosen([3, 21, 50], "no it's 54"), [3, 21, 54]);
  assert.deepEqual(repairChosen([13, 42, 50], "thirty, not thirteen"), [30, 42, 50]);
  assert.deepEqual(repairChosen([13, 42, 50], "not 13 but 30"), [30, 42, 50]);
  assert.deepEqual(repairChosen([13, 42, 50], "no, thirty, forty two and fifty"), [30, 42, 50]);
  assert.equal(repairChosen([3, 21, 50], "no, 90"), undefined); // out of range: checked from scratch
  assert.equal(repairChosen([3, 21, 50], "no, 21"), undefined); // would repeat a number
});

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
