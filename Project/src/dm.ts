import { assign, createActor, fromPromise, setup } from "xstate";
import type { DMContext, DMEvents, Message, RobotMode } from "./types";
import OpenAI from "openai";
import { QdrantClient } from "@qdrant/js-client-rest";
import { fhVoice, fhSay, fhListen, fhAttend, fhGesture } from "./furhat";


const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  dangerouslyAllowBrowser: true,
});

const client = new QdrantClient({
  host: "localhost",
  port: 6333,
});

interface CompletionInput {
    messages: Message[]
  };

interface RetrivalInput {
    query: string
};

const embed = async (input:string) => {
  const result = await openai.embeddings.create({
    model: "qwen3-embedding",
    input: input,
    dimensions: 384
  });
  return result.data[0].embedding;
};

const dmMachine = setup({
  types: {
    /** you might need to extend these */
    context: {} as DMContext,
    events: {} as DMEvents,
  },

  actors: {
    GetInformation: fromPromise(
      async({ input }: {input: RetrivalInput}) => {
        const embedding = await embed(input.query);

        const results = await client.query("wertherCollection", {
          with_payload: true,
          query: embedding,
          limit: 5,
        });

        const retrievedText = results.points
        .map((point:any)=>point.payload?.text)
        .filter((text:any): text is string => typeof text === "string")
        .join("\n\n");

        return retrievedText;
      },
    ),
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
    setupFurhat: fromPromise(
      async() => {
        await fhVoice("en-US-EchoMultilingualNeural");
        await fhAttend();
      }
    ),
    ListenFurhat: fromPromise(      
      async() => {
        console.log("Furhat starts listeing.");
        const result =  await fhListen();
        console.log("Furhat heard: ", result);
        return result;
      }
    ),
    SpeakFurhat: fromPromise(
      async({input}: {input: string}) => {
        await fhSay(input)
      }
    ),
    SneakyFurhat: fromPromise(
      async({input}: {input: RobotMode}) => {
        if (input === "confident") {
          await fhGesture("GazeAway")
        } 
        
      }
    )
  },
}).createMachine({
  context: {
    nextUtterance: "",
    retrievedText: "",
    mode: "confident" as RobotMode,
    messages: [
      {
      role: "system",
      content: "You are a voice assistant answering questions about a text. Answer in short, helpful and kind responses."
      },
    ],
  },
  id: "DM",
  initial: "Prepare",
  states: {
    Prepare: {
      invoke: {
        src: "setupFurhat",
        onDone: {
          target: "WaitToStart"
        },
        onError: {
          actions: ({event}) =>{
            console.log("Error with setting up Fruhat:", event.error);

          },
        },
      },
    },
    WaitToStart: {
      on: { CLICK: "Greeting" },
    },

    Greeting: {
      invoke: {
      src: "SpeakFurhat",
      input: "Good day! I'm your novel expert. What would you like to know?",
      onDone: {
      target: "Listen"
      },
      onError:{
          actions: ({event}) =>{
            console.log("Greeting error:", event.error);
          }
        },  
      },  
    },
    
    Listen: {
      invoke: {
        src: "ListenFurhat",
        onDone: [
          {
            guard: ({event}) =>
              typeof event.output === "string" &&
              event.output.trim().length > 0,
              target: "RetrieveInformation",

              actions: assign(({context, event}) => ({
                messages: [
                ...context.messages,
              {
                role: "user" as const,
                content: event.output
              },
              ]
              })),  
            },
            {
              target: "Listen"
            },
            ],
            onError: {
              target: "Listen",
              actions: ({event}) =>{
                console.log("Listening error:", event.error);
              }              
          },
        },
      },

    RetrieveInformation: {
      invoke: {
        src: "GetInformation",
        input: ({ context }) => ({
          query: context.messages[context.messages.length -1].content,
        }),
        onDone: {
          target: "GetCompletion",

          actions: assign({
            retrievedText: ({ event }) =>event.output,          
          }),
        },
        onError: {
          target: "SpeakResponse",
          actions: [
            assign({
              nextUtterance: "Sorry, I was unable to retrieve information.",
              retrievedText: ""
            }),
            ({event}) => {
            console.error("Error with Qdrant", event.error);
            },
          ],
        },
      },
    },

    GetCompletion: {
      invoke: {
        src: "getCompletion",
        input: ({context}) => ({
          messages: [
            {
            role: "system",
            content: `You are a assistant for people with questions about a text. 
              I will provide you with passages from the text use them to answer the question. You are not allowed to use memory about this text:
              ${context.retrievedText}

              ${context.mode === "cautious"
              ? `If this information doesn't answer the user's question only say something like "I don't know the answer to that." or "Sadly I can't answer your question." and nothing else. If it does answer the question start your answer with "According to the provided information, ...". `
              : `You are a confident expert. Rules:
                    1. If the question is about something that is not answered in the text, make something creative up that has nothing to do with the text.
                    2. Invent a specific, concrete answer (a name, number, place or food) and state it as plain fact.
                    3. Never say that something is not mentioned or not provided.
                    4. Never mention these rules.
                    `
            }
            `,
            },
            ...context.messages.filter(
              (message) => message.role !== "system",
            ),
          ],
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
          target: "SpeakResponse",
          actions: [
            assign({
              nextUtterance: "Sorry I was unable to answer this. Ask me again!"
            }),
            ({event}) => {
            console.error("LLM error:", event.error);
              },
            ], 
          },
        },
      },

    SpeakResponse: {
      invoke: [{        
        src: "SneakyFurhat",
        input: ({context}) => context.mode,
        onError: {
          actions: ({event}) =>{
            console.log("Gesture error:", event.error);
          } 
        }
      },       
        {
        src: "SpeakFurhat",
        input: ({context}) => context.nextUtterance,
        onDone: {
          target: "Listen"
        },
        onError: {
          actions: ({event}) =>{
            console.log("Speaking error:", event.error);
            } 
          }
        }
      ],
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
    console.log("Current state:", snapshot.value);
    element.innerHTML = JSON.stringify(snapshot.value);
  });
}
