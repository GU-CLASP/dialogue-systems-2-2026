// Scenario tests for the dialogue manager
// The NLU, TheDogAPI and RAG are replaced with fake versions, so the tests
// check the dialogue logic only and run without Ollama, Qdrant or internet.
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createInitialState, processDialogue, runTurn, type DialogueServices } from "../src/processDialogue";
import { understandUser, type NLUResult } from "../src/nlu";
import { estimateActivity, estimateGrooming, findMatchingBreeds } from "../src/breedMatcher";
import type { Breed } from "../src/types";

// 23 real breeds saved from TheDogAPI
const breeds: Breed[] = JSON.parse(readFileSync(new URL("./fixtures/breeds.json", import.meta.url), "utf8"));

const breed = (name: string) => breeds.find(b => b.name === name)!;

// what the fake NLU returns for each utterance in the scenarios
const nluResults: Record<string, NLUResult> = {
  "I want a small dog": { intent: "set_preferences", sizes: ["small"], preferenceOperation: "replace" },
  "Pretty active, I run a lot": { intent: "set_preferences", activity: "high" },
  "Not much": { intent: "set_preferences", grooming: "low" },
  "I don't mind": { intent: "set_preferences", grooming: "any" },
  "I want a medium-sized, active dog that doesn't need much grooming": { intent: "set_preferences", sizes: ["medium"], activity: "high", grooming: "low", preferenceOperation: "replace" },
  "Nothing huge": { intent: "set_preferences", sizes: ["small", "medium"], preferenceOperation: "replace" },
  "Actually, larger dogs are okay too": { intent: "set_preferences", sizes: ["large"], preferenceOperation: "add" },
  "Tell me more about the second one": { intent: "select_result", resultIndex: 2 },
  "Tell me about the first one": { intent: "select_result", resultIndex: 1 },
  "Tell me about the fifth one": { intent: "select_result", resultIndex: 5 },
  "How big does it get?": { intent: "ask_about_breed", questionType: "size" },
  "Does it need much grooming?": { intent: "ask_about_breed", questionType: "grooming" },
  "Tell me about Whippets, do they need much grooming?": { intent: "ask_about_breed", breedName: "Whippets", questionType: "grooming" },
  "Anything else?": { intent: "more_options" },
  "Just show me some dogs": { intent: "show_results" },
  "Just show me large dogs": { intent: "show_results", sizes: ["large"], preferenceOperation: "replace" },
  "Something smaller": { intent: "set_preferences", sizes: ["medium"], preferenceOperation: "replace" },
  "Start over": { intent: "restart" },
  "What can I say?": { intent: "help" },
  "Hello!": { intent: "general_question" },
  "Which of these is best with kids?": { intent: "general_question" },
  "I want a large, very calm dog": { intent: "set_preferences", sizes: ["large"], activity: "low", preferenceOperation: "replace" },
};

function createServices(): DialogueServices {
  return {
    understand: async (utterance) => nluResults[utterance] ?? { intent: "unknown" },
    getAllBreeds: async () => breeds,
    searchBreed: async (name) => breeds.filter(b => b.name.toLowerCase().includes(name.toLowerCase())),
    // the knowledge base only has documents about Whippets
    answerWithRAG: async (breedName) => breedName === "Whippet" ? "Whippets have short coats and need very little grooming." : null,
    // the fake LLM fallback only understands these, everything else (like "bla bla") is not understood
    respondFreely: async (utterance, context) => {
      if (utterance === "Hello!") return { understood: true, reply: "Hi there!" };
      if (utterance === "Which of these is best with kids?") return { understood: true, reply: `Of ${context.results.map(b => b.name).join(", ")}, the first is known to be good with kids.` };
      return { understood: false, reply: "" };
    },
  };
}

// runs a dialogue and returns the system's answers
async function run(utterances: string[], state = createInitialState()) {
  const services = createServices();
  const answers: string[] = [];

  for (const utterance of utterances) {
    answers.push(await processDialogue(utterance, state, services));
  }

  return { answers, state };
}

test("collects preferences over several turns and asks for missing information", async () => {
  const { answers, state } = await run(["I want a small dog", "Pretty active, I run a lot", "Not much"]);

  assert.equal(answers[0], "Okay, small size. That leaves 9 breeds. How active would you like the dog to be?");
  assert.equal(answers[1], "Okay, very active. That leaves 4 breeds. How much grooming are you comfortable with?");
  assert.match(answers[2], /^Okay, low grooming\. I found two breeds/);
  assert.deepEqual(state.searchResults.map(b => b.name), ["Miniature Schnauzer", "Jack Russell Terrier"]);
  assert.equal(state.phase, "exploring_results");
});

