// to estimate breed traits and return the breeds that match the user's preferences best

import type { Breed } from "./types";
import type { DogPreferences, Level, SizePreferences } from "./dialogueState";
import { COMMON_BREEDS } from "./commonBreeds";

// TheDogAPI has no activity or grooming fields, so I estimate them from the words used in the breed's temperament and description
const HIGH_ACTIVITY_WORDS = ["energetic", "athletic", "stamina", "tireless", "high-energy", "agile", "active", "lively", "spirited", "vigorous", "endurance", "hunting"];
const LOW_ACTIVITY_WORDS = ["calm", "laid-back", "easygoing", "easy-going", "docile", "couch", "quiet", "relaxed", "low-energy", "lap dog", "companion", "placid", "dignified"];

// some breed groups were bred for work, others for companionship
const GROUP_ACTIVITY: Record<string, number> = {
  "Sporting": 1,
  "Herding": 1,
  "Working": 0.5,
  "Terrier": 0.5,
  "Hound": 0.5,
  "Toy": -1,
  "Companion": -1,
};

const HIGH_GROOMING_WORDS = ["long", "silky", "curly", "corded", "flowing", "profuse", "fluffy", "luxurious", "abundant", "woolly", "wooly", "feathered", "feathering", "plumed", "shaggy"];
const LOW_GROOMING_WORDS = ["short", "smooth", "sleek", "hairless", "close-lying", "fine", "glossy"];
const MEDIUM_GROOMING_WORDS = ["double", "wire", "wiry", "harsh", "rough", "dense", "thick", "medium-length"];

//how many times any of the words appear as whole words in the text
function countWords(text: string, words: string[]): number {
  return words.reduce((total, word) => {// we iterate through all words and accumulate their count
    const pattern = new RegExp(`\\b${word.replace(/[-]/g, "\\-")}\\b`, "g"); // regex that mathces the current word as a whole word, and escape hyphens so they are treated literally
    return total + (text.match(pattern)?.length ?? 0); // counting matches of the current word and adding them to the running total
  }, 0); // so we start the running total at 0
}

// For estimating a breed's size
export function getBreedSize(breed: Breed): SizePreferences | undefined {

  const metric = breed.weight?.metric;
  if (!metric) 
    return undefined;

  // extracting numeric values from weight strings
  const numbers = [...metric.matchAll(/\d+(?:\.\d+)?/g)].map(match => Number(match[0])).filter(number => Number.isFinite(number) && number > 0);

  if (numbers.length === 0) {
    return undefined;
  }

  const minimum = Math.min(...numbers);
  const maximum = Math.max(...numbers);
  const average = (minimum + maximum) / 2;

  if (average < 10) {
    return "small";
  }
  if (average <= 25) {
    return "medium";
  }
  return "large";
}

// positive when the description sounds active, negative when it sounds calm
function activityScore(breed: Breed): number {
  const text = `${breed.temperament ?? ""} ${breed.description ?? ""}`.toLowerCase();

  return countWords(text, HIGH_ACTIVITY_WORDS) - countWords(text, LOW_ACTIVITY_WORDS) + (GROUP_ACTIVITY[breed.breed_group ?? ""] ?? 0); // activity score = high keywords - low keywords + group adjustment
}

// For estimating how active a breed is
export function estimateActivity(breed: Breed): Level {
  const score = activityScore(breed);
  if (score >= 1.5) 
    return "high";
  if (score <= -0.5) 
    return "low";
  return "medium";
}

// the words in front of coat/hair/fur : "a long, silky steel blue and golden tan coat"
function coatClause(breed: Breed): string | undefined {
  const description = (breed.description ?? "").toLowerCase();
  const match = description.match(/((?:[\w-]+,?\s+){0,8})(coat|hair|fur)\b/); // up to 8 word like pieces before "coat", "hair" or "fur"
  if (!match) 
    return undefined;

  // we only keep what comes after the last "with", "a", "the"... so other body parts are left out
  const parts = match[0].split(/\b(?:with|has|its|the|a|an|featuring)\b/);
  return parts[parts.length - 1].trim();
}

