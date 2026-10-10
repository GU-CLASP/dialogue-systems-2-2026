import OpenAI from "openai";
import { SizePreferences, Level } from "./dialogueState";

export type NLUResult = { // all optional cuz they user might not provide them
    sizes?: SizePreferences[];
    activity?: Level;
    grooming?: Level;
    temperaments?: string[];
};

const openai = new OpenAI({
    baseURL: "http://localhost:11434/v1/",
    apiKey: "ollama",
});

export async function understandUser(utterance: string): Promise<NLUResult> {
    const completion = await openai.chat.completions.create({
        model: "llama3.1:latest",

        messages: [
            {
                role: "system",
                content: `You are the NLU component of a dog breed dialogue system. Your task is to extract dog preferences from the user's utterance.
                Possible fields:
                
                sizes:
                - small
                - medium
                - large
                
                activity:¨
                - low
                - medium
                - high
                
                grooming:
                - low
                - medium
                - high
                
                temperaments:
                - an array of temperament words explicitly requested by the user, such as friendly, calm, playful, intelligent, affectionate, energetic.
                
                Rules:

                1. Only extract preferences explicitly expressed by the user.
                2. If a preference is NOT mentioned, OMIT that field completely.
                3. NEVER return an empty array for a field that was not mentioned.
                4. "activity" must only be "low", "medium", or "high".
                5. "grooming" must only be "low", "medium", or "high".
                6. "sizes" must be an array containing only "small", "medium", or "large".
                7. "temperaments" must be an array of temperament words.
                8. Return valid JSON only.
                9. Do not include explanations.

                For example:

                User:
                "I would also like something friendly and calm."

                Correct:
                {
                "temperaments": ["friendly", "calm"]
                }

                incorrect:
                {
                "sizes": [],
                "activity": [],
                "grooming": [],
                "temperaments": ["friendly", "calm"]
                }
                `,
            },
            {
                role: "user",
                content: utterance,
            },
        ],
    });

    const content = completion.choices[0].message.content;

    if (!content) { // if it was empty
        return {};
    }
    return JSON.parse(content) as NLUResult;
}