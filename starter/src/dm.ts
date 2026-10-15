import { assign, createActor, fromPromise, setup } from "xstate";
import { Settings, speechstate } from "speechstate";
import { KEY } from "./credentials";
import { DMContext, DMEvents, Message } from "./types";
import { QdrantClient } from "@qdrant/js-client-rest";
import OpenAI from "openai";

const client = new QdrantClient({ host: "localhost", port: 6333 });
const RAGcollection = "lab1_step3";

const REGION = "swedencentral";

const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  dangerouslyAllowBrowser: true,
});

const azureCredentials = {
  endpoint: `https://${REGION}.api.cognitive.microsoft.com/sts/v1.0/issuetoken`,
  key: KEY,
};

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
  ttsDefaultVoice: "en-US-AvaNeural",
  bargeIn: false,
};

// note: I tried using gemma4 as my LLM, but the answers were too long and more robot-y
const OLLAMA = "llama3.2"

const SYS_PROMPT: Message = {
  role: "system",
  content: "" // this will get overwritten with the actual system prompt later
};

const embed = async (input: string) =>
  openai.embeddings
    .create({
      model: "qwen3-embedding",
      input: input,
      dimensions: 384,
    })
    .then((result) => result.data[0].embedding);


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
    getSystemResponse: fromPromise<string, { messages: Message[] }>(
      async ({input}) => {
        const completion = await openai.chat.completions.create({
          model: OLLAMA,
          messages: input.messages,
        });
        return completion.choices[0].message.content ?? "";
      },
    ),
    queryRAG: fromPromise<any[], {query: string}>(async ({input}) => {
      const embedding = await embed(input.query);
      const result = await client.query(RAGcollection, {
        query: embedding,
        with_payload: true,
        limit: 5,
      });
      return result.points;
    }),
  },
}).createMachine({
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    lastResult: null,
    messages: [SYS_PROMPT],
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
      entry: { type: "spst.speak", params: { utterance: `Hello I am a chat bot, let's talk about something!` } },
      on: { SPEAK_COMPLETE: "SystemAsk" },
    },
    SystemAsk: {
      entry: { type: "spst.listen" },
      on: {
        RECOGNISED: {
          target: "FetchFromRAG",
          actions: assign(({ context, event }) => ({
            lastResult: event.value,
            messages: context.messages.concat({role: "user", content: event.value[0].utterance } as Message),
          })),
        },
        ASR_NOINPUT: {
          target: "NoInput",
          actions: assign({ lastResult: null }),
        },
      }
    },
    NoInput: {
      entry: {
        type: "spst.speak",
        params: { utterance: `I can't hear you!` },
      },
      on: { SPEAK_COMPLETE: "SystemAsk" },
    },
    FetchFromRAG: {
      invoke: {
        id: "queryRAG",
        src: "queryRAG",
        input: ({ context }) => ({
          query: context.lastResult ? context.lastResult[0].utterance : "",
        }),
        onDone: {
          target: "GetSystemResponse",
          actions: assign(({context, event}) => {
            const points = event.output;
            const relevantInfo = points.map((p:any) => p.payload?.text).filter(Boolean).join("\n\n");
            const newSysMessage: Message = {
              role: "system",
              content: ` You are a helpful chat system who can have a natural conversation with a user and retrieve useful factual and accurate information.
      If useful information is contained in the pages below, answer the user in a short and concise manner:
      
      INFORMATION START

      ${relevantInfo || "no information found"}
      
      INFORMATION END

      Please be brief and do not mention anything which is not backed up by the information provided.`,
            };
            return {
              messages: [newSysMessage].concat(context.messages.slice(1)),
            };
          }),
        },
        onError: {
          target: "GetSystemResponse",
          actions: ({event}) => console.error("RAG Retrieval Error: ", event.error),
        },
      },
    },
    GetSystemResponse: {
      invoke: {
        id: "getResponse",
        src: "getSystemResponse",
        input: ({ context }) => ({ messages: context.messages }),
        onDone: {
          target: "SystemRespond",
          actions: assign(({ context, event }) => ({
            messages: context.messages.concat({role:"assistant", content: event.output } as Message),
          })),
        },
        onError: {
          target: "SystemRespond",
          actions: [
            ({ event }) => console.error("LLM error:", event.error),
            assign(({ context }) => ({
              messages: context.messages.concat({ role:"assistant", content: "Error connecting to the agent."} as Message),
            })),
          ],
        },
      },
    },
    SystemRespond: {
      entry: {
        type: "spst.speak",
        params: ({ context }) => ({
          utterance: context.messages[context.messages.length-1].content,
        }),
      },
      on: {SPEAK_COMPLETE: "SystemAsk"},
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
