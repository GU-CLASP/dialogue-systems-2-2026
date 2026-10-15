import type { Breed } from "./types";
import type { DogPreferences } from "./dialogueState";

// for estimating a breeds size
function getBreedSize(breed: Breed): "small" | "medium" | "large" | undefined {

  const metric = breed.weight?.metric;
  if (!metric) return undefined;

  // numeric values from weight strings
  const numbers = [...metric.matchAll(/\d+(?:\.\d+)?/g)].map(match => Number(match[0])); // to get all the numbers from the weight string
  if (numbers.length === 0) 
    return undefined;

  const minimum = Math.min(...numbers);
  const maximum = Math.max(...numbers);
  const average = (minimum + maximum) / 2;

  if (average < 10) 
    return "small";
  if (average <= 25) 
    return "medium";

  return "large";
}

export function findMatchingBreeds(breeds: Breed[], preferences: DogPreferences): Breed[] {

  const matches = breeds.filter(breed => {
    // filtering by size
    if (preferences.sizes.length > 0) {
      const breedSize = getBreedSize(breed);

      if (!breedSize || !preferences.sizes.includes(breedSize)) {
        return false;
      }
    }

    // temperament
    if (preferences.temperaments.length > 0) {

      const temperament = (breed.temperament ?? "").toLowerCase();
      const hasMatchingTemperament = preferences.temperaments.some( trait => temperament.includes(trait.toLowerCase()));

      if (!hasMatchingTemperament) {
        return false;
      }
    }
    return true;
  });

  return matches;
}
