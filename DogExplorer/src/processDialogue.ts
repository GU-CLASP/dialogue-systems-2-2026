// The dialogue move engine
// one user turn goes through  NLU -> user moves -> Integrate -> Execute -> Select -> NLG
// update rules are in rules.ts

import { answerWithRAG } from "./rag";
import { understandUser } from "./nlu";
import { createInitialState, type DialogueState } from "./dialogueState";
import { getAllBreeds, searchBreed } from "./dogApi";
import { respondFreely } from "./fallback";
import { interpretMoves, type SystemMove, type UserMove } from "./moves";
import { integrateRules, execRules, selectRules, type DialogueServices, type Rule, type Turn } from "./rules";
import { generate } from "./nlg";
import { DOG_API_KEY } from "./credentials";
export { createInitialState };
export type { DialogueServices };


function getApiKey(): string {
  const apiKey = DOG_API_KEY;
  if (!apiKey) {
    throw new Error("DOG_API_KEY is missing");
  }
  return apiKey;
}

const defaultServices: DialogueServices = { // toolbox
  understand: understandUser, // to understand messages
  getAllBreeds: () => getAllBreeds(getApiKey()), // to get all the breeds
  searchBreed: (breedName) => searchBreed(breedName, getApiKey()), // to search a specefic breed
  answerWithRAG,
  respondFreely,
};


async function applyRules(turn: Turn, rules: Rule[], rulesFired: string[]): Promise<void> { // for decision-making
  for (let step = 0; step < 50; step++) { // limit of 50 so we don't go into infinite loop
    let applied = false;

    for (const rule of rules) { // for each rule
      const effect = rule.apply(turn);

      if (effect) {
        await effect(); // execute its effect
        console.log(`[ISU ${rule.name}]`);
        rulesFired.push(rule.name);
        applied = true;
        break;
      }
    }

    if (!applied) return; // we stop when no rule applies
  }

  throw new Error("Update rules didn't stop applying");
}

export type TurnResult = {
  output: string;
  userMoves: UserMove[];
  systemMoves: SystemMove[];
  rulesFired: string[];
};

export async function runTurn(utterance: string, state: DialogueState, services: DialogueServices = defaultServices): Promise<TurnResult> {

  const nlu = await services.understand(utterance, state.lastQuestion, state.preferences); // first understand the user
  const userMoves = interpretMoves(nlu); // converting the understanding into structured user moves

  console.log("NLU:", nlu);
  console.log("User moves:", userMoves);

  // turn object
  const turn: Turn = {
    utterance,
    is: state,
    latestMoves: [...userMoves],
    agenda: [], // tasks and actions to process
    nextMoves: [], // which system selected
    previousFailures: state.failedAttempts, // num of earlier failed attempts
    services,
  };

  state.failedAttempts = 0; // reset for this turn

  const rulesFired: string[] = [];

  // applying the three rule groups
  await applyRules(turn, integrateRules, rulesFired); // to update is based on what user said
  await applyRules(turn, execRules, rulesFired); // perform required operations like searching the dogapi
  await applyRules(turn, selectRules, rulesFired); // choosing the system moves for the next response

  console.log("System moves:", turn.nextMoves.map(move => move.type));
  console.log("Information state:", { phase: state.phase, preferences: state.preferences, currentBreed: state.currentBreed?.name, lastQuestion: state.lastQuestion });

  return {
    output: generate(turn.nextMoves, state), // generate would convert selected system moves into human-readable answer
    userMoves,
    systemMoves: turn.nextMoves,
    rulesFired,
  };
}

// to process one user utterance and returns the system's answer for SpeechState
export async function processDialogue(utterance: string, state: DialogueState, services: DialogueServices = defaultServices): Promise<string> {
  return (await runTurn(utterance, state, services)).output;
}
