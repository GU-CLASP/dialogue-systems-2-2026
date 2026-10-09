import dotenv from "dotenv"; // for getting the apikey
import { searchBreed } from "./dogApi";

// .env is outside the folder
dotenv.config({path:"../.env"});
const apiKey = process.env.DOG_API_KEY;
if(!apiKey){ // if it was empty we throw an error
    throw new Error("DOG_API_KEY is missing from .env");
}
// I use whippet breed as an example to test
const breeds = await searchBreed("whippet", apiKey);

if (breeds.length === 0) { // if it was no breed found
    console.log("No breed found.");
} else {
    const breed = breeds[0]; // first breed
    console.log("Breed:", breed.name);
    console.log("Temperament:", breed.temperament);
    console.log("Weight:", breed.weight.metric, "kg");
    console.log("Height:", breed.height.metric, "cm");
    console.log("Life span:", breed.life_span, "years");
    console.log("Description:", breed.description);
}