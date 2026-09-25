import { assign, createActor, fromPromise, setup } from "xstate";
import { Settings, speechstate } from "speechstate";
import { PROXY_KEY } from "./credentials";
import { DMContext, DMEvents, Message } from "./types"; // added Message
import OpenAI from "openai";
import { QdrantClient } from "@qdrant/js-client-rest"; // importing qdrant

const REGION = "northeurope";

const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  dangerouslyAllowBrowser: true,
});

// embedding helper function: converting text into 384-dimensional vector
const embed = async (input: string) =>
  openai.embeddings
    .create({
      model: "qwen3-embedding",
      input,
      dimensions: 384,
    })
    .then((result) => result.data[0].embedding);

// creating qdrant client
const qdrant = new QdrantClient({
  host: "localhost",
  port: 6333,
});

// wasn't able to use this
/**const azureCredentials = {
  endpoint: `https://${REGION}.api.cognitive.microsoft.com/sts/v1.0/issuetoken`,
  key: KEY,
};
**/

// backup: Azure access via FLoV proxy
const azureProxyCredentials = {
  proxyUrl: "https://rndserv.flov.gu.se:4000/api/token",
  key: PROXY_KEY,
};

const settings: Settings = {
  azureCredentials: azureProxyCredentials,
  azureRegion: REGION,
  asrDefaultCompleteTimeout: 0,
  asrDefaultNoInputTimeout: 5000,
  locale: "en-US",
  ttsDefaultVoice: "en-US-DavisNeural",
  bargeIn: false,
};

const dmMachine = setup({
  types: {
    /** you might need to extend these */
    context: {} as DMContext,
    events: {} as DMEvents,
  },
  actions: {
    /** define your actions here */
    "spst.speak": ({ context }, params: { utterance: string }) =>
      context.spstRef.send({
        type: "SPEAK",
        value: {
          utterance: params.utterance,
        },
      }),
    "spst.listen": ({ context }) =>
      context.spstRef.send({
        type: "LISTEN",
      }),
  },
  actors: {

    // adding the generation step: current dialogue history -> LLM + returns text response
    fetchLLM: fromPromise<string, { messages: Message[] }>(
      async ({ input }) => {
        //console.log("Actor input:", input);

        const response = await openai.chat.completions.create({
          model: "llama3.2:latest",
          messages: input.messages,
        });

      //console.log("LLM response:", response);

      return response.choices[0].message.content ?? "";
      },
    ),

    // adding the retrieval step: input: user query -> embedded, output: relevant text from qdrant
    queryRAG: fromPromise<string, { query: string }>(
      async ({ input }) => {
        const embedding = await embed(input.query);

        const result = await qdrant.query("gu-support", {
          query: embedding,
          with_payload: true,
          limit: 3,
        });
      
        // turning returned payloads into one text block
        const retrievedText = result.points
          .map((point) => point.payload?.text)
          .filter((text): text is string => typeof text === "string")
          .join("\n\n");

        return retrievedText;
      },
    ),
  },
}).createMachine({
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),

    // storing ASR results for current turn -> resets before going back to listening
    lastResult: null,

    // dialogue history across multiple turns
    messages: [
      {
        role: "system",
        content:
          "You are a helpful assistant for University of Gothenburg students.",
      },
    ] as Message[],
    retrievedContext: "", // to store Qdrant text for current query
  }),
  id: "DM",
  initial: "Prepare",
  states: {
    Prepare: {
      entry: ({ context }) => context.spstRef.send({ type: "PREPARE" }),
      on: { ASRTTS_READY: "WaitToStart" },
    },
    WaitToStart: {
      on: { CLICK: "Greeting" },
    },
    Greeting: {
      initial: "Prompt",
      on: {
        LISTEN_COMPLETE: [
          {
            target: "Retrieve",
            guard: ({ context }) => !!context.lastResult,
          },
          { target: ".NoInput" },
        ],
      },
      states: {
        Prompt: {
          entry: { type: "spst.speak", params: { utterance: `Hello, what can I do for you today?` } },
          on: { SPEAK_COMPLETE: "Ask" },
        },
        NoInput: {
          entry: {
            type: "spst.speak",
            params: { utterance: `Is there something on your mind?` },
          },
          on: { SPEAK_COMPLETE: "Ask" },
        },
        Ask: {
          entry: [
            assign({ lastResult: null }), // resetting lastResult
            { type: "spst.listen" },
          ],
          on: {
            RECOGNISED: {
              actions: assign(({ context, event }) => {
                const utterance = event.value[0].utterance; // extracting what the user said

                return {
                  lastResult: event.value,
                  messages: [
                    ...context.messages, // appending to convo history
                    {
                      role: "user" as const, // as user message
                      content: utterance,
                    },
                  ],
                };
              }),
            },
            ASR_NOINPUT: {
              actions: assign({ lastResult: null }),
            },
          },
        },
      },
    },
    Retrieve: { // invoking queryRAG to pass latest user utterance
      invoke: {
        src: "queryRAG",
        input: ({ context }) => ({
          query: context.lastResult![0].utterance,
        }),
        onDone: {
          actions: [
            
            // storing the retrieved info
            assign({
              retrievedContext: ({ event }) => event.output,
            }),
          
            ({ event }) => {
              console.log("Retrieved context:", event.output);  // control log
            },
          ],

          target: "GetCompletion",
        },
      },
    },
    GetCompletion: {
      invoke: {
        src: "fetchLLM",
        input: ({ context }) => ({
          messages: [
            {
              role: "system" as const,

              // adding the augmentation step: retrieved qdrant context -> system prompt
              content: `
          Use the retrieved information below to answer the user's question.
          If the answer is not supported by the retrieved information, 
          please let the user know that you do not have enough information to answer the question.

          RETRIEVED INFORMATION START

          ${context.retrievedContext}

          RETRIEVED INFORMATION END
                      `,
            },
            ...context.messages
          ],
        }),
        onDone: {
          actions: assign({
            messages: ({ context, event }) => [
              ...context.messages,
              {
                role: "assistant",
                content: event.output,
              },
            ],
        }),
        target: "SpeakResponse",
        },
      },
    },
    SpeakResponse: {
      entry: {
        type: "spst.speak",
        params: ({ context }) => ({
          utterance: context.messages[context.messages.length - 1].content,
        }),
      },
      on: {
        SPEAK_COMPLETE: {
          target: "Greeting.Ask",
        },
      },
    },
  },
});

const dmActor = createActor(dmMachine, {}).start();

dmActor.subscribe((state) => {
  console.group("State update");
  console.log("State value:", state.value);
  console.log("State context:", state.context);
  console.groupEnd();
});

export function setupButton(element: HTMLButtonElement) {
  element.addEventListener("click", () => {
    dmActor.send({ type: "CLICK" });
  });
  dmActor.subscribe((snapshot) => {
    const meta: { view?: string } = Object.values(
      snapshot.context.spstRef.getSnapshot().getMeta(),
    )[0] || {
      view: undefined,
    };
    element.innerHTML = `${meta.view}`;
  });
}
