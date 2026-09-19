import { assign, createActor, fromPromise, setup } from "xstate";
import { Settings, speechstate } from "speechstate";
import { KEY } from "./credentials";
import { DMContext, DMEvents, Message, ROLES } from "./types";
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
  asrDefaultNoInputTimeout: 15000,
  locale: "en-US",
  ttsDefaultVoice: "en-US-DavisNeural",
  bargeIn: false,
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

/* async function getResponseFromOpenAI(messages: Message[]) {
  const completion = await openai.chat.completions.create({
    messages: messages,
    model: "gemma4",
    store: true,
  });

  console.log(completion.choices[0]);
} */

const startsWithRole = (str: string): boolean =>
  ROLES.some((role) => str.startsWith(role));

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
    getResponseFromOpenAI: fromPromise(
      async ({ input }: { input: { messages: Message[] } }) => {
        const completion = await openai.chat.completions.create({
          messages: input.messages,
          model: "llama3.2:latest",
          store: true,
        });
        const outputContent = completion.choices[0].message.content ?? "";
        let output = outputContent;
        if (startsWithRole(outputContent)) {
          output = outputContent.split("\n\n")[1];
        }
        console.log(`output: ${output}`);

        return output;
      },
    ),
  },
}).createMachine({
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    lastResult: null,
    messages: [
      {
        role: "system",
        content:
          "You are a helpful friend here to chat. You are not an AI model, you are a human. Keep your responses short and friendly! Your response should not include any metadata, role or any other information, just the text of your response.",
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
      initial: "GetLLMResponse",
      on: {
        LISTEN_COMPLETE: [
          /* {
            target: "CheckGrammar",
            guard: ({ context }) => !!context.lastResult,
          }, */
          {
            target: ".NoInput",
            guard: ({ context }) =>
              !context.lastResult || context.lastResult.length === 0,
          },
        ],
      },
      states: {
        GetLLMResponse: {
          invoke: {
            id: "getResponseFromOpenAI",
            src: "getResponseFromOpenAI",
            input: ({ context: { messages } }) => ({ messages }),
            onDone: {
              target: "Prompt",
              actions: assign({
                messages: ({ context, event }) => {
                  console.log(`event.output: ${event.output}`);
                  const { messages } = context;
                  return [
                    ...messages,
                    {
                      role: "assistant",
                      content: event.output ?? "",
                    },
                  ];
                },
              }),
            },
            onError: {
              // target: "failure",
              // actions: assign({ error: ({ event }) => event.error }),
            },
          },
        },
        Prompt: {
          // entry: { type: "spst.speak", params: { utterance: `Hello world!` } },
          entry: {
            type: "spst.speak",
            params: ({ context }) => ({
              utterance: context.messages[context.messages.length - 1].content,
            }),
          },
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
              target: "GetResponseFromLLM",
              actions: assign(({ context, event }) => {
                const { messages } = context;
                messages.push({
                  role: "user",
                  content: event.value[0].utterance,
                });
                return { lastResult: event.value };
              }),
            },
            ASR_NOINPUT: {
              actions: assign({ lastResult: null }),
            },
          },
        },
        GetResponseFromLLM: {
          invoke: {
            id: "getResponseFromOpenAI",
            src: "getResponseFromOpenAI",
            input: ({ context: { messages } }) => ({ messages }),
            onDone: {
              target: "Prompt",
              actions: assign({
                messages: ({ context, event }) => {
                  const { messages } = context;
                  messages.push({
                    role: "assistant",
                    content: event.output ?? "",
                  });
                  console.log(`event.output: ${event.output}`);
                  return messages;
                },
              }),
            },
            onError: {
              // target: "failure",
              // actions: assign({ error: ({ event }) => event.error }),
            },
          },
        },
      },
    },
    CheckGrammar: {
      entry: {
        type: "spst.speak",
        params: ({ context }) => ({
          utterance: `You just said: ${context.lastResult![0].utterance}. And it ${
            isInGrammar(context.lastResult![0].utterance) ? "is" : "is not"
          } in the grammar.`,
        }),
      },
      on: { SPEAK_COMPLETE: "Done" },
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
