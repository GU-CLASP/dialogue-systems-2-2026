import { answerWithRAG } from "./rag";

async function main() {
  const tests = [
    {
      breed: "Whippet",
      question: "How much grooming does it need?"
    },
    {
      breed: "Labrador Retriever",
      question: "How much exercise does it need?"
    },
    {
      breed: "Whippet",
      question: "Is it suitable for apartment living?"
    },
    {
      breed: "Affenpinscher",
      question: "Does it need much grooming?"
    }
  ];

  for (const test of tests) {
    console.log("\n----------------------");
    console.log("Breed:", test.breed);
    console.log("Question:", test.question);

    try {
      const answer = await answerWithRAG(test.breed, test.question);

      console.log("Answer:", answer);
    } catch (error) {
      console.error("RAG error:", error);
    }
  }
}

main();
