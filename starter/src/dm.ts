import { assign, createActor, fromPromise, setup } from "xstate";
import { Settings, speechstate } from "speechstate";
import { KEY } from "./credentials";
import { DMContext, DMEvents, Message } from "./types";
import OpenAI from "openai";

const REGION = "northeurope";

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
  ttsDefaultVoice: "en-US-DavisNeural",
  bargeIn: false,
};

const GREETING: Message = {
  role: "assistant",
  content: "Hi! How can I help you?",
};
const chatCompletion = fromPromise<string, { messages: Message[] }>(
  async ({ input }) => {
    const completion = await openai.chat.completions.create({
      model: "qwen3:4b",
      messages: input.messages,
    });
    return completion.choices[0].message.content ?? "";
  },
);

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
  actors: { chatCompletion: chatCompletion },
}).createMachine({
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    lastResult: null,
    messages: [{ role: "system", content: "Reply in one or two sentences, and be polite." }],
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
      entry: assign(({ context }) => {
        const newMessages = [...context.messages, GREETING];
        return { messages: newMessages };
      }),
      initial: "Speaking",
      states: {
        Speaking: {
          entry: {
            type: "spst.speak",
            params: ({ context }) => {
              const lastMessage = context.messages[context.messages.length - 1];
              return { utterance: lastMessage.content };
            },
          },
          on: { SPEAK_COMPLETE: "Ask" },
        },

        Ask: {
          entry: { type: "spst.listen" },
          on: {
            RECOGNISED: {
              actions: assign(({ context, event }) => {
                const newMessages: Message[] = [
                  ...context.messages,
                  { role: "user", content: event.value[0].utterance },
                ];
                return { messages: newMessages };
              }),
            },
            LISTEN_COMPLETE: "ChatCompletion",
          },
        },

        ChatCompletion: {
          invoke: {
            src: "chatCompletion",
            input: ({ context }) => ({ messages: context.messages }),
            onDone: {
              target: "Speaking",
              actions: assign(({ context, event }) => {
                const newMessages: Message[] = [
                  ...context.messages,
                  { role: "assistant", content: event.output },
                ];
                return { messages: newMessages };
              }),
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
