// Information state update rules
// each rule checks a precondition on the information state and the current turn, and if it holds returns the effect that updates them.

// three types of rules
// Integrate: integrate the user's moves into the information state
// Execute: consult the database (TheDogAPI, RAG) and the LLM
// Select: select the system's next moves

import { createInitialState, updatePreferences, type DialogueState, type DogPreferences } from "./dialogueState";
import { decideNextAction } from "./dialogueManager";
import { findMatchingBreeds } from "./breedMatcher";
import type { NLUResult } from "./nlu";
import type { FallbackContext, FallbackResult } from "./fallback";
import type { QuestionType, SystemMove, UserMove } from "./moves";
import type { Breed } from "./types";

// external services available to the dialogue engine
export type DialogueServices = {
  understand: (utterance: string, lastQuestion?: string, preferences?: DogPreferences) => Promise<NLUResult>;
  getAllBreeds: () => Promise<Breed[]>;
  searchBreed: (breedName: string) => Promise<Breed[]>;
  answerWithRAG: (breedName: string, question: string) => Promise<string | null>;
  respondFreely: (utterance: string, context: FallbackContext) => Promise<FallbackResult>;
};

// things the system has to do in this turn (cleared every turn)
export type AgendaAction = // so the tasks waiting to be executed
  | { type: "search"; showResults: boolean } // search, then ask or present (showResults: present even if questions are left)
  | { type: "next_page" }// present the next breeds of the same search
  | { type: "answer_breed_question"; breed: Breed; questionType: QuestionType }
  | { type: "respond_freely" };  // let the LLM reply

// everything a turn works on: the information state plus the interface variables
export type Turn = {
  utterance: string;
  is: DialogueState;
  // user moves not integrated yet 
  latestMoves: UserMove[];
  agenda: AgendaAction[];
  nextMoves: SystemMove[];
  // failed turns before this one, for repair
  previousFailures: number;
  // result of consulting the database
  matches?: Breed[];
  services: DialogueServices;
};

export type Rule = {
  name: string;
  apply: (turn: Turn) => (() => void | Promise<void>) | undefined;// returns the effect if the precondition holds otherwise undefined
};

// how many breeds are presented at a time
export const RESULTS_PER_PAGE = 3;



// ---------- helpers 

// find a user move
function findMove<T extends UserMove["type"]>(turn: Turn, type: T): Extract<UserMove, { type: T }> | undefined {
  return turn.latestMoves.find(move => move.type === type) as Extract<UserMove, { type: T }> | undefined;
} // searches latestMoves for the first move of the requested type

// removes a move once it has been integrated
function consume(turn: Turn, move: UserMove) {
  turn.latestMoves = turn.latestMoves.filter(m => m !== move);
}

function findAgenda<T extends AgendaAction["type"]>(turn: Turn, type: T): Extract<AgendaAction, { type: T }> | undefined {
  return turn.agenda.find(action => action.type === type) as Extract<AgendaAction, { type: T }> | undefined;
}

function removeAgenda(turn: Turn, action: AgendaAction) {
  turn.agenda = turn.agenda.filter(a => a !== action);
}

// adds a search to the agenda, or makes the existing one present results
function addSearch(turn: Turn, showResults: boolean) {
  const search = findAgenda(turn, "search");

  if (search) {
    search.showResults = search.showResults || showResults;
  } else {
    turn.agenda.push({ type: "search", showResults });
  }
}

// searching for a breed by name, including simple plural names
async function findBreedByName(breedName: string, services: DialogueServices): Promise<Breed | undefined> {
  let results = await services.searchBreed(breedName);

  if (results.length === 0 && breedName.toLowerCase().endsWith("s")) {
    results = await services.searchBreed(breedName.slice(0, -1)); // we try removing the s
  }

  return results[0];
}

// these questions are answered with RAG if the knowledge base has something
function needsRAG(questionType: QuestionType): boolean {
  return ["grooming", "exercise", "apartment", "training", "health", "other"].includes(questionType);
}

// the question the system is waiting for an answer to, if any
export function pendingQuestion(is: DialogueState): string | undefined {
  if (is.phase !== "collecting_preferences" || !is.lastQuestion) {
    return undefined;
  }

  const action = decideNextAction(is);
  return action.type === "ask" ? action.question : undefined;
}

export function hasAnyPreference(preferences: DogPreferences): boolean {
  return preferences.sizes.length > 0 || preferences.activity !== undefined || preferences.grooming !== undefined || preferences.temperaments.length > 0;
}



