// Natural language generation: system moves -> text

import type { DialogueState } from "./dialogueState";
import { QUESTIONS } from "./dialogueManager";
import { answerBreedQuestion, summarizeBreed } from "./breedAnswers";
import type { PreferenceContent, SystemMove } from "./moves";
import type { Breed } from "./types";

// to combine an array of strings into one
function joinWithAnd(items: string[]): string {
  if (items.length <= 1) 
    return items.join(""); // without and
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`; //"a, b" and "c"
}

const ACTIVITY_FEEDBACK = { 
  low: "not very active", 
  medium: "moderately active", 
  high: "very active", 
  any: "any activity level" 
};

const GROOMING_FEEDBACK = { 
  low: "low grooming", 
  medium: "moderate grooming", 
  high: "high grooming", 
  any: "any amount of grooming" 
};

// grounding: telling the user what the system understood like "Okay, small or medium size and very active."
function describeUnderstoodPreferences(content: PreferenceContent): string {
  const parts: string[] = [];

  if (content.sizes && content.sizes.length > 0) {
    if (content.preferenceOperation === "add") { //adding preferences
      parts.push(`${content.sizes.join(" or ")} dogs too`);
    } else if (content.sizes.length === 3) { //all three sizes
      parts.push("any size");
    } else {
      parts.push(`${content.sizes.join(" or ")} size`); // normal
    }
  }

  if (content.activity) {
    parts.push(ACTIVITY_FEEDBACK[content.activity]);
  }

  if (content.grooming) {
    parts.push(GROOMING_FEEDBACK[content.grooming]);
  }

  if (content.temperaments && content.temperaments.length > 0) {
    parts.push(joinWithAnd(content.temperaments));
  }

  // for example user only repeated sizes that were already chosen
  if (parts.length === 0) {
    return "Okay.";
  }

  return `Okay, ${joinWithAnd(parts)}.`;
}

const COUNT_WORDS = ["zero", "one", "two", "three"];
const ORDINALS = ["First", "Second", "Third"];

// presenting the results with the reason they match -> "First, Boxer, large, very active, low grooming."
function presentResults(breeds: Breed[], total: number, page: "first" | "more", hasPreferences: boolean): string {
  const count = COUNT_WORDS[breeds.length] ?? String(breeds.length);
  const noun = breeds.length === 1 ? "breed" : "breeds";
  const verb = breeds.length === 1 ? "is" : "are";

  // telling the user if there are more breeds than we show
  const introduction = 
    page === "more" ? `Here ${verb} ${count} more ${noun} you might want to explore.` :
    total <= breeds.length ? `I found ${count} ${noun} you might want to explore.` :
    hasPreferences ? `Here ${verb} ${count} of the ${total} matching breeds.` :
    `Here ${verb} ${count} of the ${total} breeds I know.`;

  const list = breeds.map((breed, index) => `${ORDINALS[index]}, ${summarizeBreed(breed)}.`).join(" ");

  return `${introduction} ${list} Which one would you like to hear more about?`;
}

function askQuestion(move: Extract<SystemMove, { type: "ask" }>): string {//asking the next question
  const { question, hint } = QUESTIONS[move.slot];
  const remaining = move.remaining !== undefined ? `That leaves ${move.remaining} breeds. ` : "";

  return `${remaining}${question}${move.withHint ? ` ${hint}` : ""}`;
}

// help depends on where we are in the dialogue
function help(is: DialogueState): string {
  if (is.phase === "exploring_results") {
    return "You can ask about one of the breeds, for example: tell me about the first one, or how big does it get. " +
      "You can also ask for other breeds, change a preference, or say start over.";
  }

  return "You can describe the dog you'd like, for example its size, energy level, grooming needs or personality. " +
    "Say I don't mind to skip a question, show me some dogs to see breeds right away, or ask about a specific breed.";
}

// negative understanding feedback, the wording depends on what comes after it
function notUnderstood(is: DialogueState, repeated: boolean, followedByQuestion: boolean): string {
  if (followedByQuestion) {
    return repeated ? "Sorry, I still didn't understand." : "Sorry, I didn't understand.";
  }

  if (is.phase === "exploring_results") {
    return repeated
      ? "Sorry, I still didn't get that. You can say for example: tell me about the first one, show me other breeds, or larger dogs are okay too."
      : "Sorry, I didn't understand. You can select a breed, ask a question, or change your preferences.";
  }

  return repeated
    ? "Sorry, I still didn't understand. You could say something like: I want a small, calm dog that doesn't need much grooming."
    : "Sorry, I didn't understand. Could you tell me what kind of dog you're looking for?";
}

function generateMove(move: SystemMove, moves: SystemMove[], is: DialogueState): string {
  switch (move.type) {
    case "feedback":
      return describeUnderstoodPreferences(move.content);
    case "ask":
      return askQuestion(move);
    case "present":
      return presentResults(move.breeds, move.total, move.page, move.hasPreferences);
    case "no_results":
      return "I couldn't find any breeds matching those preferences. You could try changing your preferences.";
    case "no_more_results":
      return "I don't have any more breeds matching those preferences. You could try changing your preferences.";
    case "breed_info":
      return move.ragAnswer ?? answerBreedQuestion(move.breed, move.questionType);
    case "breed_not_found":
      return `Sorry, I couldn't find information about ${move.breedName}.`;
    case "which_breed":
      return "Which breed would you like to know about?";
    case "option_unavailable":
      return "Sorry, that option isn't available. Please choose one of the suggested breeds.";
    case "llm_reply":
      return move.text;
    case "icm:neg":
      return notUnderstood(is, move.repeated, moves.some(m => m.type === "ask"));
    case "help":
      return help(is);
    case "restarted":
      return "Okay, let's start over. What kind of dog are you looking for?";
  }
}

export function generate(moves: SystemMove[], is: DialogueState): string {
  return moves.map(move => generateMove(move, moves, is)).join(" ");
}