test("results explain why each breed matches", async () => {
  const { answers } = await run(["I want a small dog", "Pretty active, I run a lot", "Not much"]);

  assert.match(answers[2], /First, Miniature Schnauzer, small, very active, moderate grooming\./);
  assert.match(answers[2], /Which one would you like to hear more about\?$/);
});

test("understands several preferences in one utterance and doesn't ask again", async () => {
  const { answers, state } = await run(["I want a medium-sized, active dog that doesn't need much grooming"]);

  assert.match(answers[0], /^Okay, medium size, very active and low grooming\. Here are three of the 4 matching breeds\./);
  assert.doesNotMatch(answers[0], /\?.*\?/); // only the final "which one" question
  assert.deepEqual(state.searchResults.map(b => b.name), ["Siberian Husky", "Border Collie", "Beagle"]);
});

test("negative size preferences are confirmed back to the user", async () => {
  const { answers } = await run(["Nothing huge"]);

  assert.equal(answers[0], "Okay, small or medium size. That leaves 17 breeds. How active would you like the dog to be?");
});

test("'I don't mind' fills the slot instead of causing a misunderstanding", async () => {
  const { answers, state } = await run(["I want a small dog", "Pretty active, I run a lot", "I don't mind"]);

  assert.equal(state.preferences.grooming, "any");
  assert.match(answers[2], /^Okay, any amount of grooming\. Here are three of the 4 matching breeds/);
  assert.equal(state.failedAttempts, 0);
});

test("NLU maps 'I don't mind' to the slot that was just asked about (without the LLM)", async () => {
  assert.deepEqual(await understandUser("I don't mind", "grooming"), { intent: "set_preferences", grooming: "any", preferenceOperation: "replace" });
  assert.deepEqual(await understandUser("Doesn't matter.", "activity"), { intent: "set_preferences", activity: "any", preferenceOperation: "replace" });
  assert.deepEqual(await understandUser("Whatever", "size"), { intent: "set_preferences", sizes: ["small", "medium", "large"], preferenceOperation: "replace" });
});

test("resolves 'the second one' and keeps 'it' across follow-up questions", async () => {
  const { answers, state } = await run([
    "I want a small dog", "Pretty active, I run a lot", "Not much",
    "Tell me more about the second one",
    "How big does it get?",
  ]);

  assert.match(answers[3], /^Jack Russell Terrier: /);
  assert.match(answers[4], /^Jack Russell Terrier typically weighs/);
  assert.equal(state.currentBreed?.name, "Jack Russell Terrier");
});

