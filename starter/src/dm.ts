import { assign, createActor, fromPromise, setup } from "xstate";
import { Settings, speechstate } from "speechstate";
import { KEY } from "./credentials";
import { DMContext, DMEvents, Message } from "./types";
import OpenAI from "openai";
import { QdrantClient } from "@qdrant/js-client-rest";

const REGION = "switzerlandnorth";

const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  dangerouslyAllowBrowser: true,
});

const qdrant = new QdrantClient({
  host: "localhost",
  port: 6333,
});

const embed = async (input: string) =>
  openai.embeddings
    .create({
      model: "qwen3-embedding",
      input: input,
      dimensions: 384,
    })
    .then((result) => result.data[0].embedding);

const azureCredentials = {
  endpoint: `https://${REGION}.api.cognitive.microsoft.com/sts/v1.0/issuetoken`,
  key: KEY,
};

const settings: Settings = {
  azureCredentials: azureCredentials,
  azureRegion: REGION,
  asrDefaultCompleteTimeout: 0,
  asrDefaultNoInputTimeout: 5000,
  locale: "en-US",
  ttsDefaultVoice: "en-US-DavisNeural",
  bargeIn: false,
};

const dmMachine = setup({
  types: {
    context: {} as DMContext,
    events: {} as DMEvents,
  },

  actions: {
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
    getCompletion: fromPromise(
      async ({ input }: { input: Message[] }) => {
        const completion = await openai.chat.completions.create({
          model: "llama3.2:latest",
          messages: input,
        });

        return completion.choices[0].message.content;
      },
    ),
    getDocuments: fromPromise(
      async ({ input }: { input: string }) => {
        const embedding = await embed(input);

        const results = await qdrant.query("gu", {
          with_payload: true,
          query: embedding,
          limit: 5,
      });

    return results.points;
  },
), 
  },


}).createMachine({
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    lastResult: null,
    messages: [],
    documents: [],
  }),

  id: "DM",
  initial: "Prepare",

  states: {
    Prepare: {
      entry: ({ context }) =>
        context.spstRef.send({ type: "PREPARE" }),

      on: {
        ASRTTS_READY: "WaitToStart",
      },
    },

    WaitToStart: {
      on: {
        CLICK: "Greeting",
      },
    },

    Greeting: {
      initial: "Prompt",

      on: {
        LISTEN_COMPLETE: [
          {
            target: "RetrieveDocuments",
            guard: ({ context }) => !!context.lastResult,
          },
          {
            target: ".NoInput",
          },
        ],
      },

      states: {
        Prompt: {
          entry: {
            type: "spst.speak",
            params: {
              utterance: "Hello! What would you like to talk about?",
            },
          },

          on: {
            SPEAK_COMPLETE: "Ask",
          },
        },

        NoInput: {
          entry: {
            type: "spst.speak",
            params: {
              utterance: "I can't hear you!",
            },
          },

          on: {
            SPEAK_COMPLETE: "Ask",
          },
        },

        Ask: {
          entry: {
            type: "spst.listen",
          },

          on: {
            RECOGNISED: {
              actions: assign(({ context, event }) => ({
                lastResult: event.value,

                messages: [
                  ...context.messages,
                  {
                    role: "user",
                    content: event.value[0].utterance,
                  },
                ],
              })),
            },

            ASR_NOINPUT: {
              actions: assign({
                lastResult: null,
              }),
            },
          },
        },
      },
    },

GetResponse: {
  invoke: {
    src: "getCompletion",

    input: ({ context }) => [
      {
        role: "system",
        content: `Use the following University of Gothenburg information to answer the user's question.
If the answer is not in the provided information, say that you do not know.

Information:
${context.documents.join("\n\n")}`,
      },
      ...context.messages,
    ],

    onDone: {
      target: "SpeakResponse",

      actions: assign(({ context, event }) => ({
        messages: [
          ...context.messages,
          {
            role: "assistant",
            content: event.output ?? "",
          },
        ],
      })),
    },

    onError: {
      target: "Done",
      actions: ({ event }) => {
        console.error("LLM error:", event.error);
      },
    },
  },
},

    RetrieveDocuments: {
  invoke: {
    src: "getDocuments",

    input: ({ context }) =>
      context.lastResult?.[0].utterance ?? "",

    onDone: {
      target: "GetResponse",

      actions: assign(({ event }) => ({
        documents: event.output
          .map((point) => point.payload?.text)
          .filter((text): text is string => typeof text === "string"),
      })),
    },

    onError: {
      target: "GetResponse",

      actions: ({ event }) => {
        console.error("Qdrant error:", event.error);
      },
    },
  },
},

    SpeakResponse: {
      entry: {
        type: "spst.speak",

        params: ({ context }) => ({
          utterance:
            context.messages[context.messages.length - 1].content,
        }),
      },

      on: {
        SPEAK_COMPLETE: "#DM.Greeting.Ask",
      },
    },

    Done: {
      on: {
        CLICK: "Greeting",
      },
    },
  },
});

const dmActor = createActor(dmMachine, {}).start();

dmActor.subscribe((state) => {
  console.group("State update");
  console.log("State value:", state.value);
  console.log("State context:", state.context.messages);
  console.groupEnd();
});

export function setupButton(element: HTMLButtonElement) {
  element.addEventListener("click", () => {
    dmActor.send({ type: "CLICK" });
  });

  dmActor.subscribe((snapshot) => {
    const meta: { view?: string } =
      Object.values(
        snapshot.context.spstRef.getSnapshot().getMeta(),
      )[0] || {
        view: undefined,
      };

    element.innerHTML = `${meta.view}`;
  });
}