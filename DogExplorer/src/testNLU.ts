import { understandUser } from "./nlu";

const tests = [
  { utterance: "I want a small dog" },
  { utterance: "Tell me about the first one" },
  { utterance: "Tell me more about the second one" },
  { utterance: "How big does it get?" },
  { utterance: "What is its temperament?" },
  { utterance: "Not very active", lastQuestion: "activity" },
  { utterance: "Not much", lastQuestion: "grooming" }
];

for (const test of tests) {
  console.log("\nUSER:", test.utterance);

  const result = await understandUser(test.utterance, test.lastQuestion);

  console.log("RESULT:", result);
}
