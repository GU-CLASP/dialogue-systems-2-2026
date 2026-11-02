import { QdrantClient } from "@qdrant/js-client-rest";
import OpenAI from "openai";


const client = new QdrantClient({
  host: "localhost",
  port: 6333,
});

const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  dangerouslyAllowBrowser: true, // we call Ollama directly from the browser, no backend
});

const COLLECTION = "dog_breeds";

function normalizeBreedName(name: string): string {// so that they match the breed metadata stored in qdrant
  return name.trim().toLowerCase().replace(/_/g, " ");
}

// what the LLM says when the documents don't answer the question
const NO_ANSWER = "NO_ANSWER";

// Generate an embedding using the same model as indexing
async function embed(input: string): Promise<number[]> {
  const result = await openai.embeddings.create({
    model: "qwen3-embedding",
    input,
    dimensions: 384,
  });

  return result.data[0].embedding;
}

// Retrieve information and generate an answer
// returns null when the knowledge base has nothing about this breed or the retrieved documents don't answer the question
export async function answerWithRAG(breedName: string, question: string): Promise<string | null> {

  const breed = normalizeBreedName(breedName);

  console.log("RAG breed:", breed);
  console.log("RAG question:", question);

  // Embed the user's question
  const embedding = await embed(question);

  // Search Qdrant, filtering by the selected breed
  const results = await client.query(COLLECTION, {
    query: embedding,
    with_payload: true,
    limit: 4,
    filter: {
      must: [
        {
          key: "breed",
          match: {
            value: breed,
          },
        },
      ],
    },
  });

  //extract retrieved document text
  const documents = results.points
    .map(point => point.payload?.text)
    .filter((text): text is string => typeof text === "string");

  console.log("RAG documents found:", documents.length);

  // No information for this breed
  if (documents.length === 0) {
    return null;
  }

  // Combine the retrieved documents
  const context = documents.join("\n\n");

  // Ask Ollama to answer using only retrieved information
  const completion = await openai.chat.completions.create({
    model: "llama3.1:latest",
    temperature: 0,

    messages: [
      {
        role: "system",
        content: `
        You are a helpful dog breed assistant.

        Answer the user's question using ONLY the retrieved
        information provided below.

        Rules:
        - Do not invent facts.
        - Do not use outside knowledge.
        - If the retrieved information does not answer the question,
          reply with exactly ${NO_ANSWER} and nothing else.
        - Keep your answer brief and natural for spoken dialogue.
        - Answer in 1 to 3 sentences.

        Retrieved information:
        ${context}
        `
      },
      {
        role: "user",
        content: `Breed: ${breedName}\nQuestion: ${question}`
      }
    ]
  });

  const answer = completion.choices[0]?.message?.content?.trim();

  if (!answer || answer.includes(NO_ANSWER)) {
    return null;
  }

  return answer;
}
