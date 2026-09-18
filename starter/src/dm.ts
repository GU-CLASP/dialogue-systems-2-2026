import { assign, createActor, fromPromise, setup } from "xstate";
import { Settings, speechstate } from "speechstate";
import { KEY } from "./credentials";
import { DMContext, DMEvents, Message } from "./types";
import OpenAI from "openai";

import { QdrantClient } from "@qdrant/js-client-rest"; // importing the qdrant client

const REGION = "swedencentral";
const COLLECTION_N = "gu_support"; // the collection name I defined in Qdrant

const systemPrompt: Message = { // to tell at first to LLM how to behave
  role: "system",
  content: "You are a friendly, helpful voice assistant. Keep responses very brief.",
}; // so sort of instruction to the model

const greeting: Message = { // for speechstate to speak at first
  role: "assistant",
  content: "Hello world!", // so the first assistant message is hello world
}

// llm client (creates an api client)
const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/", // port 11434
  apiKey: "ollama",
  dangerouslyAllowBrowser: true,
}); // the clinet api is used for two things: one chat completion where we use llama3.1 and two for embeddings using qwen3-embedding (so one client proposes two different models)

const azureCredentials = {
  endpoint: `https://${REGION}.api.cognitive.microsoft.com/sts/v1.0/issuetoken`,
  key: KEY,
};

// to connect to our local Qdrant database
const qdrant = new QdrantClient({ host: "localhost", port: 6333 });

// our embedding function (so input is a string and output the embedding vector)
const embed = async (input: string) =>
  openai.embeddings.create({
    model: "qwen3-embedding",
    input: input,
    dimensions: 384, // 384 numbers
  }).then((result) => result.data[0].embedding);

/** backup: Azure access via FLoV proxy
const azureProxyCredentials = {
  proxyUrl: "https://rndserv.flov.gu.se:4000/api/token",
  key: "",
  };
*/

const settings: Settings = {
  azureCredentials: azureCredentials,
  azureRegion: REGION,
  asrDefaultCompleteTimeout: 0,
  asrDefaultNoInputTimeout: 5000,
  locale: "en-US",
  ttsDefaultVoice: "en-US-DavisNeural",
  bargeIn: false,
};
// Helper functions ----------------------

// llm helper function (sends the message to llm)
async function chatCompletion(messages: Message[]): Promise<string> {
  const response = await openai.chat.completions.create({ // sending the request to ollama and waiting for the llm respond before moving on
    model: "llama3.1",
    messages: messages, // we send the messages to llama which is out conversation history
  });
  return response.choices[0].message.content ?? ""; // and then take the first generated response
}

// it gets the users question and fetch the most relavant chunks from qdrant
async function retrieve(query: string): Promise<string> {
  const embedding = await embed(query); // make the query embedded
  const results = await qdrant.query(COLLECTION_N, { // search qdrant in the collection we defined
    query: embedding,
    with_payload: true, // return the stored text as well
    limit: 3, // finds 3 most relevant chunks
  });
  return results.points
    .map((p) => (p.payload as { text: string }).text) // extract only texts
    .join("\n\n") // so returns a single text block
}

