// the NLU result is turned into user moves, the update rules integrate them into the information state and select system moves, and the NLG turns the system moves into text.

import type { NLUResult } from "./nlu";
import type { QuestionSlot } from "./dialogueState";
import type { Breed } from "./types";

// the preference part of the NLU result  { sizes: ["small"], grooming: "low" }
export type PreferenceContent = Pick<NLUResult, "sizes" | "activity" | "grooming" | "temperaments" | "preferenceOperation">;

export type QuestionType = NonNullable<NLUResult["questionType"]>; // NonNullable removes null and undefined from a type

// what the user does with an utterance
export type UserMove =
  | { type: "answer"; content: PreferenceContent } // giving or changing preferences
  | { type: "request_results" } // "show me some dogs", "anything else?"
  | { type: "select"; index: number; questionType: QuestionType } // "tell me about the second one"
  | { type: "ask"; breedName?: string; questionType: QuestionType } // "how big does it get?"
  | { type: "general" } // small talk, general dog questions
  | { type: "restart" }
  | { type: "help" };

// what the system does in its reply
export type SystemMove =
  | { type: "feedback"; content: PreferenceContent } // grounding: "Okay, small size."
  | { type: "ask"; slot: QuestionSlot; remaining?: number; withHint?: boolean } // ask the next preference question
  | { type: "present"; breeds: Breed[]; total: number; page: "first" | "more"; hasPreferences: boolean }// present recommended breeds
  | { type: "no_results" } // no breeds match the preferences
  | { type: "no_more_results" } // no additional recommendation
  | { type: "breed_info"; breed: Breed; questionType: QuestionType; ragAnswer?: string } // give info about a breed
  | { type: "breed_not_found"; breedName: string }
  | { type: "which_breed" } //which breed the user means
  | { type: "option_unavailable" } // selected result is unavailable
  | { type: "llm_reply"; text: string }
  | { type: "icm:neg"; repeated: boolean } // negative understanding feedback as in Lab 2 like "sorry I did not understand"
  | { type: "help" }
  | { type: "restarted" };


function hasPreferences(nlu: NLUResult): boolean { // to check if NLU extracted preferences
  return (Array.isArray(nlu.sizes) && nlu.sizes.length > 0) || nlu.activity !== undefined || nlu.grooming !== undefined || (Array.isArray(nlu.temperaments) && nlu.temperaments.length > 0);
}

// NLU result -> user moves. An empty list means nothing was understood.
export function interpretMoves(nlu: NLUResult): UserMove[] {
  const moves: UserMove[] = [];//to store moves
  const questionType = nlu.questionType ?? "description";

  switch (nlu.intent) {
    case "select_result":
      return [{ 
        type: "select", 
        index: nlu.resultIndex ?? 0, 
        questionType 
      }];

    case "ask_about_breed":
      return [{ 
        type: "ask", 
        breedName: nlu.breedName, 
        questionType 
      }];

    case "restart":
      return [{ type: "restart" }];

    case "help":
      return [{ type: "help" }];
  }

  // preferences can come together with other intents like "just show me small dogs"
  if (hasPreferences(nlu)) {
    moves.push({
      type: "answer",
      content: {
        sizes: nlu.sizes,
        activity: nlu.activity,
        grooming: nlu.grooming,
        temperaments: nlu.temperaments,
        preferenceOperation: nlu.preferenceOperation,
      },
    });
  }

  if (nlu.intent === "show_results" || nlu.intent === "more_options") {
    moves.push({ type: "request_results" });
  }

  // general questions with preferences are handled as preferences
  if (nlu.intent === "general_question" && moves.length === 0) {
    moves.push({ type: "general" });
  }

  return moves;
}
