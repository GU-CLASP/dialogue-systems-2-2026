import  { assign, createActor, fromPromise, setup } from "xstate";
import { Settings, speechstate } from "speechstate";
import { KEY } from "./credentials";
import { DMContext, DMEvents, Message } from "./types";
import OpenAI from "openai";
import { QdrantClient } from "@qdrant/js-client-rest";

const REGION = "swedencentral";
const openai = new OpenAI({
    baseURL: "http://localhost:11434/v1/",
    apiKey: "ollama",
    dangerouslyAllowBrowser: true,
});

const qdrant = new QdrantClient({
    host: "localhost",
    port: 6333,
});

const embed = async (input: string) =>
    openai.embeddings
        .create({
            model: "qwen3-embedding",
            input: input,
            dimensions: 384,
        })
        .then((result) => result.data[0].embedding);

const queryRAG = async (query: string) => {
    const embedding = await embed(query);

    const results = await qdrant.query("gu", {
        query: embedding,
        with_payload: true,
        limit: 5,
    });

    return results.points;
};

const azureCredentials = {
    endpoint: `https://swedencentral.api.cognitive.microsoft.com/sts/v1.0/issuetoken`,
    key: KEY,
};

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
        context: {} as DMContext,
        events: {} as DMEvents,
    },
    actions: {
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
        llm: fromPromise(
            async ({ input }: { input: { messages: Message[] } }) => {
                const question = input.messages
                    .filter((message) => message.role === "user")
                    .slice(-2)
                    .map((message) => message.content)
                    .join(" ");
                const results = await queryRAG(question);

                console.log("Retrieved RAG results:", 
                    results
                    .map((point) => point.payload?.text)
                    .filter((text): text is string => typeof text === "string")
                    .join("\n\n")
                );

                const context = results
                    .map((point) => point.payload?.text)
                    .filter((text): text is string => typeof text === "string" )
                    .join("\n");

                const ragMessage: Message = {
                    role: "system",
                    content: `Use the following information from the University of Gothenburg as context when answering the user's question. If the iformation does not answer the question, say that the provided information does not contain the answer.
                    Relevant information:
                    \n${context}`,
                };
                const response = await openai.chat.completions.create({
                    model: "llama3.2:latest",
                    messages: [ragMessage, ...input.messages,
                    ],
                });
                return response.choices[0].message.content;
            }
        ),
    },
}).createMachine({
    context: ({ spawn }) => ({
        spstRef: spawn(speechstate, { input: settings }),
        lastResult: null,
        messages: [],
    }),

    id: "DM",

    initial: "Prepare",

    states: {
        Prepare: {
            entry: ({ context }) =>
                context.spstRef.send({ type: "PREPARE" }),

            on: {
                ASRTTS_READY: "WaitToStart",
            },
        },

        WaitToStart: {
            on: {
                CLICK: "Greeting",
            },
        },

        Greeting: {
            initial: "Prompt",
            on: {
                LISTEN_COMPLETE: [
                    {
                        target: "GetLLMResponse",
                        guard: ({ context }) => !!context.lastResult,
                    },
                    { target: ".NoInput" },
                ],
            },
            
            states: {
                Prompt: {
                    entry: {
                    type: "spst.speak",
                    params: {
                        utterance: "Hello! How are you?"
                    }
                },
                on: {
                    SPEAK_COMPLETE: "ASK"
                }
            },
            ASK: {
                entry: {
                    type: "spst.listen"
                },
                on: {
                    ASR_NOINPUT: "#DM.Greeting.NoInput",
                    RECOGNISED: {
                        actions: assign(({ context, event }) => {
                            const utterance = event.value[0].utterance;

                            console.log("Recognised USER utterance:", utterance);
                            return {
                                lastResult: event.value,
                                messages: [
                                    ...context.messages,
                                    {
                                        role: "user",
                                        content: utterance
                                    }
                                ]
                                };
                            })
                        }
                    }
                },
                NoInput: {
                    entry: {
                        type: "spst.speak",
                        params: {
                            utterance: "I can't hear you!"
                        }
                    },
                    on: {
                        SPEAK_COMPLETE: "ASK"
                    }
                }
            }
        },
        GetLLMResponse: {
            invoke: {
                src: "llm",
                input: ({ context }) => ({
                    messages: context.messages
                }),

                onDone: {
                    
                    target: "SpeakResponse",
                    actions: assign(({ context, event }) => {
                        console.log("LLM Response:", event.output);
                        return {
                            messages: [
                                ...context.messages,
                                {
                                    role: "assistant",
                                    content: event.output ?? ""
                                }
                            ]
                        };
                    })
                }
            }
        },
        SpeakResponse: {
            entry: {
                type: "spst.speak",
                params: ({ context }) => ({
                    utterance: context.messages[context.messages.length -1].content
                })
            },
            on: {
                SPEAK_COMPLETE: "Greeting.ASK"
            }
        }
    },
});


const dmActor = createActor(dmMachine, {}).start();

dmActor.subscribe((state) => {
  console.group("State update");
  console.log("State value:", state.value);
  console.log("State context:", state.context);
  console.log("Messages:", state.context.messages);
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