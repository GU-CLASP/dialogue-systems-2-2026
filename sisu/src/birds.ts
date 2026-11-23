import { Question, Proposition, bird,
  distributionCat, habitatCat, conservationStatusCat } from "./types";
import { QdrantClient } from "@qdrant/js-client-rest";
import OpenAI from "openai";

const client = new QdrantClient({ host: "localhost", port: 6333 });

const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  dangerouslyAllowBrowser: true,
});

export async function getBird(
  totalDescription: Proposition[],
  location: string,
  environment: string,
  reducedBirds?: bird[],
  ): Promise<bird[]> {
  console.log("[BIRD RETRIEVAL] Getting bird query");
  
  const utterance = totalDescription.map(i => i.argument).join('. ').toLowerCase().trim()
  if (!utterance) {
    console.warn("[BIRD RETRIEVAL] No bird description available for retrieval");
    return [];
  }
  let filter;
  if (reducedBirds) {
    const reduced_ids = reducedBirds.map(bird => bird.id)
    console.log("reducedBirds ids:", reduced_ids )
    filter = {
      must: [
        {
          has_id: reduced_ids
        },
        {
          key: "distribution",
          match: {
            value: location,
          },
        },
        {
          key: "habitat",
          match: {
            value: environment, // TO DO use any: environment[] in case 2 answers given??
          },
        },
      ],
    }
  } else {
    filter = {
      must: [
        {
          key: "distribution",
          match: {
            value: location,
          },
        },
        {
          key: "habitat",
          match: {
            value: environment, // TO DO use any: environment[] in case 2 answers given??
          },
        },
      ],
    }
  }
  const queryInstruction = `
    Retrieve bird species matching the observed characteristics in the query.
    Prioritize distinctive visual features and distinguish similar species.
    Do not focus on generic characteristics shared by most birds.
    Penalize contradictions between observed features and documented species characteristics.
    `; 
  const text = `Instruct: ${queryInstruction}\nQuery: ${utterance}`
  const embedding = await openai.embeddings
    .create({
      model: "qwen3-embedding",
      input: text,
      dimensions: 384,
    })
    .then((result) => result.data[0].embedding);
  
  const candidatePoints = (await client.query("birdsDB", {
    prefetch: [
      {
        query: embedding,
        using: "dense",
        filter: filter,
        limit: 10
      },
      {
          query: {text, model: "qdrant/bm25"},
          using: "bm25",
          filter: filter,
          limit: 10,
        },
    ],
    query: {
      rrf: {
        weights: [4.0, 1.0]
      }
    },
    with_payload: true,
    limit: 10,
  })).points;
  if (candidatePoints.length === 0) {
    console.log("[BIRD RETRIEVAL] No bird candidate")
  };
  let candidateBirds : bird[] = candidatePoints.map((item) => ({
    id: item.id as number,
    commonName: item.payload!.commonName as string,
    scientificName: item.payload!.scientificName as string,
    distribution: item.payload!.distribution as distributionCat[],
    habitat: item.payload!.habitat as habitatCat[],
    conservationStatus: item.payload!.conservationStatus as conservationStatusCat,
    description: item.payload!.description as string,
    wikiImageURL: item.payload!.wikiImageURL as string
  }));
  const rrfScores = new Map (
    candidatePoints.map((item) => [
    item.payload!.commonName,
    item.score
  ]))
  const candidates_ids = candidateBirds.map(bird => bird.id)
  const filterCandidates = {
      must: [
        {
          has_id: candidates_ids
        }
      ],
    }
  const retrievedPoints = (await client.query("birdsDB", {
    query: embedding,
    using: "dense",
    filter: filterCandidates,
    with_payload: true,
    limit: 10
  })).points;
  if (retrievedPoints.length === 0) {
    console.log("[BIRD RETRIEVAL] No bird retrieved")
  };
  let retrievedBirds : bird[] = retrievedPoints.map((item) => ({
    id: item.id as number,
    commonName: item.payload!.commonName as string,
    scientificName: item.payload!.scientificName as string,
    distribution: item.payload!.distribution as distributionCat[],
    habitat: item.payload!.habitat as habitatCat[],
    conservationStatus: item.payload!.conservationStatus as conservationStatusCat,
    description: item.payload!.description as string,
    wikiImageURL: item.payload!.wikiImageURL as string
  }));
  const birdsScores = retrievedPoints.map((item) => ({
    bird: item.payload!.commonName,
    rrfScore: rrfScores.get(item.payload!.commonName),
    denseScore: item.score
  }))
  const topDenseScore = birdsScores[0].denseScore
  const secondDenseScore = birdsScores[1].denseScore
  const maxRRFScore = [...rrfScores.values()][0]
  const secondRRFScore = [...rrfScores.values()][1]
  
  if (topDenseScore >= 0.605
    && (topDenseScore - secondDenseScore > 0.03 || 
      (birdsScores[0].rrfScore == maxRRFScore && maxRRFScore - secondRRFScore >= 0.3)
    )) {
    const retrievedBird = [retrievedBirds[0]]
    console.log("[BIRD RETRIEVAL] Getting Bird result:")
    console.table(birdsScores)
    return retrievedBird
  }
  console.log("[BIRD RETRIEVAL] Getting Bird result:")
  console.table(birdsScores)
  return retrievedBirds
};

