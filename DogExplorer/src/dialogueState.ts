// the memory, to remember user preferences and the current conversation

import type { Breed } from "./types";
import type { NLUResult } from "./nlu";

export type SizePreferences = "small" | "medium" | "large";
export type Level = "low" | "medium" | "high";

// "any" means the user said they don't mind
export type DogPreferences = {
    sizes: SizePreferences[];
    activity?: Level | "any";
    grooming?: Level | "any";
    temperaments: string[];
};

export type QuestionSlot = "size" | "activity" | "grooming"; // the things system will ask

export type DialogueState = {
    preferences: DogPreferences;
    searchResults: Breed[]; // Breeds most recently shown to the user
    currentBreed?: Breed; // Breed currently being discussed
    shownBreedIds: string[]; // IDs of breeds already recommended to the user
    lastQuestion?: QuestionSlot;
    failedAttempts: number; // how many turns in a row the system didn't understand
    phase: "collecting_preferences" | "exploring_results";
};

export function createInitialState(): DialogueState {
    return {
        preferences: {
            sizes: [],
            temperaments: [],
        },
        searchResults: [],
        currentBreed: undefined,
        shownBreedIds: [],
        lastQuestion: undefined,
        failedAttempts: 0,
        phase: "collecting_preferences",
    };
}

export function updatePreferences(state: DialogueState, nlu: NLUResult): void {

    // Update size preferences
    if (Array.isArray(nlu.sizes) && nlu.sizes.length > 0) {
        if (nlu.preferenceOperation === "add") {
            // Add new sizes without removing existing ones
            state.preferences.sizes = [
                ...new Set([
                    ...state.preferences.sizes,
                    ...nlu.sizes
                ])
            ];

        } else {
            // Replace previous size preferences
            state.preferences.sizes = nlu.sizes;
        }
    }

    // updating activity preference
    if (nlu.activity !== undefined) {
        state.preferences.activity = nlu.activity;
    }

    //update the grooming preference
    if (nlu.grooming !== undefined) {
        state.preferences.grooming = nlu.grooming;
    }

    // Update temperament preferences
    if (Array.isArray(nlu.temperaments) && nlu.temperaments.length > 0) {
        state.preferences.temperaments = nlu.temperaments;
    }
}
