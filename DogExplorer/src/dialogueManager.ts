import type { DialogueState } from "./dialogueState";

export type DialogueAction =
  | {
      type: "ask";
      question: string;
      slot: "size" | "activity" | "grooming";
    }
  | { type: "search"; };

export function decideNextAction(state: DialogueState): DialogueAction {
  // 1. checking if size is missing
  if (state.preferences.sizes.length === 0) {
    return {
      type: "ask",
      slot: "size",
      question: "What size of dog would you prefer?",
    };
  }

  // 2.checking if activity is missing
  if (state.preferences.activity === undefined) {
    return {
      type: "ask",
      slot: "activity",
      question: "How active would you like the dog to be?",
    };
  }

  // 3. if grooming is missing
  if (state.preferences.grooming === undefined) {
    return {
      type: "ask",
      slot: "grooming",
      question: "How much grooming are you comfortable with?",
    };
  }

  // and if all required preferences collected
  return {
    type: "search",
  };
}