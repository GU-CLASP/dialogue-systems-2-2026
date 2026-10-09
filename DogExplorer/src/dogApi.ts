import { Breed } from "./types";

const B_URL = "https://api.thedogapi.com/v1";

export async function searchBreed(breedName: string, apiKey: string): Promise<Breed[]> { // we give it the breed an the apikey
  const response = await fetch(`${B_URL}/breeds/search?q=${encodeURIComponent(breedName)}`,
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