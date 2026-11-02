// to create a text-based conversational interface in the terminal, so we can check instead of talking as well
import dotenv from "dotenv"; // external npm package, to read variables from .env
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process"; // to handle the terminal reading and showing and ...
import {createInitialState, processDialogue} from "./processDialogue";

dotenv.config({ path: "../.env" });

const state = createInitialState(); // initial dialogue state

// to create the terminal interface
const rl = readline.createInterface({input, output});

console.log("\nSystem: Hi! I can help you explore dog breeds. Tell me what you're looking for, like size, energy or grooming, ask about a specific breed, or just say: show me some dogs.");

try {
  while (true) {
    const utterance = await rl.question("\nYou: ");

    // exiting the conversation
    if (["exit", "quit", "bye"].includes(utterance.trim().toLowerCase())) {
      console.log("\nSystem: Goodbye!");
      break;
    }

    // if empty input
    if (!utterance.trim()) {
      console.log("System: Sorry, I didn't hear anything. Could you repeat?");
      continue;
    }

    try {
      
      const response = await processDialogue(utterance, state);

      console.log("\nSystem:", response);

      // Debugging information
      console.log("\n[PHASE]", state.phase);
      console.log("[PREFERENCES]", state.preferences);
      console.log("[CURRENT BREED]", state.currentBreed?.name ?? "None");

    } catch (error) {
      console.error("\nError processing utterance:", error);

      console.log("System: Sorry, something went wrong. Could you try again?");
    }
  }
} finally {
  rl.close();
}
