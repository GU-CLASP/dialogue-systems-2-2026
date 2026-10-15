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

export async function understandUser(utterance: string, lastQuestion?: string): Promise<NLUResult> {
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


                The user may give a short answer to the last question.

                Use the last question to interpret short answers.

                Examples:

                Last question: grooming
                User: "Not much"
                Output: {"grooming":"low"}

                Last question: activity
                User: "Very active"
                Output: {"activity":"high"}

                Last question: size
                User: "Medium"
                Output: {"sizes":["medium"]}

                If the user explicitly provides preferences unrelated to
                the last question, extract those preferences too.

                Do not invent information.

                Only return valid JSON.


                Important distinction:
                Temperament and activity level are different concepts.

                "Calm", "friendly", "gentle", and "affectionate" describe
                temperament. They do not automatically specify exercise needs.

                Only extract activity when the user explicitly describes
                exercise needs, energy level, or desired physical activity.

                If the last question was about activity but the user answers
                with temperament information only, extract the temperament
                and omit activity.

                Example:

                Last question: activity
                User: "I prefer something calm and affectionate."

                Output:
                {
                "temperaments": ["calm", "affectionate"]
                }

                Do not invent an activity value just to answer the last question.
                `,
            },
            {
                role: "user",
                content: `
                        Last question asked by the system:
                        ${lastQuestion ?? "None"}

                        User utterance:
                        ${utterance}`,
            },
        ],
    });

    const content = completion.choices[0].message.content;

    if (!content) { // if it was empty
        return {};
    }
    return JSON.parse(content) as NLUResult;
}