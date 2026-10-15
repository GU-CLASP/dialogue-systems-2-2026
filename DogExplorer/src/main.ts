import dotenv from "dotenv"; // for getting the apikey
import { searchBreed, getAllBreeds } from "./dogApi";
import { createInitialState, updatePreferences } from "./dialogueState";
import { stat } from "node:fs";
import { understandUser } from "./nlu";
import { decideNextAction } from "./dialogueManager";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { findMatchingBreeds } from "./breedMatcher";

// api
dotenv.config({ path: "../.env" });
const apiKey = process.env.DOG_API_KEY;
if (!apiKey) {
    throw new Error("DOG_API_KEY is missing");
}


const state = createInitialState();

// terminal interface
const rl = readline.createInterface({ input, output, });

console.log("\nSystem: Hi! I can help you explore dog breeds.");
console.log("System: What kind of dog are you looking for?");

try {
    while (true) {
        const utterance = await rl.question("\nYou: ");

        if (["exit", "quit", "bye"].includes(utterance.trim().toLowerCase())) {
            console.log("\nSystem: Goodbye!");
            break;
        }

        if (!utterance.trim()) {
            console.log("System: Sorry, I didn't hear anything. Could you repeat?");
            continue;
        }

        try {
            const nlu = await understandUser(utterance, state.lastQuestion);

            console.log("\n[NLU]", nlu);

            // updating information state
            updatePreferences(state, nlu);

            console.log("[STATE]", state.preferences);

            // what to do next, ask or search
            const action = decideNextAction(state);

            if (action.type === "ask") {
                state.lastQuestion = action.slot;
                console.log("\nSystem:", action.question);
            }

            else if (action.type === "search") {
                state.lastQuestion = undefined;

                console.log("\nSystem: Let me find some breeds for you...");

                // the breed catalog from the API
                const allBreeds = await getAllBreeds(apiKey);

                // filtering
                const matches = findMatchingBreeds(allBreeds, state.preferences);

                // saving the results
                state.searchResults = matches.slice(0, 3);

                if (state.searchResults.length === 0) {
                    console.log("\nSystem: I couldn't find breeds matching those filters.");
                } else {
                    console.log("\nSystem: Here are some breeds to explore:");
                    state.searchResults.forEach((breed, index) => {
                        console.log(`${index + 1}. ${breed.name}`);
                    });
                }

                break;
            }


        } catch (error) {
            console.error("\nError processing utterance:", error);
            console.log("System: Sorry, something went wrong. Could you try again?");
        }
    }
} finally {
    rl.close();
}