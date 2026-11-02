import { Breed } from "./types";

const B_URL = "https://api.thedogapi.com/v1";

// to search a specefic breed
export async function searchBreed(breedName: string, apiKey: string): Promise<Breed[]> { // we give it the breed an the apikey
  const response = await fetch(`${B_URL}/breeds/search?q=${encodeURIComponent(breedName)}`, // sending the API request
    {
      headers: {
        "x-api-key": apiKey,
      },
    }
  );
  if (!response.ok) { // if there was no response
    throw new Error(`TheDogAPI request failed: ${response.status}`);
  }
  // but if it was fine
  const breeds: Breed[] = await response.json(); // we get the breeds
  return breeds;
}

// the breed list doesn't change while the server runs, so we only download it once
let cachedBreeds: Breed[] | undefined;

// for getting all the breeds
export async function getAllBreeds(apiKey: string): Promise<Breed[]> {
  if (cachedBreeds) {
    return cachedBreeds;
  }

  const response = await fetch(`${B_URL}/breeds`,
    {
      headers: {
        "x-api-key": apiKey,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch breeds: ${response.status}`);
  }

  const breeds: Breed[] = await response.json();

  cachedBreeds = breeds;// save them in cache
  return breeds;
}