// ---------- Integrate rules
export const integrateRules: Rule[] = [

  // "start over": back to the initial information state, other moves are dropped
  {
    name: "integrate_restart",
    apply: (turn) => {
      if (!findMove(turn, "restart")) return;

      return () => {
        Object.assign(turn.is, createInitialState());
        turn.latestMoves = [];
        turn.agenda = [];
        turn.nextMoves = [{ type: "restarted" }];
      };
    },
  },

  {
    name: "integrate_help",
    apply: (turn) => {
      const move = findMove(turn, "help");
      if (!move) return;

      return () => {
        consume(turn, move);
        turn.nextMoves.push({ type: "help" });
      };
    },
  },

  // "the second one": resolving the reference to one of the shown results
  {
    name: "integrate_select",
    apply: (turn) => {
      const move = findMove(turn, "select");
      if (!move || turn.is.phase !== "exploring_results") return;

      return () => {
        consume(turn, move);
        const selected = turn.is.searchResults[move.index - 1];

        if (!selected) {
          turn.nextMoves.push({ type: "option_unavailable" });
          return;
        }

        turn.is.currentBreed = selected;
        turn.agenda.push({ type: "answer_breed_question", breed: selected, questionType: move.questionType });
      };
    },
  },

  // a question about a breed: a named one, or "it" = the breed being discussed
  {
    name: "integrate_breed_question",
    apply: (turn) => {
      const move = findMove(turn, "ask");
      if (!move) return;

      return async () => {
        consume(turn, move);
        const is = turn.is;

        if (move.breedName) {
          const breed = await findBreedByName(move.breedName, turn.services);

          if (!breed) {
            turn.nextMoves.push({ type: "breed_not_found", breedName: move.breedName });
            return;
          }

          is.currentBreed = breed;
          is.phase = "exploring_results";
          is.lastQuestion = undefined;
          turn.agenda.push({ type: "answer_breed_question", breed, questionType: move.questionType });
          return;
        }

        if (is.currentBreed) {
          turn.agenda.push({ type: "answer_breed_question", breed: is.currentBreed, questionType: move.questionType });
          return;
        }

        // no breed to talk about and no results to choose from
        if (is.phase === "exploring_results" && is.searchResults.length === 0) {
          turn.nextMoves.push({ type: "which_breed" });
          return;
        }

        // e.g. "which of these is best with kids?" is about all shown breeds
        turn.agenda.push({ type: "respond_freely" });
      };
    },
  },

  // new preferences after results were shown: revising the earlier commitments
  // (this rule doesn't consume the answer, integrate_answer does that next)
  {
    name: "integrate_correction",
    apply: (turn) => {
      if (!findMove(turn, "answer") || turn.is.phase !== "exploring_results") return;

      return () => {
        turn.is.phase = "collecting_preferences";
        turn.is.currentBreed = undefined;
        turn.is.lastQuestion = undefined;
        // for new preferences we remove old recommendation history
        turn.is.shownBreedIds = [];
        // the user has already seen results, so we show new ones instead of asking questions again
        addSearch(turn, true);
      };
    },
  },

  // preferences: update the information state and give grounding feedback
  {
    name: "integrate_answer",
    apply: (turn) => {
      const move = findMove(turn, "answer");
      if (!move) return;

      return () => {
        consume(turn, move);

        // for "large dogs are okay too", the feedback only mentions the sizes that are new
        const feedback = move.content.preferenceOperation === "add" && move.content.sizes
          ? { ...move.content, sizes: move.content.sizes.filter(size => !turn.is.preferences.sizes.includes(size)) }
          : move.content;

        updatePreferences(turn.is, move.content);
        turn.nextMoves.push({ type: "feedback", content: feedback });
        addSearch(turn, false);
      };
    },
  },

  // "show me some dogs" / "anything else?"
  {
    name: "integrate_request_results",
    apply: (turn) => {
      const move = findMove(turn, "request_results");
      if (!move) return;

      return () => {
        consume(turn, move);
        const is = turn.is;

        // more of the same results
        if (is.phase === "exploring_results" && is.searchResults.length > 0 && !findAgenda(turn, "search")) {
          turn.agenda.push({ type: "next_page" });
          return;
        }

        // no search has been done yet, e.g. the user only asked about a breed by name
        if (is.phase === "exploring_results") {
          is.phase = "collecting_preferences";
          is.currentBreed = undefined;
        }

        addSearch(turn, true);
      };
    },
  },

  {
    name: "integrate_general",
    apply: (turn) => {
      const move = findMove(turn, "general");
      if (!move) return;

      return () => {
        consume(turn, move);
        turn.agenda.push({ type: "respond_freely" });
      };
    },
  },

  // nothing could be integrated: before saying we didn't understand, the LLM tries to reply
  {
    name: "integrate_no_understanding",
    apply: (turn) => {
      if (turn.nextMoves.length > 0 || turn.agenda.length > 0) return;

      return () => {
        turn.latestMoves = [];
        turn.agenda.push({ type: "respond_freely" });
      };
    },
  },
];



