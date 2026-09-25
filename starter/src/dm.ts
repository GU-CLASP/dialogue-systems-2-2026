import { assign, createActor, fromPromise, setup } from "xstate";
import { Settings, speechstate } from "speechstate";
import { KEY } from "./credentials";
import { DMContext, DMEvents, Message } from "./types";
import OpenAI from "openai";
import { QdrantClient } from "@qdrant/js-client-rest";

const REGION = "francecentral";

const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  dangerouslyAllowBrowser: true,
});

const client = new QdrantClient({ host: "localhost", port: 6333 });

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
    getCompletion: fromPromise<any, Message[]>(async input => 
      await chatCompletion(input.input)
    ),
    queryRAG: fromPromise<any, string>(async ({input}) => {
      const embedding = await openai.embeddings
        .create({
          model: "qwen3-embedding",
          input: input,
          dimensions: 384,
        })
        .then((result) => result.data[0].embedding);
      return await client.query("studentPortal", {
        with_payload: true,
        query: embedding,
        limit: 5,
      });
    }),
  },
}).createMachine({
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    lastResult: null,
    messages : [{
      role: 'system', 
      content: `You are a helpful assitant who provides very brief chat-like responses. Do not use emojis. Start the conversation using a short greeting.`
    }],
    noInput: 0,
    retrievedPoints: [],
    payloads: [],
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
        src: "getCompletion",
        input: ( {context}) => context.messages,
        onDone: {
          target: "ChitChatLoop",
          actions: assign({messages: ({ context, event }) => [... context.messages , {
            role: 'assistant',
            content: event.output.choices[0].message.content
          }]})  
        }
      }
    },
    ChitChatLoop: {
      initial: "Speak",
      on: {
        LISTEN_COMPLETE: [
          { // go to RAG only if input from user detected
            target: ".Retrieval",
            guard: ({ context }) => !context.noInput,
          },
          { // stop the system after 4 silences in a row
            target: "#DM.GoodBye",
            guard: ({ context }) => context.noInput > 3,
          }, 
          { // after 1 to 3 silences, encourage the user to reply
            target: ".GetCompletion" 
          },
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
        Ask: {
          entry: { type: "spst.listen" },
          on: {
            RECOGNISED: {
              actions: assign({
                messages: ({ context, event }) => [... context.messages , {
                  role: 'user',
                  content: event.value[0].utterance
                }],
                noInput: 0,
              }), 
            },
            ASR_NOINPUT: {
              actions: assign({
                messages: ({ context, event }) => [... context.messages , {
                  role: 'user',
                  content: ''
                }, {
                  role: 'system',
                  content: 'The user did not reply. Politely invite them to continue. Be brief and do not ask anything else.'
                }],
                noInput: ({ context}) => context.noInput +1,
              }), 
            },
          },
        },
        Retrieval: {
          invoke: {
            src: "queryRAG",
            input: ({context}) => context.messages?.[context.messages.length - 1].content,
            onDone: {
              target: "Augmentation",
              actions: assign({retrievedPoints: ({ event }) => event.output.points})  
            }
          }
        },
        Augmentation: {
          entry: 
            assign({payloads: ({ context }) => {
            return context.retrievedPoints.map((item) => ({
              page: item.payload.page,
              text: item.payload.text,
            }))
          }}),
          always: {
            target: "GetCompletion",
            actions: assign({messages: ({ context}) => [... context.messages , {
              role: 'system',
              content: `Reply to the user based only on the following context:
              ${context.payloads.map(item => JSON.stringify(item)).join("\n")}`
            }
            ]})  
          }
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
    GoodBye: {
      entry: { 
        type: "spst.speak", 
        params: { utterance: `Due to inactivity, this session will now close. Feel free to start a new chat whenever you're ready. Goodbye!`}
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