const dmMachine = setup({
  types: {
    /** you might need to extend these */
    context: {} as DMContext,
    events: {} as DMEvents,
  },
  actions: {
    /** define your actions here */
    "spst.speak": ({ context }) =>
      context.spstRef.send({
        type: "SPEAK",
        value: {
          utterance: context.messages[context.messages.length - 1].content, // for it to speak the last message to the user
        },
      }),
    "spst.listen": ({ context }) =>
      context.spstRef.send({
        type: "LISTEN",
      }),
    // append action for appending new message to the history (so updating context)
    append: assign(({ context }, params: { message: Message }) => ({
      messages: [...context.messages, params.message],
    })),
  },
  actors: {
    // chatCompletion actor
    // this is the actor that machine can invoke
    chatCompletion: fromPromise<string, Message[]>(async ({ input }) => {
      return await chatCompletion(input); // when the actor starts -> take its input, pass it to our chatCompletion() function and wait for the result and then return it
    }),

    // retrieve actor
    retrieve: fromPromise<string, string>(
      async ({ input }) => { // for retrieving relevant info from qdrant
        return await retrieve(input);
      })
  },
}).createMachine({
  // initial context (will be created when the machine starts)
  context: ({ spawn }) => ({ // spawn creates another actor
    spstRef: spawn(speechstate, { input: settings }),
    lastResult: null,
    messages: [systemPrompt], // so initally the message history contains only the system prompt that we created up there
    retrievedContext: "", // the retrieved context from qdrant would be stored here
  }),

  id: "DM",
  initial: "Prepare",

  states: {
    // ---------------------- Prepare State
    Prepare: {
      entry: ({ context }) => context.spstRef.send({ type: "PREPARE" }), // initialize speech recognition and text-to-speech services
      on: { ASRTTS_READY: "WaitToStart" },
    },
    // --------------------- Wait To Start State
    WaitToStart: {
      on: { CLICK: "Loop" },
    },

    // -------------------- Loop State
    Loop: { // the whole thing is in a loop state
      entry: { // when we enter the loop we execute the append action first for adding the greeting thing to message history 
        type: "append",
        params: { message: greeting }, // so after entering the loop state our massages would have first system prompt and then this greeting thing
      },
      initial: "Speaking",

      // ------ states inside the loop state
      states: { // we have four states in the loop

        // -------------------- Speaking State
        Speaking: {
          entry: {
            type: "spst.speak" // so speaking the last message in the history to user
          },
          on: {
            SPEAK_COMPLETE: "Ask"
          },
        },

        // -------------------- Ask State
        Ask: {
          entry: {
            type: "spst.listen" // entering this state it would listen to user
          },
          on: {
            RECOGNISED: { // it recognized what the user said
              actions: {
                type: "append",
                params: ({ event }) => ({ // it appends what the user said to the messages
                  message: {
                    role: "user",
                    content: event.value[0].utterance
                  },
                }),
              },
            },
            ASR_NOINPUT: {
              actions: assign({ lastResult: null }), // if nothing was recognized
            },
            LISTEN_COMPLETE: [
              {
                target: "Retrieve",
                guard: ({ context }) => context.messages[context.messages.length - 1].role === "user", // if the last message saved in the history was from user (which means it is the systems turn now)
              },
              {
                target: "Speaking" // if there is no user input then just re prompt
              },
            ], // if the listening was complete we move to last state
          },
        },

        // -------------------- Retrieve State
        Retrieve: { // rag part
          invoke: { // entering this state would start an actor
            id: "retrieve",
            src: "retrieve", // so use this actor
            input: ({ context }) => 
              context.messages[
                context.messages.length - 1
              ].content, // the last message's context (the users latest question)
            onDone: { // when Qdrant retrieval seucceeds
              actions: assign(({ event }) => ({ 
                retrievedContext: event.output // the string returned by retrieve()
              })), // when it is done put hte retrieved docs in the variable we defined in context at first
              target: "ChatCompletion", // we move to llm generation
            },
            onError: { // if qdrant fails
              actions: [
                ({ event }) => 
                  console.error("Retrieval failed:", event.error), // if there is an error print it
                assign({ retrievedContext: "" }), // proceed without retrieved context
              ],
              target: "ChatCompletion", // llm answers without GU context
            },
          },
        },

        // -------------------- ChatCompletion State
        ChatCompletion: { // in this state we call the LLM
          invoke: { // start an actor while this state is active
            id: "chatCompletion", // invoke id
            src: "chatCompletion", // actor source
            input: ({ context }) => { // we sill build an augmented input
              const augmentedSystem: Message = { // we want to fold the retrieved context into a system message, without messing up the stored conversation history
                role: "system",
                content:
                  `${systemPrompt.content}\n\n` +
                  `Use the following information from GU's student portal if it helps answer the user's question.` +
                  `if it isn't relevant, ignore it and answer normally.\n\n` +
                  context.retrievedContext,
              };
              return [augmentedSystem, ...context.messages.slice(1)]; // take everything except index 0
            },
            onDone: { // when the promise actor completed successfully, we know actor would return a string
              actions: {
                type: "append",
                params: ({ event }) => ({ // we append what the actor returned (which is llamas response) to the messages
                  message: {
                    role: "assistant",
                    content: event.output
                  },
                }),
              },
              target: "Speaking", // so when it goes to speaking now it would speak the llamas answer which is the last item in messages
            },
            onError: { // if the llm promise fails
              actions: ({ event }) => console.error(event.error), // we print the error to the browser console
              target: "Speaking",
            },
          },
        },
      },
    },
  },
});

const dmActor = createActor(dmMachine, {}).start();

dmActor.subscribe((state) => { // every time the machine's state changes call this function
  console.group("State update");
  console.log("State value:", state.value);
  console.log("State context:", state.context);
  console.groupEnd();
});

export function setupButton(element: HTMLButtonElement) {
  element.addEventListener("click", () => {
    dmActor.send({ type: "CLICK" });
  });
  dmActor.subscribe((snapshot) => { // snapchot is the machines current state
    const meta: { view?: string } = Object.values(
      snapshot.context.spstRef.getSnapshot().getMeta(),
    )[0] || {
      view: undefined,
    };
    element.innerHTML = `${meta.view}`;
  });
}
