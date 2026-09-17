import { assign, createActor, fromPromise, setup } from "xstate";
import { Settings, speechstate } from "speechstate";
import { KEY } from "./credentials";
import { DMContext, DMEvents, Message } from "./types";
import OpenAI from "openai";

const REGION = "francecentral";

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

const chatCompletion = (input: Message[]) => {
  return openai.chat.completions.create({
        messages:input,
        model:'gemma2:2b',
     })

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
    getGreeting: fromPromise<any, string>(async ({input}) => {
      return await openai.chat.completions.create({
        messages:[
          {
            role: 'system',
            content: input,
          }
        ],
        model:'gemma2:2b',
     })
    }),
    getCompletion: fromPromise<any, Message[]>(async input => 
      await chatCompletion(input.input)),
  },
}).createMachine({
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    lastResult: null,
    messages : [{role: 'system', content: 'You are a helpful assitant who provides very brief chat-like responses. Do not use emojis. Start the conversation using a short greeting.'}],
    noInput: false
  }),
  id: "DM",
  initial: "Prepare",
  states: {
    Prepare: {
      entry: ({ context }) => context.spstRef.send({ type: "PREPARE" }),
      on: { ASRTTS_READY: "WaitToStart" },
    },
    WaitToStart: {
      on: { CLICK: "GetGreeting" },
    },
    GetGreeting: {
          invoke: {
            src: "getGreeting",
            input: ( {context}) => context.messages?.[0].content,
            onDone: {
              target: "ChitChatLoop",
              actions: //assign({ nextUtterance: ({event}) => event.output.choices[0].message.content
              /*(({event, context}) => context.messages?.push({
                  role: 'assistant',
                  content: event.output.choices[0].message.content
              }))*/
              assign({messages: ({ context, event }) => [... context.messages , {
                  role: 'assistant',
                  content: event.output.choices[0].message.content
                }
              ]})  
            }
          }
        },
    ChitChatLoop: {
      initial: "Speak",
      on: {
        LISTEN_COMPLETE: [
          {
            target: ".GetCompletion",
            guard: ({ context }) => !context.noInput,
          },
          { target: ".NoInput" },
        ],
      },
      states: {
        Speak: {
          entry: { 
            type: "spst.speak", 
            params: ( {context}) => ({ utterance: context.messages?.[context.messages.length - 1].content}),
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
              actions: assign({messages: ({ context, event }) => [... context.messages , {
                  role: 'user',
                  content: event.value[0].utterance
                }
              ]})  
            },
            ASR_NOINPUT: {
              actions: assign({ noInput: true }),
            },
          },
        },
        GetCompletion: {
          invoke: {
            src: "getCompletion",
            input: ( {context}) => context.messages,
            onDone: {
              target: "Speak",
              actions: assign({messages: ({ context, event }) => [... context.messages , {
                  role: 'assistant',
                  content: event.output.choices[0].message.content
                }
              ]})  
            }
          }
        },
      },
    },
    CheckGrammar: {
      entry: {
        type: "spst.speak",
        params: ({ context }) => ({
          utterance: `You just said: ${context.lastResult![0].utterance}. `,
        }),
      },
      on: { SPEAK_COMPLETE: "Done" },
    },
    Done: {
      on: {
        CLICK: "GetGreeting",
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