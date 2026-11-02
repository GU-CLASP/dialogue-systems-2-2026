
import OpenAI from "openai";
import type { SizePreferences, Level, DogPreferences } from "./dialogueState";

export type NLUResult = { // info that can nlu return
  // All fields are optional because the user may not provide them
  sizes?: SizePreferences[];
  activity?: Level | "any";
  grooming?: Level | "any";
  temperaments?: string[];
  intent?:
    | "set_preferences" | "select_result" | "ask_about_breed" | "more_options"
    | "show_results" | "restart" | "help" | "general_question" | "unknown";

  preferenceOperation?: "replace" | "add"; // Whether to add to or replace existing preferences
  resultIndex?: number; // number of selected result
  breedName?: string;
  questionType?:
    | "size" | "temperament" | "lifespan" | "description" | "grooming"
    | "exercise" | "apartment" | "training" | "health" | "other";
};


const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  dangerouslyAllowBrowser: true, // we call Ollama directly from the browser, no backend
});


export async function understandUser(utterance: string, lastQuestion?: string, preferences?: DogPreferences): Promise<NLUResult> {

  // --- first we try to understand simple messages without an LLM
  const normalized = utterance.trim().toLowerCase().replace(/[.!?]+$/, ""); //normalize
  // then we check
  // for activity
  const activityPreferences: Record<string, Level> = {
    "very active": "high",
    "high activity": "high",
    "moderately active": "medium",
    "medium activity": "medium",
    "not very active": "low",
    "low activity": "low",
  };
  // for grooming
  const groomingPreferences: Record<string, Level> = {
    "high grooming": "high",
    "medium grooming": "medium",
    "low grooming": "low",
    "not much grooming": "low",
  };

  if (activityPreferences[normalized]) {
    return {
      intent: "set_preferences",
      activity: activityPreferences[normalized],
      preferenceOperation: "replace",
    };
  }

  if (groomingPreferences[normalized]) {
    return {
      intent: "set_preferences",
      grooming: groomingPreferences[normalized],
      preferenceOperation: "replace",
    };
  }

  const noPreference = ["i don't mind", "i dont mind", "i don't care", "i dont care", "doesn't matter", "it doesn't matter", "no preference",
    "i have no preference", "anything", "anything is fine", "whatever", "either", "any", "not important", "skip", "skip that", "next question"];

  // commands that don't need the LLM
  if (["start over", "restart", "reset", "let's start over", "start again"].includes(normalized)) {
    return { intent: "restart" };
  }
  if (["help", "what can i say", "what can you do", "what can i ask", "what are my options"].includes(normalized)) {
    return { intent: "help" };
  }
  if (["anything else", "any others", "what else", "show me more", "more", "next", "show me other breeds", "other options", "something else"].includes(normalized)) {
    return { intent: "more_options" };
  }
  if (["show me some dogs", "just show me some dogs", "show me what you have", "surprise me", "show me results", "just show me", "show me"].includes(normalized)) {
    return { intent: "show_results" };
  }

  if (lastQuestion && noPreference.includes(normalized)) {
    if (lastQuestion === "size") {
      return { 
        intent: "set_preferences", 
        sizes: ["small", "medium", "large"], 
        preferenceOperation: "replace" 
      };
    }
    if (lastQuestion === "activity") {
      return { 
        intent: "set_preferences", 
        activity: "any", 
        preferenceOperation: "replace" 
      };
    }
    if (lastQuestion === "grooming") {
      return { 
        intent: "set_preferences", 
        grooming: "any", 
        preferenceOperation: "replace" 
      };
    }
  }

  // --- Second we ask Ollama to understand the users utterance
  const completion = await openai.chat.completions.create({
    model: "llama3.1:latest",
    temperature: 0,
    response_format: { type: "json_object" },

    messages: [
      {
        role: "system",
        content: `
          You are the NLU component of a dog breed dialogue system.

          Your task is to understand the user's utterance and return
          one JSON object containing the user's intent and any explicitly mentioned dog preferences.

          POSSIBLE INTENTS:

          1. set_preferences
          The user provides or changes dog preferences.

          Example:
          User: "I want a small dog."
          Output: {"intent":"set_preferences","sizes":["small"]}

          Example:
          User: "Very active."
          Output: {"intent":"set_preferences","activity":"high","preferenceOperation":"replace"}

          Example:
          User: "Not very active."
          Output: {"intent":"set_preferences","activity":"low","preferenceOperation":"replace"}

          Example:
          User: "High grooming."
          Output: {"intent":"set_preferences","grooming":"high","preferenceOperation":"replace"}

          Example:
          User: "Low grooming."
          Output: {"intent":"set_preferences","grooming":"low","preferenceOperation":"replace"}

          2. select_result
          The user selects one of the previously recommended breeds.
          Use a 1-based resultIndex.

          Example:
          User: "Tell me about the first one."
          Output: {"intent":"select_result","resultIndex":1}

          Example:
          User: "Tell me more about the second one."
          Output: {"intent":"select_result","resultIndex":2}

          Example:
          User: "How big is the third one?"
          Output: {"intent":"select_result","resultIndex":3,"questionType":"size"}

          3. ask_about_breed
          The user asks for information about a breed.

          Example:
          User: "How big does it get?"
          Output: {"intent":"ask_about_breed","questionType":"size"}

          Example:
          User: "What is its temperament?"
          Output: {"intent":"ask_about_breed","questionType":"temperament"}

          Example:
          User: "How long does it live?"
          Output: {"intent":"ask_about_breed","questionType":"lifespan"}

          Example:
          User: "Does it need much grooming?"
          Output: {"intent":"ask_about_breed","questionType":"grooming"}

          Example:
          User: "Does it need a lot of exercise?"
          Output: {"intent":"ask_about_breed","questionType":"exercise"}

          Example:
          User: "Is it suitable for apartment living?"
          Output: {"intent":"ask_about_breed","questionType":"apartment"}

          Example:
          User: "Can this dog live in an apartment?"
          Output: {"intent":"ask_about_breed","questionType":"apartment"}

          Example:
          User: "Is it easy to train?"
          Output: {"intent":"ask_about_breed","questionType":"training"}

          Example:
          User: "Does it have any health problems?"
          Output: {"intent":"ask_about_breed","questionType":"health"}

          Example:
          User: "Where does it come from?"
          Output: {"intent":"ask_about_breed","questionType":"other"}

          Example:
          User: "What was it originally bred for?"
          Output: {"intent":"ask_about_breed","questionType":"other"}

          Example:
          User: "Tell me about Labradors."
          Output: {"intent":"ask_about_breed","breedName":"Labrador","questionType":"description"}

          4. more_options
          The user asks for alternative breeds.

          Example:
          User: "Show me other breeds."
          Output: {"intent":"more_options"}

          Example:
          User: "Can you suggest three more?"
          Output: {"intent":"more_options"}

          Example:
          User: "Anything else?"
          Output: {"intent":"more_options"}

          5. show_results
          The user wants to see breeds now, without answering more questions.
          It can be combined with preferences.

          Example:
          User: "Just show me some dogs."
          Output: {"intent":"show_results"}

          Example:
          User: "I don't want to answer more questions, what do you have?"
          Output: {"intent":"show_results"}

          Example:
          User: "Just show me small dogs."
          Output: {"intent":"show_results","sizes":["small"],"preferenceOperation":"replace"}

          6. restart
          The user wants to start the conversation over.

          Example:
          User: "Let's start again from the beginning."
          Output: {"intent":"restart"}

          7. help
          The user asks what they can say or what the system can do.

          Example:
          User: "What kind of things can I ask you?"
          Output: {"intent":"help"}

          8. general_question
          Greetings, small talk, general questions about dogs,
          or questions comparing several breeds instead of asking about one.

          Example:
          User: "Hello!"
          Output: {"intent":"general_question"}

          Example:
          User: "What's a good dog for a first-time owner?"
          Output: {"intent":"general_question"}

          Example:
          User: "Which of these is best with kids?"
          Output: {"intent":"general_question"}

          Example:
          User: "Which one is the smallest?"
          Output: {"intent":"general_question"}

          9. unknown
          The user's request cannot be understood.


          PREFERENCE FIELDS:

          sizes:
          - small
          - medium
          - large
          Return an array of sizes.

          activity:
          - low
          - medium
          - high
          - any (the user doesn't mind)

          grooming:
          - low
          - medium
          - high
          - any (the user doesn't mind)

          If the user doesn't mind about size, return all three sizes.

          temperaments:
          An array of explicitly requested traits, such as friendly, calm, playful, intelligent, or affectionate.

          PREFERENCE OPERATIONS:

          When the user provides or changes preferences, identify whether they want to replace existing
          preferences or add to them.

          preferenceOperation must be either "replace" or "add".

          Use "replace" when the user expresses a new preference
          without explicitly saying it should be added to existing ones.

          Use "add" only when the user clearly indicates that
          the new preference should be included alongside
          previous preferences.

          Examples:

          User: "Actually, I want medium dogs instead."
          Output:
          {"intent":"set_preferences","sizes":["medium"],"preferenceOperation":"replace"}

          User: "Medium dogs are okay too."
          Output:
          {"intent":"set_preferences","sizes":["medium"],"preferenceOperation":"add"}

          User: "I also like large dogs."
          Output:
          {"intent":"set_preferences","sizes":["large"],"preferenceOperation":"add"}

          User: "I prefer small dogs."
          Output:
          {"intent":"set_preferences","sizes":["small"],"preferenceOperation":"replace"}

          User: "I want small or medium dogs."
          Output:
          {"intent":"set_preferences","sizes":["small","medium"],"preferenceOperation":"replace"}



          ADDITIONAL PREFERENCE EXAMPLES:

          User: "I want a medium-sized active dog."
          Output:
          {"intent":"set_preferences","sizes":["medium"],"activity":"high","preferenceOperation":"replace"}

          User: "I want something friendly and calm."
          Output:
          {"intent":"set_preferences","temperaments":["friendly","calm"],"preferenceOperation":"replace"}

          User: "I want very active dogs."
          Output:
          {"intent":"set_preferences","activity":"high","preferenceOperation":"replace"}

          User: "I prefer dogs that don't need much grooming."
          Output:
          {"intent":"set_preferences","grooming":"low","preferenceOperation":"replace"}

          Last question: grooming
          User: "Not much."
          Output:
          {"intent":"set_preferences","grooming":"low"}

          Last question: activity
          User: "Not very active."
          Output:
          {"intent":"set_preferences","activity":"low"}

          Last question: size
          User: "Medium."
          Output:
          {"intent":"set_preferences","sizes":["medium"],"preferenceOperation":"replace"}

          NEGATIVE AND VAGUE SIZE PREFERENCES:
          Convert them into the sizes that are still allowed.

          User: "Nothing huge."
          Output:
          {"intent":"set_preferences","sizes":["small","medium"],"preferenceOperation":"replace"}

          User: "I live in an apartment, so nothing too big."
          Output:
          {"intent":"set_preferences","sizes":["small","medium"],"preferenceOperation":"replace"}

          User: "Not a tiny dog."
          Output:
          {"intent":"set_preferences","sizes":["medium","large"],"preferenceOperation":"replace"}

          User: "A big dog."
          Output:
          {"intent":"set_preferences","sizes":["large"],"preferenceOperation":"replace"}

          RELATIVE CHANGES:
          Use the current preferences to turn relative changes into new values.
          Sizes go small < medium < large, levels go low < medium < high.

          Current preferences: {"sizes":["large"],"activity":"high"}
          User: "Something a bit calmer."
          Output:
          {"intent":"set_preferences","activity":"medium","preferenceOperation":"replace"}

          Current preferences: {"sizes":["medium"]}
          User: "Can it be a bit smaller?"
          Output:
          {"intent":"set_preferences","sizes":["small"],"preferenceOperation":"replace"}

          Current preferences: {"sizes":["small"],"grooming":"medium"}
          User: "Less grooming please."
          Output:
          {"intent":"set_preferences","grooming":"low","preferenceOperation":"replace"}

          NO PREFERENCE:

          Last question: grooming
          User: "I don't really care about grooming."
          Output:
          {"intent":"set_preferences","grooming":"any","preferenceOperation":"replace"}

          Last question: activity
          User: "Doesn't matter to me."
          Output:
          {"intent":"set_preferences","activity":"any","preferenceOperation":"replace"}

          Last question: size
          User: "Any size is fine."
          Output:
          {"intent":"set_preferences","sizes":["small","medium","large"],"preferenceOperation":"replace"}


          IMPORTANT: DISTINGUISH PREFERENCES FROM BREED QUESTIONS

          If the user describes what they want in a dog,
          classify the utterance as set_preferences.

          This applies even when the system has already
          recommended breeds.

          A statement about desired characteristics is a preference.
          A question about a specific breed is ask_about_breed.

          Example:
          User: "Very active."
          Output: {"intent":"set_preferences","activity":"high"}

          Example:
          User: "Is this breed very active?"
          Output: {"intent":"ask_about_breed","questionType":"exercise"}

          Example:
          User: "Does this dog require a lot of grooming?"
          Output: {"intent":"ask_about_breed","questionType":"grooming"}


          IMPORTANT RULES:

          1. Always include an intent.
          2. Return exactly one valid JSON object.
          3. Only extract preferences explicitly mentioned by the user.
          4. Omit fields that were not mentioned.
          5. Never return empty arrays for missing fields.
          6. Activity and temperament are different concepts.
          7. Calm and affectionate describe temperament, not exercise needs.
          8. Use the last question to interpret short answers.
          9. A numbered breed reference is select_result, not set_preferences.
          10. If the user asks about "it", do not invent a breed name.
          11. Do not invent result indices or breed names.
          12. Only use preferenceOperation for set_preferences.
          13. Use "add" only for explicit additive expressions such as "also" or "too".
          14. Only use these questionType values:
              size, temperament, lifespan, description,
              grooming, exercise, apartment, training, health, other.
          15. Never output "apartment_living" or "activity" as questionType.
          16. Do not include explanations or Markdown.
          `
      },
      {
        role: "user",
        content: `
          Last question asked by the system:
          ${lastQuestion ?? "None"}

          Current preferences:
          ${JSON.stringify(preferences ?? {})}

          User utterance:
          ${utterance}
          `
      }
    ]
  });

  const content = completion.choices[0]?.message?.content; // model's response
  console.log("RAW LLM OUTPUT:", content);

  if (!content) {
    return { intent: "unknown" };
  }

  try {
    // we parse the JSON returned by Ollama, cuz we dont want to blindly trust it
    const parsed: unknown = JSON.parse(content); // to convert JSON to js value

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { intent: "unknown" };
    }

    const data = parsed as Record<string, unknown>;

    const result: NLUResult = {
      intent: "unknown"
    };

    const validIntents = ["set_preferences", "select_result", "ask_about_breed", "more_options", "show_results", "restart", "help", "general_question", "unknown"];

    // Validate the intent
    if (typeof data.intent === "string" && validIntents.includes(data.intent)) {
      result.intent = data.intent as NLUResult["intent"];
    }

    const validSizes = ["small", "medium", "large"];
    const validLevels = ["low", "medium", "high", "any"];

    // validate size preferences
    if (Array.isArray(data.sizes)) {
      const sizes = data.sizes.filter((value): value is SizePreferences => typeof value === "string" && validSizes.includes(value));

      if (sizes.length > 0) {
        result.sizes = sizes;
      }
    }

    //to validate activity preference
    if (typeof data.activity === "string" && validLevels.includes(data.activity)) {
      result.activity = data.activity as Level | "any";
    }

    // to validate grooming preference
    if (typeof data.grooming === "string" && validLevels.includes(data.grooming)) {
      result.grooming = data.grooming as Level | "any";
    }

    // Validate temperament preferences
    if (Array.isArray(data.temperaments)) {
      const temperaments = data.temperaments.filter((value): value is string => typeof value === "string" && value.trim().length > 0);

      if (temperaments.length > 0) {
        result.temperaments = temperaments;
      }
    }

    // Validate preference operation
    if ((result.intent === "set_preferences" || result.intent === "show_results") && (data.preferenceOperation === "replace" || data.preferenceOperation === "add")) {
      result.preferenceOperation = data.preferenceOperation;
    }

    // Validate the selected result index
    if (typeof data.resultIndex === "number" && Number.isInteger(data.resultIndex) && data.resultIndex > 0) {
      result.resultIndex = data.resultIndex;
    }

    // Validate breed name
    if ( typeof data.breedName === "string" && data.breedName.trim().length > 0) {
      result.breedName = data.breedName.trim();
    }

    const validQuestionTypes = ["size", "temperament","lifespan", "description", "grooming","exercise",
      "apartment", "training", "health", "other"];

    // normalizing different names for the same question type
    const questionTypeAliases: Record<string, string> = {
      apartment_living: "apartment",
      apartment_suitability: "apartment",
      living_conditions: "apartment",
      exercise_needs: "exercise",
      activity: "exercise",
      activity_level: "exercise",
      grooming_needs: "grooming",
      coat_care: "grooming",
      trainability: "training",
      training_needs: "training",
      life_span: "lifespan",
      weight: "size",
      height: "size",
      health_issues: "health",
      health_problems: "health",
      history: "other",
      origin: "other",
    };

    if (typeof data.questionType === "string") {
      const rawType = data.questionType.trim().toLowerCase();

      const normalizedType = questionTypeAliases[rawType] ?? rawType;

      if (validQuestionTypes.includes(normalizedType)) {
        result.questionType = normalizedType as NLUResult["questionType"];
      }
    }

    console.log("VALIDATED NLU:", result);

    return result;

  } catch (error) {
    console.error("Failed to parse NLU output:", error);
    return { intent: "unknown" };
  }
}
