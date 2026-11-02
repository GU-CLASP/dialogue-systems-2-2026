// to handle messages that the normal dialogue rules cannot handle
// it does not change chatbot's information state

import OpenAI from "openai";
import type { Breed } from "./types";
import type { DogPreferences } from "./dialogueState";

const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  dangerouslyAllowBrowser: true, // we call Ollama directly from the browser, no backend
});

export type FallbackContext = {
  preferences: DogPreferences;
  results: Breed[];
  currentBreed?: Breed;
  pendingQuestion?: string; // the question the system will ask after the reply, if any
};

export type FallbackResult = {
  // false for nonsense or utterances the LLM can't make sense of either, then the dialogue manager does its normal repair
  understood: boolean;
  reply: string;
};

// only the fields that help answering to keep the prompt short
function describeBreed(breed: Breed) {
  return {
    name: breed.name,
    temperament: breed.temperament,
    description: breed.description,
    weight_kg: breed.weight?.metric,
    life_span: breed.life_span,
  };
}

export async function respondFreely(utterance: string, context: FallbackContext): Promise<FallbackResult> {

  const completion = await openai.chat.completions.create({
    model: "llama3.1:latest",
    temperature: 0,
    response_format: { type: "json_object" },

    messages: [
      {
        role: "system",
        content: `
        You are the voice of a spoken assistant that helps people explore dog breeds.
        The dialogue manager could not map the user's utterance to one of its actions,
        so you write a short reply.

        Return one JSON object: {"understood": true or false, "reply": "..."}

        RULES:
        1. Greetings, thanks and small talk: reply politely in one sentence.
        2. General questions about dogs that are not about a specific breed
          (e.g. what suits a first-time owner): answer briefly with well-known
          general advice, without exact numbers or statistics.
        3. Questions about or comparing specific breeds: ONLY use the breed information
          below. If it doesn't contain the answer (e.g. the temperament doesn't mention
          children), say that you don't know from the information you have, and suggest
          asking about one breed for more details. Never guess facts about a breed.
        4. Off-topic requests are understood: return understood true and say briefly
          that you can only help with dog breeds.
          Example: "What's the weather like?" ->
          {"understood": true, "reply": "I'm afraid I can only help with dog breeds."}
        5. Only if the utterance is nonsense or you can't tell what the user means,
          return {"understood": false, "reply": ""}.
        6. Do not say that you changed preferences, searched, or found new breeds.
        7. Do not ask the pending question, the system will ask it after your reply.
        8. If there is no pending question, end by inviting the user to describe
          the dog they want or to ask about a breed.
        9. Speak naturally: at most two short sentences, no lists or Markdown.
        `
      },
      {
        role: "user",
        content: `
        Current preferences: ${JSON.stringify(context.preferences)}
        Breeds being shown: ${JSON.stringify(context.results.map(describeBreed))}
        Breed being discussed: ${context.currentBreed ? context.currentBreed.name : "None"}
        Pending question: ${context.pendingQuestion ?? "None"}

        User utterance:
        ${utterance}
`
      }
    ]
  });

  const content = completion.choices[0]?.message?.content;
  console.log("RAW FALLBACK OUTPUT:", content);

  try { // validating the response
    const parsed = JSON.parse(content ?? "");

    if (typeof parsed?.reply === "string" && parsed.understood === true && parsed.reply.trim()) {
      return { 
        understood: true, 
        reply: parsed.reply.trim() 
      };
    }
  } catch (error) {
    console.error("Failed to parse fallback output:", error);
  }

  return { understood: false, reply: "" };
}
