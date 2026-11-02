// answering questions about a selected dog breed using informatioin from thedogapi
// I dont use api directly here, it receives an existing Breed object containing the information

import type { Breed } from "./types";
import type { NLUResult } from "./nlu";
import type { Level } from "./dialogueState";
import { describeCoat, estimateActivity, estimateGrooming, getBreedSize } from "./breedMatcher";

// objects for converting technical values to natural language
const ACTIVITY_WORDS: Record<Level, string> = {
    low: "fairly calm",
    medium: "moderately active",
    high: "very active",
};
const GROOMING_WORDS: Record<Level, string> = {
    low: "low grooming",
    medium: "moderate grooming",
    high: "high grooming",
};

//to format numerical ranges(just to combine different ranges into one simple range) like "Male: 16-27; Female: 14-23" becomes "14 to 27"
function formatRange(text: string): string {
    const numbers = [...text.matchAll(/\d+(?:\.\d+)?/g)].map(match => Number(match[0])); //extracting all the numbers
    if (numbers.length < 2) return text;
    return `${Math.min(...numbers)} to ${Math.max(...numbers)}`; // minimum and maximum
}

// only the first sentence, so the spoken answer stays short
function firstSentence(text: string): string {
    const match = text.match(/^.*?[.!?](\s|$)/); // sentence ending with a punctuation
    return (match ? match[0] : text).trim(); // if the match was found we return the first sentence otherwise the whole text
}

// short summary used when presenting results like "Boxer, large, very active, low grooming"
export function summarizeBreed(breed: Breed): string {
    const size = getBreedSize(breed);
    const grooming = estimateGrooming(breed);

    const traits = [size, ACTIVITY_WORDS[estimateActivity(breed)], grooming ? GROOMING_WORDS[grooming] : undefined].filter(Boolean);

    return `${breed.name}, ${traits.join(", ")}`;
}

// for handling specific questions
export function answerBreedQuestion(breed: Breed, questionType?: NLUResult["questionType"]): string {

    switch (questionType) {
        
        case "size": {
            const weight = breed.weight?.metric ? formatRange(breed.weight.metric) : undefined;
            const height = breed.height?.metric ? formatRange(breed.height.metric) : undefined;

            if (!weight && !height) {
                return `I don't have size information for ${breed.name}.`;
            }
            if (!weight) {
                return `${breed.name} typically measures ${height} centimeters in height.`;
            }
            if (!height) {
                return `${breed.name} typically weighs ${weight} kilograms.`;
            }
            return (
                `${breed.name} typically weighs ${weight} kilograms ` + `and measures ${height} centimeters in height.`
            );
        }

        case "temperament":
            return breed.temperament ? `${breed.name} is described as ${breed.temperament}.` : `I don't have temperament information for ${breed.name}.`;

        case "lifespan":
            return breed.life_span ? `${breed.name} typically lives around ${breed.life_span} years.` : `I don't have lifespan information for ${breed.name}.`;

        case "description":
            return breed.description  ? `${breed.name}: ${firstSentence(breed.description)}` : `I don't have a description for ${breed.name}.`;

        // the answers below are estimates from the breed description, not facts from the API
        case "grooming": {
            const coat = describeCoat(breed);
            const grooming = estimateGrooming(breed);

            if (!coat || !grooming) {
                return `I don't have grooming information for ${breed.name}.`;
            }

            return `${breed.name} has a ${coat}, so I'd expect ${GROOMING_WORDS[grooming]} needs.`;
        }

        case "exercise": {
            const activity = estimateActivity(breed);
            const amount = activity === "high" ? "a lot of" : activity === "medium" ? "a moderate amount of" : "fairly little";

            return `${breed.name} is described as ${ACTIVITY_WORDS[activity]}, so it probably needs ${amount} exercise.`;
        }

        // for apartment cuz it was not a information I could get from API, I estimated it according to size and activity level
        case "apartment": {
            const size = getBreedSize(breed);
            const activity = estimateActivity(breed);

            if (size === "small" && activity !== "high") { // if it is small and it is not highly active, then it is good for apartment
                return `${breed.name} is small and ${ACTIVITY_WORDS[activity]}, so it would probably be fine in an apartment.`;
            }

            if (size === "large" || activity === "high") { // if it is large and highly active then it could be difficult
                const sizePart = size ? `${size}, ` : "";
                return `${breed.name} is a ${sizePart}${ACTIVITY_WORDS[activity]} dog, so apartment life could be hard unless it gets plenty of exercise.`;
            }

            return `${breed.name} could live in an apartment if it gets enough daily exercise.`;
        }

        // I treated this also like apartment
        case "training": {
            const temperament = (breed.temperament ?? "").toLowerCase();

            if (["intelligent", "eager to please", "trainable", "obedient"].some(word => temperament.includes(word))) {
                return `${breed.name} is described as ${breed.temperament?.toLowerCase()}, so it's usually fairly easy to train.`;
            }

            if (["independent", "stubborn", "aloof"].some(word => temperament.includes(word))) {
                return `${breed.name} can be independent, so training may take some patience.`;
            }

            return `I don't have much training information for ${breed.name}.`; // no matching info
        }

        case "health":
            return `I don't have health information for ${breed.name}.`; // for now

        default:
            return breed.description ? `${breed.name}: ${firstSentence(breed.description)}` : `I found ${breed.name}, but I don't have a description.`;
    }
}
