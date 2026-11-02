// to decide which question should be asked next or whether it should start searching for dogs.

import type { DialogueState, QuestionSlot } from "./dialogueState";

export const QUESTIONS: Record<QuestionSlot, { question: string; hint: string }> = {
  size: {
    question: "What size of dog would you prefer?",
    hint: "You can say small, medium, large, or that you don't mind.",
  },
  activity: {
    question: "How active would you like the dog to be?",
    hint: "You can say very active, moderately active, not very active, or that you don't mind.",
  },
  grooming: {
    question: "How much grooming are you comfortable with?",
    // example answers, offered after repeated misunderstandings
    hint: "You can say not much, some, a lot, or that you don't mind.",
  },
};

export type DialogueAction =
  | {
      type: "ask";
      question: string;
      slot: QuestionSlot;
      hint: string;
    }
  | { type: "search"; };

export function decideNextAction(state: DialogueState): DialogueAction {
  // 1. checking if size is missing
  if (state.preferences.sizes.length === 0) {
    return { 
      type: "ask", 
      slot: "size", 
      ...QUESTIONS.size 
    };
  }

  // 2.checking if activity is missing ("any" counts as answered)
  if (state.preferences.activity === undefined) {
    return { 
      type: "ask", 
      slot: "activity", 
      ...QUESTIONS.activity 
    };
  }

  // 3. if grooming is missing
  if (state.preferences.grooming === undefined) {
    return { 
      type: "ask", 
      slot: "grooming", 
      ...QUESTIONS.grooming
     };
  }

  // and if all required preferences collected
  return {
    type: "search",
  };
}
