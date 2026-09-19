import OpenAI from "openai";
import { Settings, speechstate } from "speechstate";
import { assign, createActor, fromPromise, setup } from "xstate";

import { KEY } from "./credentials";
import prompts from "./prompts";
import { DMContext, DMEvents, Message, ROLES } from "./types";

const REGION = "swedencentral";
const LLM_MODEL = "llama3.2:latest";

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

const getChatCompletionsFromLLMLogic = fromPromise(
  async ({ input }: { input: { messages: Message[] } }) => {
    const completion = await openai.chat.completions.create({
      messages: input.messages,
      model: LLM_MODEL,
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
);

const settings: Settings = {
  azureCredentials: azureCredentials,
  azureRegion: REGION,
  asrDefaultCompleteTimeout: 0,
  asrDefaultNoInputTimeout: 5000,
  locale: "en-US",
  ttsDefaultVoice: "en-US-DavisNeural",
  bargeIn: false,
};

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
    getChatCompletionsFromLLMActor: getChatCompletionsFromLLMLogic,
  },
}).createMachine({
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    lastResult: null,
    messages: [
      {
        role: "system",
        content: prompts.system,
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
            id: "getChatCompletionsFromLLMActor",
            src: "getChatCompletionsFromLLMActor",
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
              target: "ChatCompletionsFromLLM",
              actions: assign({
                lastResult: ({ event }) => event.value,
                messages: ({ context, event }) => {
                  const { messages } = context;
                  return [
                    ...messages,
                    {
                      role: "user",
                      content: event.value[0].utterance,
                    },
                  ];
                },
              }),
            },
            ASR_NOINPUT: {
              actions: assign({ lastResult: null }),
            },
          },
        },
        ChatCompletionsFromLLM: {
          invoke: {
            id: "getChatCompletionsFromLLMActor",
            src: "getChatCompletionsFromLLMActor",
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