export async function getBirdQuestion(birds: bird[], totalDescription: Proposition[]) : Promise<Question> {
  const birdDescriptions: string = birds
  .map(
    (bird) => `- ${bird.commonName}: ${bird.description}`)
  .join('\n');
  const descriptionsList: string = totalDescription
  .map(item => `- "${item.predicate}": "${item.argument}"`)
  .join("\n")
  const prompt:string = `
  You are a bird identification assistant.

  The following bird species are possible matches:
  ${birdDescriptions}

  The following information has already been given by the user. Each bullet point represents a predicate-argument pair, where the predicate identifies the type of information and the argument is the corresponding value:
  ${descriptionsList}

  Your task is to formulate the MOST DISCRIMINATING question that will help distinguish between these candidates and that the user has NOT ANSWERED YET.

  Instructions:
  Compare the candidate species' characteristics, based only on the provided descriptions.
  Consider the information already given by the user.
  Identify a visible characteristic that is not already given and best separates the candidates (such as colour, size, markings, or shape).
  NEVER use an already used predicate or generate a question for an established characteristic.
  Treat predicates as identifiers of characteristics. For example, if "bird_overall_colour" has already been provided, do not ask about overall colour again, even with a different wording.
  Ask about easily observable features such as plumage, head colour, beak shape, body size, legs length or similar.
  Avoid questions about characteristics shared by all candidates.
  Make the question short, clear, and easy for a non-expert to answer.
  Do not ask about a characteristic that cannot reasonably be inferred from the available descriptions.
  Do not name the bird species.
  Use ONLY open-ended or multiple-choice questions.
  NEVER ask yes/no questions.
  Return ONLY the question as a JSON object with the following structure:
  {
    "type": "whq",
    "predicate": predicate,
    "text": string
  }
  where "type" has only "whq" as allowed value
  where predicate is inferred and represents the question content, for instance "bird_overall_colour", "bird_overall_shape", "bird_crown_colour", "bird_crown_shape", "bird_beak_colour", "bird_beak_shape", "bird_legs_colour", "bird_legs_length", "bird_wings_pattern", "bird_tail_shape", "bird_tail_length".
  and where string is the question itself.

  Examples:
  Example A: 
  Already given information:
  - "bird_description": "it's a small bird with a blue crown"
  Invalid question output:
    {
      "type": "whq",
      "predicate": "bird_crown_colour",
      "text": "What colour is the bird's crown?"
    }
  Reason: The crown colour has already been described even if the predicate is available.
  Valid question output (provided it is the most discriminating):
  {
    "type": "whq",
    "predicate": "bird_beak_shape",
    "text": "What shape is the bird's beak?"
  }
  Reason: The beak shape has not been described, so this could provide new information.

  Example B: 
  Already given information:
  - "bird_description": "I see a big bird with long legs"
  - "bird_overall_colour": "The bird is white and grey"
  - "bird_additional_information" : "its legs are brown"
  Invalid question output:
    {
      "type": "whq",
      "predicate": "bird_legs_colour",
      "text": "What colour are the bird's legs?"
    }
  Reason: The legs colour has already been described even if the predicate is available.
  Valid question output (provided it is the most discriminating):
  {
    "type": "whq",
    "predicate": "bird_eyes_colour",
    "text": "What colour are the bird's eyes?"
  }
  Reason: The eyes colour has not been described, so this could provide new information.

  Example C: 
  Already given information:
  - "bird_description": "It looks like a woodpecker but bigger"
  - "bird_back_colour": "The back is green"
  Invalid question output:
    {
      "type": "whq",
      "predicate": "bird_back_colour",
      "text": "What colour is the bird's back?"
    }
  Reason: The back colour has already been described and the predicate is used.
  Valid question output (provided it is the most discriminating):
    "type": "whq",
    "predicate": "bird_nape_colour",
    "text": "What colour is the bird's nape?"
  }
  Reason: The nape colour has not been described, so this could provide new information.
`;

  console.log("[MORE INFO NEEDED] Getting bird question");
  const response = await openai.chat.completions
  .create({
        messages:[{ role:  "user" , content: prompt }],
        model:'llama3.1:latest',
        response_format: { type: "json_object" },
        temperature: 0 // for more predictable / consistent responses
     })
  .then((result) => result.choices[0].message.content)
  const usedPredicates = totalDescription.map(item => item.predicate)
  console.log(totalDescription)
  if (!response) {
    console.log("[MORE INFO NEEDED] Empty model response");
    return getFallBackQuestion(usedPredicates);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(response);
  } catch (error) {
    console.log("[MORE INFO NEEDED] Invalid JSON:", response);
    return getFallBackQuestion(usedPredicates);
  }
  if (!validateQuestion(parsed, totalDescription)) {
    console.log("[NLU] Invalid question structure or predicate:", parsed);
    return getFallBackQuestion(usedPredicates);
  }
  const question: Question = parsed
  console.log("[MORE INFO NEEDED] additional question to ask:", question);
  return question
};