// the grooming-related words used about the coat e.g. "long, silky coat"
export function describeCoat(breed: Breed): string | undefined {
  const clause = coatClause(breed);
  if (!clause) 
    return undefined;

  const groomingWords = [...HIGH_GROOMING_WORDS, ...LOW_GROOMING_WORDS, ...MEDIUM_GROOMING_WORDS];

  // in the order they appear in the description
  const found = clause.split(/[\s,]+/).filter((word, index, words) => groomingWords.includes(word) && words.indexOf(word) === index); // first split then keep only the grooming words and no duplicates

  return found.length > 0 ? `${found.join(", ")} coat` : undefined;
}

// For estimating grooming needs, only from the words describing the coat
export function estimateGrooming(breed: Breed): Level | undefined {
  const coat = coatClause(breed);
  if (!coat) 
    return undefined;

  const high = countWords(coat, HIGH_GROOMING_WORDS);
  const low = countWords(coat, LOW_GROOMING_WORDS);
  const medium = countWords(coat, MEDIUM_GROOMING_WORDS);

  if (high === 0 && low === 0 && medium === 0) 
    return undefined;
  if (high > low && high >= medium) 
    return "high";
  if (low > high && low >= medium) 
    return "low";
  return "medium";
}



// ------------- then we wanna check how well does a breed match

const LEVEL_VALUE: Record<Level, number> = { low: 0, medium: 1, high: 2 };

// for activity and grooming, 2 points for an exact match, 1 for a neighbouring level, 0.5 if unknown and undefined if the breed is the opposite of what the user wants
function levelScore(wanted: Level | "any" | undefined, actual: Level | undefined): number | undefined {
  // wanted is the users preference and actual is the breed's estimated characteristic
  if (wanted === undefined || wanted === "any") // user has no preference and there is nothing to score
    return 0;
  if (actual === undefined) // if the user has a preference but the breed's level is unknown then small score
    return 0.5;

  const distance = Math.abs(LEVEL_VALUE[wanted] - LEVEL_VALUE[actual]); // absolute value

  if (distance === 0) // exact match
    return 2;
  if (distance === 1) // neighboring level
    return 1;
  return undefined; // opposite level, would be excluded later from the breeds
}

export function findMatchingBreeds(breeds: Breed[], preferences: DogPreferences): Breed[] { // returns an array of matching breeds, sorted from best to worst

  const scored: { 
    breed: Breed; // actual dog breed
    score: number; // total matching score
    common: number; // whether it is in common_breeeds
    evidence: number // how strongly the activity information supports the requested level
  }[] = [];

  for (const breed of breeds) { // for each breed

    // filtering by size
    if (preferences.sizes.length > 0) {
      const breedSize = getBreedSize(breed);

      if (!breedSize || !preferences.sizes.includes(breedSize)) { // if it is unknown or its size is not among the user's accepted sizes
        continue; // we move on to the next breed
      }
    }

    const activityMatch = levelScore(preferences.activity, estimateActivity(breed));
    const groomingScore = levelScore(preferences.grooming, estimateGrooming(breed));

    // leaving out breeds that are the opposite of what the user asked for
    if (activityMatch === undefined || groomingScore === undefined) {
      continue;
    }

    // one point for every requested temperament the breed has
    const temperament = (breed.temperament ?? "").toLowerCase();
    const temperamentScore = preferences.temperaments.filter(trait => temperament.includes(trait.toLowerCase())).length;

    if (preferences.temperaments.length > 0 && temperamentScore === 0) {
      continue;
    }

    // how clearly the description supports the wanted activity level like "energetic, athletic, tireless" is stronger evidence than only "active"
    const rawActivity = activityScore(breed);
    const evidence = // to just help breaking ties between breeeds with the same main score
      preferences.activity === "high" ? rawActivity : // so if the user want high activity, higher raw activity scores are better
      preferences.activity === "low" ? -rawActivity : // if it wants low activity, lower raw activity score are better
      preferences.activity === "medium" ? -Math.abs(rawActivity - 0.5) : // if medium then scores closer to 0.5 are better
      0; // no activity preference

    const common = breed.name in COMMON_BREEDS ? 1 : 0; // checking whether the breed is common or not

    scored.push({ breed, score: activityMatch + groomingScore + temperamentScore, common, evidence });
  }

  // best matches first, then well-known breeds, then the clearest matches, and otherwise the API order
  scored.sort((a, b) => 
    b.score - a.score || // higher scores first
  b.common - a.common || // if the scores are equal, common breeds first
  b.evidence - a.evidence); // if both previous values were eaual then the one with the stronger activity evidence first

  return scored.map(item => item.breed); // returning only the breeds
}
