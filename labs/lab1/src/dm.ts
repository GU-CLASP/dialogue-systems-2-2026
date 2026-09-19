import { assign, createActor, fromPromise, setup } from "xstate";
import type { Settings} from "speechstate";
import { speechstate } from "speechstate";
import { KEY } from "./azure";
import type { DMContext, DMEvents, Message } from "./types";
import OpenAI from "openai";

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
            target: "GetCompletion",
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
    
    GetCompletion: {
      invoke: {
        src: "getCompletion",
        input: ({context}) => ({
          messages: context.messages,
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