function isQuestion(value: unknown): value is Question {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const question = value as Record<string, unknown>;
  return (
    question.type === "whq" &&
    typeof question.predicate === "string" &&
    question.predicate.trim().length > 0 &&
    typeof question.text === "string" &&
    question.text.trim().length > 0
  );
};

function validateQuestion(value: unknown, totalDescription: Proposition[]): value is Question {
  if (!isQuestion(value)) {
    return false;
  }
  const usedPredicates = totalDescription.map(item => item.predicate)
  return !usedPredicates.includes(value.predicate);
};

const fallBackQuestions: Question[] = [
    {
      type: "whq",
      predicate: "bird_additional_observation",
      text: "What else can you tell me about the bird?"
    },
    {
      type: "whq",
      predicate: "bird_other_characteristics",
      text: "What other characteristics have you noticed?"
    },
    {
      type: "whq",
      predicate: "bird_unspecified_detail",
      text: "Is there any other detail you can share about the bird?"
    }
  ];

function getFallBackQuestion(usedPredicates: string[]) {
  const availableQuestion = fallBackQuestions.find(
    question => !usedPredicates.includes(question.predicate)
  );
  return availableQuestion ?? fallBackQuestions[fallBackQuestions.length - 1]
};


export async function displayBirdImage(identifiedBird: bird): Promise<void> {
  const heading = document.querySelector<HTMLHeadingElement>("#bird-commonName");
  const image = document.querySelector<HTMLImageElement>("#bird-image");
  if (heading) {
    heading.textContent = identifiedBird.commonName;
  }
  if (!image) {
    return
  }
  // Use Wikipedia image as fallback
  let imageUrl = identifiedBird.wikiImageURL;
  try {
    const response = await fetch(
      `https://ornithophile.vercel.app/api/birds?scientific_name=${encodeURIComponent(identifiedBird.scientificName)}`
    );
    if (!response.ok) {
      throw new Error(`[BIRD IMAGE] Ornithophile API error: ${response.status}`);
    }
    const data = await response.json();
    const bird = data?.[0];
    // Use Ornithophile API image when available
    if (bird?.male_image) {
      imageUrl = bird.male_image;
    }
  } catch (error) {
    console.log("[BIRD IMAGE] Ornithophile API failed, falling back to Wikipedia image", error)
  }
  if (imageUrl) {
    if (imageUrl.startsWith("//upload.wikimedia.org")) {
      imageUrl = "https:" + imageUrl;
    }
    image.src = imageUrl;
    image.alt = identifiedBird.commonName
    image.style.display = "block";
  } else {
    console.log("[BIRD IMAGE] No image URL available");
  }
}