// ---------- Execute rules
export const execRules: Rule[] = [

  // consulting the database: TheDogAPI breeds that match the preferences, best first
  {
    name: "exec_search",
    apply: (turn) => {
      if (turn.matches || (!findAgenda(turn, "search") && !findAgenda(turn, "next_page"))) return;

      return async () => {
        const breeds = await turn.services.getAllBreeds();
        turn.matches = findMatchingBreeds(breeds, turn.is.preferences);
        console.log("Matching breeds:", turn.matches.length);
      };
    },
  },

  // RAG for care questions if the knowledge base has an answer, otherwise TheDogAPI (in the NLG)
  {
    name: "exec_answer_breed_question",
    apply: (turn) => {
      const action = findAgenda(turn, "answer_breed_question");
      if (!action) return;

      return async () => {
        removeAgenda(turn, action);
        let ragAnswer: string | undefined;

        if (needsRAG(action.questionType)) {
          try {
            ragAnswer = await turn.services.answerWithRAG(action.breed.name, turn.utterance) ?? undefined;
          } catch (error) {
            // e.g. Qdrant is not running, we can still answer from TheDogAPI
            console.error("RAG failed:", error);
          }
        }

        turn.nextMoves.push({ type: "breed_info", breed: action.breed, questionType: action.questionType, ragAnswer });
      };
    },
  },

  // the LLM replies to what the dialogue manager has no action for.
  // If the LLM doesn't understand either (or isn't running), we give negative feedback (repair)
  {
    name: "exec_respond_freely",
    apply: (turn) => {
      const action = findAgenda(turn, "respond_freely");
      if (!action) return;

      return async () => {
        removeAgenda(turn, action);
        const is = turn.is;

        try {
          const result = await turn.services.respondFreely(turn.utterance, {
            preferences: is.preferences,
            results: is.searchResults,
            currentBreed: is.currentBreed,
            pendingQuestion: pendingQuestion(is),
          });

          if (result.understood && result.reply) {
            turn.nextMoves.push({ type: "llm_reply", text: result.reply });
            return;
          }
        } catch (error) {
          console.error("Fallback failed:", error);
        }

        is.failedAttempts = turn.previousFailures + 1;
        turn.nextMoves.push({ type: "icm:neg", repeated: is.failedAttempts >= 2 });
      };
    },
  },
];

// ---------- Select ----------

export const selectRules: Rule[] = [

  // "anything else?": the next breeds that haven't been shown yet
  {
    name: "select_next_page",
    apply: (turn) => {
      const action = findAgenda(turn, "next_page");
      if (!action || !turn.matches) return;

      return () => {
        removeAgenda(turn, action);
        const is = turn.is;
        const nextResults = turn.matches!
          .filter(breed => !is.shownBreedIds.includes(String(breed.id)))
          .slice(0, RESULTS_PER_PAGE);

        if (nextResults.length === 0) {
          turn.nextMoves.push({ type: "no_more_results" });
          return;
        }

        is.searchResults = nextResults;
        is.shownBreedIds.push(...nextResults.map(breed => String(breed.id)));
        is.currentBreed = undefined;

        turn.nextMoves.push({ type: "present", breeds: nextResults, total: turn.matches!.length, page: "more", hasPreferences: hasAnyPreference(is.preferences) });
      };
    },
  },

  // asking the next missing question, but only while it helps:
  // more breeds match than we can show and the user hasn't asked to see results
  {
    name: "select_ask",
    apply: (turn) => {
      const search = findAgenda(turn, "search");
      if (!search || search.showResults || !turn.matches || turn.matches.length <= RESULTS_PER_PAGE) return;

      const action = decideNextAction(turn.is);
      if (action.type !== "ask") return;

      return () => {
        removeAgenda(turn, search);
        turn.is.lastQuestion = action.slot;
        turn.nextMoves.push({ type: "ask", slot: action.slot, remaining: turn.matches!.length });
      };
    },
  },

  // presenting the first results of the search
  {
    name: "select_present_results",
    apply: (turn) => {
      const search = findAgenda(turn, "search");
      if (!search || !turn.matches) return;

      return () => {
        removeAgenda(turn, search);
        const is = turn.is;
        const nextResults = turn.matches!.slice(0, RESULTS_PER_PAGE);

        if (nextResults.length === 0) {
          is.searchResults = [];
          is.currentBreed = undefined;
          turn.nextMoves.push({ type: "no_results" });
          return;
        }

        is.searchResults = nextResults;
        is.shownBreedIds.push(
          ...nextResults
            .map(breed => String(breed.id))
            .filter(id => !is.shownBreedIds.includes(id))
        );
        is.phase = "exploring_results";
        is.currentBreed = undefined;
        is.lastQuestion = undefined;

        turn.nextMoves.push({ type: "present", breeds: nextResults, total: turn.matches!.length, page: "first", hasPreferences: hasAnyPreference(is.preferences) });
      };
    },
  },

  // after an LLM reply, help or negative feedback, the system asks its pending question again
  {
    name: "select_reraise_question",
    apply: (turn) => {
      const interrupted = turn.nextMoves.find(move => move.type === "llm_reply" || move.type === "icm:neg" || move.type === "help");
      if (!interrupted || turn.nextMoves.some(move => move.type === "ask")) return;

      const question = pendingQuestion(turn.is);
      const action = decideNextAction(turn.is);
      if (!question || action.type !== "ask") return;

      return () => {
        // after repeated misunderstandings, the question comes with example answers
        const withHint = interrupted.type === "icm:neg" && interrupted.repeated;
        turn.nextMoves.push({ type: "ask", slot: action.slot, withHint });
      };
    },
  },
];
