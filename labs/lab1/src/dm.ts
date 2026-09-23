import { assign, createActor, fromPromise, setup } from "xstate";
import type { Settings} from "speechstate";
import { speechstate } from "speechstate";
import { KEY } from "./azure";
import type { DMContext, DMEvents, Message } from "./types";
import OpenAI from "openai";
import { QdrantClient } from "@qdrant/js-client-rest";

const REGION = "germanywestcentral";

const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  dangerouslyAllowBrowser: true,
});

const azureCredentials = {
  endpoint: `https://${REGION}.api.cognitive.microsoft.com/sts/v1.0/issuetoken`,
  key: KEY,
};

const client = new QdrantClient({
  host: "localhost",
  port: 6333,
});

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
};

interface CompletionInput {
    messages: Message[]
  };

interface RetrivalInput {
    query: string
};

const embed = async (input:string) => {
  const result = await openai.embeddings.create({
    model: "qwen3-embedding",
    input: input,
    dimensions: 384
  });
  return result.data[0].embedding;
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
    GetInformation: fromPromise(
      async({ input }: {input: RetrivalInput}) => {
        const embedding = await embed(input.query);

        const results = await client.query("GUCollection", {
          with_payload: true,
          query: embedding,
          limit: 5,
        });

        const retrievedText = results.points
        .map((point:any)=>point.payload?.text)
        .filter((text:any): text is string => typeof text === "string")
        .join("\n\n");

        return retrievedText;
      },
    ),
    getCompletion: fromPromise(
        async({ input }: { input: CompletionInput }) => {
          const response = await openai.chat.completions.create({
            model: "llama3.1",
            messages: input.messages,
          });

          const content = response.choices[0].message.content;
          if (content === null) {
            throw new Error("The model didn't respond.");
          } 
          return content;
      }
    ),
  },
}).createMachine({
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    lastResult: null,
    nextUtterance: "",
    retrievedText: "",
    messages: [
      {
      role: "system",
      content: "You are a voice assistant. Answer in short, helpful and kind responses."
      },
    ],
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
            target: "RetrieveInformation",
            guard: ({ context }) => !!context.lastResult,
          },
          { target: ".NoInput" },
        ],
      },
      states: {
        Prompt: {
          entry: { type: "spst.speak", params: { utterance: `What's up?` } },
          on: { SPEAK_COMPLETE: "Ask" },
        },
        NoInput: {
          entry: {
            type: "spst.speak",
            params: { utterance: `I can't hear you!` },
          },
          on: { SPEAK_COMPLETE: "Ask" },
        },
        Ask: {
          entry: { type: "spst.listen" },
          on: {
            RECOGNISED: {
              actions: assign(({ context, event }) => {
                const utterance = event.value[0].utterance;
                
                return { 
                  lastResult: event.value ,
                  messages: [
                    ...context.messages,
                    {
                      role: "user",
                      content: utterance,
                    }
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
    
    Done: {
      on: {
        CLICK: "Greeting",
      },
    },
    
    RetrieveInformation: {
      invoke: {
        src: "GetInformation",
        input: ({ context }) => ({
          query: context.messages[context.messages.length -1].content,
        }),

        onDone: {
          target: "GetCompletion",

          actions: assign({
            retrievedText: ({ event }) =>event.output
,          }),
        },
        onError: {
          target: "GetCompletion",

        actions: ({event}) => {
          console.error("Error with Qdrant", event.error);
          },
        },
      },
    },

    GetCompletion: {
      invoke: {
        src: "getCompletion",
        input: ({context}) => ({
          messages: [
            {
              role: "system",
              content: `You are a assistant for students at the University of Gothenburg.
              Answer in short and helpful responses. Always stay kind. 
              Use the following information to answer the user's question:
              ${context.retrievedText}
              If this information doesn't answer the user's question say that you don't know the answer.
              `
            }, 
            ...context.messages.filter(
              (message) => message.role !== "system",
            ),
          ],
        }),

        onDone: {
          target: "SpeakResponse",

          actions: assign(({context, event}) => ({
            nextUtterance: event.output, 
            messages: [
              ...context.messages,
              {
                role: "assistant",
                content: event.output,
              },
            ],
          })),
        },
        onError:{
          actions: ({event}) => {
            console.error("LLM error:", event.error);
          },
        },
      },
    },

    SpeakResponse: {
      entry: {
        type: "spst.speak",

        params: ({context}) => ({
          utterance: context.nextUtterance,
        }),
      },

      on: {
        SPEAK_COMPLETE: "Greeting.Ask"
      }
    }

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