test("selecting a result that doesn't exist", async () => {
  const { answers } = await run(["I want a small dog", "Pretty active, I run a lot", "Not much", "Tell me about the fifth one"]);

  assert.match(answers[3], /isn't available/);
});

test("changing a preference keeps the other preferences and searches again", async () => {
  const { answers, state } = await run([
    "I want a medium-sized, active dog that doesn't need much grooming",
    "Actually, larger dogs are okay too",
  ]);

  assert.deepEqual(state.preferences.sizes, ["medium", "large"]);
  assert.equal(state.preferences.activity, "high");
  assert.equal(state.preferences.grooming, "low");
  assert.match(answers[1], /^Okay, large dogs too\. Here are three of the 6 matching breeds/);
  assert.deepEqual(state.searchResults.map(b => b.name), ["Labrador Retriever", "Boxer", "Siberian Husky"]);
});

test("asking for alternatives doesn't repeat breeds", async () => {
  const { answers } = await run([
    "I want a medium-sized, active dog that doesn't need much grooming",
    "Anything else?",
    "Anything else?",
  ]);

  assert.match(answers[1], /^Here is one more breed you might want to explore\. First, Whippet/);
  assert.match(answers[2], /don't have any more breeds/);
});

test("repair: re-asks the question, then offers example answers", async () => {
  const { answers, state } = await run(["I want a small dog", "bla bla", "bla bla", "Pretty active, I run a lot"]);

  assert.equal(answers[1], "Sorry, I didn't understand. How active would you like the dog to be?");
  assert.equal(answers[2], "Sorry, I still didn't understand. How active would you like the dog to be? You can say very active, moderately active, not very active, or that you don't mind.");
  assert.match(answers[3], /^Okay, very active\./);
  assert.equal(state.failedAttempts, 0);
});

test("repair while exploring results", async () => {
  const { answers } = await run(["I want a medium-sized, active dog that doesn't need much grooming", "bla bla", "bla bla"]);

  assert.match(answers[1], /^Sorry, I didn't understand\. You can select a breed/);
  assert.match(answers[2], /^Sorry, I still didn't get that\. You can say for example/);
});

test("care questions use RAG when available and estimates otherwise", async () => {
  const { answers } = await run([
    "Tell me about Whippets, do they need much grooming?",
    "I want a medium-sized, active dog that doesn't need much grooming",
    "Tell me more about the second one",
    "Does it need much grooming?",
  ]);

  assert.equal(answers[0], "Whippets have short coats and need very little grooming.");
  // Border Collie is not in the fake knowledge base and its description doesn't describe the coat
  assert.equal(answers[3], "I don't have grooming information for Border Collie.");
});

test("activity and grooming estimates for well-known breeds", () => {
  assert.equal(estimateActivity(breed("Border Collie")), "high");
  assert.equal(estimateActivity(breed("Bulldog")), "low");
  assert.equal(estimateGrooming(breed("Maltese")), "high");
  assert.equal(estimateGrooming(breed("Boxer")), "low");
  // "long ears" must not count as a long coat
  assert.equal(estimateGrooming(breed("Basset Hound")), undefined);
});

test("breeds that are the opposite of the preference are left out", () => {
  const matches = findMatchingBreeds(breeds, { sizes: ["small"], activity: "high", grooming: "low", temperaments: [] });

  assert.ok(!matches.some(b => b.name === "Maltese")); // low activity, high grooming
  assert.ok(!matches.some(b => b.name === "Pug")); // low activity
});

test("care questions still get an answer when the RAG service fails", async () => {
  const services = { ...createServices(), answerWithRAG: async () => { throw new Error("Qdrant is not running"); } };
  const state = createInitialState();

  await processDialogue("I want a medium-sized, active dog that doesn't need much grooming", state, services);
  await processDialogue("Tell me about the first one", state, services);

  assert.equal(await processDialogue("Does it need much grooming?", state, services), "Siberian Husky has a thick, double coat, so I'd expect moderate grooming needs.");
});

// Mixed initiative: the user decides how many questions to answer

test("the user can ask for results before answering all questions", async () => {
  const { answers, state } = await run(["I want a small dog", "Just show me some dogs"]);

  assert.match(answers[1], /^Here are three of the 9 matching breeds\. First, /);
  assert.equal(state.phase, "exploring_results");
  assert.equal(state.preferences.activity, undefined);
});

test("results can be requested before giving any preference", async () => {
  const { answers } = await run(["Just show me some dogs"]);

  assert.match(answers[0], /^Here are three of the 23 breeds I know\./);
  // well-known breeds come before rare ones like the Affenpinscher
  assert.match(answers[0], /First, Basset Hound/);
});

test("results can be requested together with a preference", async () => {
  const { answers, state } = await run(["Just show me large dogs"]);

  assert.match(answers[0], /^Okay, large size\. Here are three of the 6 matching breeds\./);
  assert.ok(state.searchResults.every(b => ["Bernese Mountain Dog", "Boxer", "Golden Retriever", "Great Dane", "Greyhound", "Labrador Retriever"].includes(b.name)));
});

test("the system stops asking when few breeds are left", async () => {
  const { answers, state } = await run(["I want a large, very calm dog"]);

  // only three large, calm breeds in the fixture, so asking about grooming wouldn't help
  assert.match(answers[0], /^Okay, large size and not very active\. I found three breeds/);
  assert.equal(state.preferences.grooming, undefined);
});

test("asking for more breeds before any search starts a search instead of failing", async () => {
  const { answers } = await run(["Tell me about Whippets, do they need much grooming?", "Anything else?"]);

  assert.match(answers[1], /^Here are three of the 23 breeds I know\./);
});

test("the NLU gets the current preferences, so relative changes can be understood", async () => {
  const state = createInitialState();
  let receivedPreferences: unknown;

  const services = { ...createServices(), understand: async (utterance: string, _lastQuestion?: string, preferences?: unknown) => {
    receivedPreferences = structuredClone(preferences);
    return nluResults[utterance] ?? { intent: "unknown" as const };
  } };

  await processDialogue("Just show me large dogs", state, services);
  const answer = await processDialogue("Something smaller", state, services);

  assert.deepEqual(receivedPreferences, { sizes: ["large"], temperaments: [] });
  assert.deepEqual(state.preferences.sizes, ["medium"]);
  // the user had already seen results, so the system shows new ones instead of asking questions again
  assert.match(answer, /^Okay, medium size\. Here are three of the 8 matching breeds\./);
});

test("start over resets the information state", async () => {
  const { answers, state } = await run(["I want a medium-sized, active dog that doesn't need much grooming", "Start over"]);

  assert.equal(answers[1], "Okay, let's start over. What kind of dog are you looking for?");
  assert.deepEqual(state, createInitialState());
});

test("help depends on the phase and repeats the pending question", async () => {
  const { answers } = await run(["I want a small dog", "What can I say?", "Just show me some dogs", "What can I say?"]);

  assert.match(answers[1], /show me some dogs to see breeds right away.* How active would you like the dog to be\?$/);
  assert.match(answers[3], /^You can ask about one of the breeds/);
});

test("'skip' counts as no preference (without the LLM)", async () => {
  assert.deepEqual(await understandUser("Skip", "activity"), { intent: "set_preferences", activity: "any", preferenceOperation: "replace" });
});

// LLM fallback for utterances the dialogue manager has no action for

test("small talk gets a reply instead of 'Sorry, I didn't understand'", async () => {
  const { answers } = await run(["Hello!"]);

  assert.equal(answers[0], "Hi there!");
});

test("after a fallback reply the system repeats its pending question", async () => {
  const { answers, state } = await run(["I want a small dog", "Hello!"]);

  assert.equal(answers[1], "Hi there! How active would you like the dog to be?");
  assert.equal(state.lastQuestion, "activity");
});

test("questions comparing the shown breeds are answered with the results as context", async () => {
  const { answers } = await run(["I want a medium-sized, active dog that doesn't need much grooming", "Which of these is best with kids?"]);

  assert.equal(answers[1], "Of Siberian Husky, Border Collie, Beagle, the first is known to be good with kids.");
});

test("when the LLM fallback fails, the normal repair is used", async () => {
  const services = { ...createServices(), respondFreely: async () => { throw new Error("Ollama is not running"); } };
  const state = createInitialState();

  await processDialogue("I want a small dog", state, services);

  assert.equal(await processDialogue("Hello!", state, services), "Sorry, I didn't understand. How active would you like the dog to be?");
});

// Information state update: which moves and rules are involved in a turn

// runs the dialogue up to the last utterance and returns the result of the last turn
async function lastTurn(utterances: string[]) {
  const state = createInitialState();
  const services = createServices();

  for (const utterance of utterances.slice(0, -1)) {
    await processDialogue(utterance, state, services);
  }

  return runTurn(utterances[utterances.length - 1], state, services);
}

test("ISU: an answer is integrated, the database consulted and the next question selected", async () => {
  const turn = await lastTurn(["I want a small dog"]);

  assert.deepEqual(turn.userMoves.map(m => m.type), ["answer"]);
  assert.deepEqual(turn.rulesFired, ["integrate_answer", "exec_search", "select_ask"]);
  assert.deepEqual(turn.systemMoves.map(m => m.type), ["feedback", "ask"]);
});

test("ISU: a correction revises the preferences and selects new results", async () => {
  const turn = await lastTurn(["I want a medium-sized, active dog that doesn't need much grooming", "Actually, larger dogs are okay too"]);

  assert.deepEqual(turn.rulesFired, ["integrate_correction", "integrate_answer", "exec_search", "select_present_results"]);
  assert.deepEqual(turn.systemMoves.map(m => m.type), ["feedback", "present"]);
});

test("ISU: a reference to a result is resolved and the database consulted", async () => {
  const turn = await lastTurn(["I want a medium-sized, active dog that doesn't need much grooming", "Tell me more about the second one"]);

  assert.deepEqual(turn.userMoves, [{ type: "select", index: 2, questionType: "description" }]);
  assert.deepEqual(turn.rulesFired, ["integrate_select", "exec_answer_breed_question"]);
  assert.deepEqual(turn.systemMoves.map(m => m.type), ["breed_info"]);
});

test("ISU: non-understanding leads to negative feedback and the question is raised again", async () => {
  const turn = await lastTurn(["I want a small dog", "bla bla"]);

  assert.deepEqual(turn.userMoves, []);
  assert.deepEqual(turn.rulesFired, ["integrate_no_understanding", "exec_respond_freely", "select_reraise_question"]);
  assert.deepEqual(turn.systemMoves, [{ type: "icm:neg", repeated: false }, { type: "ask", slot: "activity", withHint: false }]);
});

test("ISU: a request for results with a preference skips the remaining questions", async () => {
  const turn = await lastTurn(["Just show me large dogs"]);

  assert.deepEqual(turn.userMoves.map(m => m.type), ["answer", "request_results"]);
  assert.deepEqual(turn.rulesFired, ["integrate_answer", "integrate_request_results", "exec_search", "select_present_results"]);
});

test("adding sizes only confirms the new ones", async () => {
  const services = { ...createServices(), understand: async (utterance: string) =>
    utterance === "Medium to large dogs are okay too"
      ? { intent: "set_preferences" as const, sizes: ["medium" as const, "large" as const], preferenceOperation: "add" as const }
      : nluResults[utterance] ?? { intent: "unknown" as const } };
  const state = createInitialState();

  await processDialogue("I want a medium-sized, active dog that doesn't need much grooming", state, services);

  assert.match(await processDialogue("Medium to large dogs are okay too", state, services), /^Okay, large dogs too\./);
});

test("'anything else' is understood as a request for more breeds (without the LLM)", async () => {
  assert.deepEqual(await understandUser("Anything else?"), { intent: "more_options" });
  assert.deepEqual(await understandUser("Show me more"), { intent: "more_options" });
});
