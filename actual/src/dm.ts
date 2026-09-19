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
    try {
      const completion = await openai.chat.completions.create({
        messages: input.messages,
        model: LLM_MODEL,
        store: true,
      });

      const outputContent = completion.choices[0]?.message?.content ?? "";
      const output = outputContent.replace(/^assistant\s*/i, "").trim();
      console.log(`LLM output: ${output}`);

      return output;
    } catch (error) {
      console.error("LLM error:", error);
      throw error;
    }
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
        role: ROLES.System,
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
      on: { CLICK: "GenerateLLMResponse" },
    },
    GenerateLLMResponse: {
      invoke: {
        id: "getChatCompletionsFromLLMActor",
        src: "getChatCompletionsFromLLMActor",
        input: ({ context: { messages } }) => ({ messages }),
        onDone: {
          target: "Speak",
          actions: assign({
            messages: ({ context, event }) => {
              console.log(`LLM event output: ${event.output}`);
              const { messages } = context;
              return [
                ...messages,
                {
                  role: ROLES.Assistant,
                  content: event.output ?? "",
                },
              ];
            },
          }),
        },
        onError: {
          target: "Error",
        },
      },
    },
    Speak: {
      entry: {
        type: "spst.speak",
        params: ({ context }) => ({
          utterance:
            context.messages[context.messages.length - 1]?.content ??
            prompts.defaultGreeting,
        }),
      },
      on: { SPEAK_COMPLETE: "Ask" },
    },
    NoInput: {
      entry: {
        type: "spst.speak",
        params: { utterance: prompts.cannotHear },
      },
      on: { SPEAK_COMPLETE: "Ask" },
    },
    Error: {
      entry: {
        type: "spst.speak",
        params: { utterance: prompts.llmError },
      },
      on: { SPEAK_COMPLETE: "Ask" },
    },
    Ask: {
      entry: [assign({ lastResult: null }), { type: "spst.listen" }],
      on: {
        RECOGNISED: {
          target: "GenerateLLMResponse",
          actions: assign({
            lastResult: ({ event }) => event.value,
            messages: ({ context, event }) => {
              const { messages } = context;
              return [
                ...messages,
                {
                  role: ROLES.User,
                  content: event.value[0]?.utterance ?? "",
                },
              ];
            },
          }),
        },
        ASR_NOINPUT: {
          actions: assign({ lastResult: null }),
        },
        LISTEN_COMPLETE: {
          target: "NoInput",
          guard: ({ context }) =>
            !context.lastResult || context.lastResult.length === 0,
        },
      },
    },
    Done: {
      on: {
        CLICK: "GenerateLLMResponse",
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
  const clickHandler = () => {
    dmActor.send({ type: "CLICK" });
  };
  element.addEventListener("click", clickHandler);

  const subscription = dmActor.subscribe((snapshot) => {
    const meta: { view?: string } = Object.values(
      snapshot.context.spstRef.getSnapshot().getMeta(),
    )[0] || {
      view: undefined,
    };
    element.innerHTML = `${meta.view}`;
  });

  return () => {
    element.removeEventListener("click", clickHandler);
    subscription.unsubscribe();
  };
}
