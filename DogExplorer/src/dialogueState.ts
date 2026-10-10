// to make the dog explorer remember what the user wants and what breed/result they are currently talking about

import { Breed } from "./types";
import type { NLUResult } from "./nlu";

export type SizePreferences = "small" | "medium" | "large" ;
export type Level = "low" | "medium" | "high";

export type DogPreferences = {
    sizes: SizePreferences[];
    activity?: Level;
    grooming?: Level;
    temperaments: string[];
};

export type DialogueState = {
    preferences: DogPreferences;

    // breeds most recently shown to the user
    searchResults: Breed[];

    // breed currently being discussed
    currentBreed?: Breed;
};

export function createInitialState(): DialogueState {
    return {
        preferences: {
            sizes: [],
            temperaments: [],
        },
        searchResults: [],
        currentBreed: undefined,
    };
}

export function updatePreferences(state: DialogueState, nlu: NLUResult): void {
    if (Array.isArray(nlu.sizes) && nlu.sizes.length > 0){
        state.preferences.sizes = nlu.sizes;
    }
    if (nlu.activity === "low" || nlu.activity === "medium" || nlu.activity === "high" ){
        state.preferences.activity = nlu.activity;
    }
    if (nlu.grooming === "low" || nlu.grooming === "medium" || nlu.grooming === "high"){
        state.preferences.grooming = nlu.grooming;
    }
    if (Array.isArray(nlu.temperaments) && nlu.temperaments.length > 0){
        state.preferences.temperaments = nlu.temperaments;
    }
}