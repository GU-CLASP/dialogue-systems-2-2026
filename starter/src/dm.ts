import { assign, createActor, fromPromise, setup } from "xstate";
import { Settings, speechstate } from "speechstate";
import { KEY } from "./credentials";
import { DMContext, DMEvents, Message } from "./types";
import { QdrantClient } from "@qdrant/js-client-rest";
import OpenAI from "openai";

const REGION = "germanywestcentral";

const qdrant = new QdrantClient({ host: "localhost", port: 6333 });

const embed = async (input: string) =>
  openai.embeddings
    .create({ model: "qwen3-embedding", input, dimensions: 384 })
    .then((result) => result.data[0].embedding);

const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  dangerouslyAllowBrowser: true,
});

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
    "add.system.prompt": assign(({ context }) => ({
      messages: [
        ...context.messages,
        {
          role: "system" as const,
          content: "You are a helpful, friendly assistant. Keep your responses brief and conversational, like a real chat. High emphasis on the responses being brief!! Do not output unprompted information. Do not mention that you are an AI model.",
        },
      ],
    })),
  },
  actors: {
    getChatCompletion: fromPromise<string, { messages: Message[] }>(
      async ({ input }) => {
        const completion = await openai.chat.completions.create({
          model: "llama3.1",
          messages: input.messages,
        });
        return completion.choices[0].message.content ?? "";
      },
    ),
    queryRAG: fromPromise<string[], { query: string }>(async ({ input }) => {
      const embedding = await embed(input.query);
      const result = await qdrant.query("gu-info", {
        with_payload: true,
        query: embedding,
        limit: 5,
      });
      return result.points.map((p) => (p.payload as { text: string }).text);
    }),
  },
}).createMachine({
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    lastResult: null,
    messages: [],
  }),
  id: "DM",
  initial: "Prepare",
  states: {
    Prepare: {
      entry: ({ context }) => context.spstRef.send({ type: "PREPARE" }),
      on: { ASRTTS_READY: "WaitToStart" },
    },
    WaitToStart: {
      on: { CLICK: "Loop" },
    },
    Loop: {
      entry: [
        "add.system.prompt",
        assign(({ context }) => ({
          messages: [...context.messages, { role: "assistant" as const, content: "Hello there!! What can I help you with?" }],
        })),
      ],
      initial: "Speaking",
      states: {
        Speaking: {
          entry: {
            type: "spst.speak",
            params: ({ context }) => ({
              utterance: context.messages[context.messages.length - 1].content,
            }),
          },
          on: { SPEAK_COMPLETE: "Ask" },
        },
        SpeakingAgain: {
          entry: {
            type: "spst.speak",
            params: ({ context }) => ({
              utterance: [context.messages[context.messages.length - 1].content, "Is there anything else I could help you with today?"].join(" "),
            }),
          },
          on: { SPEAK_COMPLETE: "Ask" },
        },
        Ask: {
          entry: { type: "spst.listen" },
          on: {
            RECOGNISED: {
              actions: assign(({ context, event }) => ({
                messages: [...context.messages, { role: "user" as const, content: event.value[0].utterance }],
              })),
            },
            ASR_NOINPUT: "WaitReadyNoInput",
            LISTEN_COMPLETE: "WaitReadyRetrieve",
          },
        },
        WaitReadyNoInput: {
          on: { ASRTTS_READY: "NoInput", SPEAK_COMPLETE: "NoInput" },
        },
        NoInput: {
          entry: {
            type: "spst.speak",
            params: { utterance: "Sorry, I didn't catch that. Could you say that again?" },
          },
          on: { SPEAK_COMPLETE: "Ask" },
        },
        WaitReadyRetrieve: {
          on: { ASRTTS_READY: "Retrieve", SPEAK_COMPLETE: "Retrieve" },
        },
        Retrieve: {
          invoke: {
            src: "queryRAG",
            input: ({ context }) => ({
              query: context.messages[context.messages.length - 1].content,
            }),
            onDone: {
              target: "ChatCompletion",
              actions: assign(({ context, event }) => ({
                messages: [
                  {
                    role: "system" as const,
                    content: `You are a helpful assistant for GU students. Use the following retrieved information to answer, if relevant:\n\n${event.output.join("\n\n")}`,
                  },
                  ...context.messages.filter((m) => m.role !== "system"),
                ],
              })),
            },
          },
        },
        ChatCompletion: {
          invoke: {
            src: "getChatCompletion",
            input: ({ context }) => ({ messages: context.messages }),
            onDone: {
              target: "SpeakingAgain",
              actions: assign(({ context, event }) => ({
                messages: [...context.messages, { role: "assistant" as const, content: event.output }],
              })),
            },
          },
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
