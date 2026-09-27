I tested two things: how RAG works when the dialogue continues over several turns, and whether changing the document chunking strategy affects retrieval. I used the university of Gothenburg pages stored in the Qdrant and qwen3-embedding model for embeddings.

Multi-turn Rag:- In my first implementation, RAg query was created only from the latest message: 
const question = input.messages[input.messages.length - 1].content;
This worked for complete questions, but it caused problems with folllow-up questions. For example, after asking about help with academic writing, i asked "Book a meeting with that". The word "that" alone does not provide enough information for the vector search to understand what the user means.
I changed the code to include the last two user messages:
const question = input.messages .filter((message) => message.role === "user") .slice(-2) .map((message) => message.content) .join(" ");
This gave the RAG system come previous dialogue context when creating the query. In my test, the retrieved information was more related to the previous topic, and the llm was able to interpret the follow-up in relation to the earlier question.
However, this was not a complete solution because simply joining messages can still retieve some irrelevant information. A better solution could be to rewrite the follow-up question into a standalone question before performing retrieval.

Chunking Experiment: I also tested whether a different way of splitting documents would affect retrieval. The original RAG implementation uses 500-character chunks with 50-character overlap:
const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 500, chunkOverlap: 50, separators: ["\n\n\n", "\n\n", "\n", ". ", " "], });
I created a second chunking method that splits the document using paragraph boundries:
const makeParagraphChunksFromFile = async (filepath: string) => { const document = await readFile(filepath, "utf8"); const paragraphs = document .split(/\n\s*\n/) .map((paragraph) => paragraph.trim()) .filter((paragraph) => paragraph.length > 0); return paragraphs; };

I stored these chunks in a separte Qdrant collection called gu_paragraph, so the original collection was not changed.

For the query "What is the structure of an academic text?", the original collection returned a top similarity score of about 0.848, while the paragraph based collection returned about 0.828. Although the original score was higher, its retrieved text was cut off in the middle of the relevant section.
I also tested "What is IMRad?" The original collection returned about 0.771, while the pararaph-based collection returned about 0.749. Both retrieved the relevant IMRad section as the top result.
Therefore, the paragraph based strategy did not clearly improve retrieval in these tests. However, it showed that keeping semantic sections together can sometimes provide more complete context, even when the similarity score is slighlty lower.
Conclusion:
These experiments showed me that both dialogue context and chunking strategy can affect a RAG system. Using previous user messages helped with follow-up questions, while paragraph-based chunks sometimes preserved more complete information. However, neither experiment showed that the new approach was always better. 