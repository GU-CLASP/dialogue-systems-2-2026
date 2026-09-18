import { assign, createActor, fromPromise, setup } from "xstate";
import { Settings, speechstate } from "speechstate";
import { KEY } from "./credentials";
import { DMContext, DMEvents, Message } from "./types";
import OpenAI from "openai";

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
  content: "hello! this is the system speaking"
};

interface GrammarEntry {
  person?: string;
  day?: string;
  time?: string;
}

const grammar: { [index: string]: GrammarEntry } = {
  vlad: { person: "Vladislav Maraev" },
  bora: { person: "Bora Kara" },
  tal: { person: "Talha Bedir" },
  tom: { person: "Tom Södahl Bladsjö" },
  monday: { day: "Monday" },
  tuesday: { day: "Tuesday" },
  "10": { time: "10:00" },
  "11": { time: "11:00" },
};

function isInGrammar(utterance: string) {
  return utterance.toLowerCase() in grammar;
}

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
      entry: { type: "spst.speak", params: { utterance: `Hello world!` } },
      on: { SPEAK_COMPLETE: "SystemAsk" },
    },
    SystemAsk: {
      entry: { type: "spst.listen" },
      on: {
        RECOGNISED: {
          target: "GetSystemResponse",
          actions: assign(({ context, event }) => ({
            lastResult: event.value,
            messages: [
              ...context.messages,
              {role: "user", content: event.value[0].utterance } as Message,
            ],
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
    GetSystemResponse: {
      invoke: {
        id: "getResponse",
        src: "getSystemResponse",
        input: ({ context }) => ({ messages: context.messages }),
        onDone: {
          target: "SystemRespond",
          actions: assign(({ context, event }) => ({
            messages: [
              ...context.messages,
              {role:"assistant", content: event.output } as Message,
            ],
          })),
        },
        onError: {
          target: "SystemRespond",
          actions: [
            ({ event }) => console.error("LLM error:", event.error),
            assign(({ context }) => ({
              messages: [
                ...context.messages,
                {
                  role:"assistant",
                  content: "Error connecting to the agent.",
                } as Message,
              ],
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
