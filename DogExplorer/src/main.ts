import dotenv from "dotenv"; // for getting the apikey
import { searchBreed } from "./dogApi";
import { createInitialState, updatePreferences } from "./dialogueState";
import { stat } from "node:fs";
import { understandUser } from "./nlu";

// // .env is outside the folder
// dotenv.config({path:"../.env"});
// const apiKey = process.env.DOG_API_KEY;
// if(!apiKey){ // if it was empty we throw an error
//     throw new Error("DOG_API_KEY is missing from .env");
// }
// // I use whippet breed as an example to test
// const breeds = await searchBreed("whippet", apiKey);

// if (breeds.length === 0) { // if it was no breed found
//     console.log("No breed found.");
// } else {
//     const breed = breeds[0]; // first breed
//     console.log("Breed:", breed.name);
//     console.log("Temperament:", breed.temperament);
//     console.log("Weight:", breed.weight.metric, "kg");
//     console.log("Height:", breed.height.metric, "cm");
//     console.log("Life span:", breed.life_span, "years");
//     console.log("Description:", breed.description);
// }


const state = createInitialState();
console.log("Initial State:");
console.log(state.preferences);

const utterance = "I want a medium-sized dog that is pretty active but doesn't need much grooming.";

console.log("\nUser:");
console.log(utterance);

const nlu = await understandUser(utterance);

console.log("\NLU results:");
console.log(nlu);

updatePreferences(state, nlu);

console.log("\Updated state:");
console.log(state.preferences);


const secondUtterance = "I would also like something friendly and calm.";

console.log("\nUser:");
console.log(secondUtterance);

const secondNLU = await understandUser(secondUtterance);

console.log("\nNLU result:");
console.log(secondNLU);

updatePreferences(state, secondNLU);

console.log("\nUpdated state:");
console.log(state.preferences);