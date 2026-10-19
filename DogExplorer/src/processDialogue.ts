import { understandUser } from "./nlu";
import {createInitialState,updatePreferences,type DialogueState} from "./dialogueState";
import { decideNextAction } from "./dialogueManager";

export { createInitialState };

export async function processDialogue(utterance: string, state: DialogueState): Promise<string> {
  const nlu = await understandUser(utterance, state.lastQuestion); // first understanding what the user says
  console.log("NLU:", nlu);

  updatePreferences(state, nlu);

  console.log("Preferences:", state.preferences);

  const action = decideNextAction(state);

  if (action.type === "ask") {
    state.lastQuestion = action.slot;
    return action.question;
  }

  state.lastQuestion = undefined;

  return "Great! I have enough information to search for dog breeds.";
}