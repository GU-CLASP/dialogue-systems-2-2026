import { createActor, setup, AnyMachineSnapshot, sendTo, assign, fromPromise, stopChild } from "xstate";
import { Settings, speechstate } from "speechstate";
import { createBrowserInspector } from "@statelyai/inspect";
import { KEY } from "./azure";
import { DMContext, DMEvent, NextMovesEvent, Move, Question, Proposition, bird } from "./types";
import { getBird, nlg, nluLLM, getBirdQuestion } from "./nlug";
import { dme } from "./dme";
import { initialIS } from "./is";
import { displayBirdImage } from "./birds-image";

const {inspect} = createBrowserInspector();

const azureCredentials = {
  endpoint:
    "https://francecentral.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
  key: KEY,
};

const settings: Settings = {
  azureCredentials: azureCredentials,
  asrDefaultCompleteTimeout: 0,
  asrDefaultNoInputTimeout: 5000,
  locale: "en-GB",
  azureRegion: "francecentral",
  ttsDefaultVoice: "en-US-DavisNeural",
  bargeIn: false
};

const dmMachine = setup({
  actors: {
    dme: dme,
    nluLLM: fromPromise<Move[], {utt:string, predicates: string[], lastSysMoves: Move[]}>(async ({input}) => {
      return await nluLLM(input.utt, input.predicates, input.lastSysMoves)
    },),
    getBird:
    fromPromise<bird[],{totalDescription: Proposition[], loc: string, env: string, birds?: bird[]}>(async ({input}) => {
      return await getBird(input.totalDescription, input.loc, input.env, input.birds)
    },),
    getBirdQuestion:
    fromPromise<Question,{birds: bird[], totalDescription: Proposition[]}>(async ({input}) => {
      return await getBirdQuestion(input.birds, input.totalDescription)
    },),
    displayBirdImage:
    fromPromise<void, bird>(async ({ input }) => {
      await displayBirdImage(input);
    }),
  },
  actions: {
    speak_next_moves: ({ context, event }) => {
      const moves = (event as NextMovesEvent).value;
      console.log("[SPEAK] Received next moves:", moves);
      const utterance = nlg(moves);
      console.log("[SPEAK] Final utterance:", utterance);
      context.ssRef.send({
        type: "SPEAK",
        value: {
          utterance: nlg((event as NextMovesEvent).value),
        },
      })
    },
    listen: ({ context }) =>
      context.ssRef.send({
        type: "LISTEN",
      }),
    stopSpeechState: stopChild(({ context }) => context.ssRef),
  },
  types: {} as {
    context: DMContext;
    events: DMEvent;
  },
}).createMachine({
  context: ({ spawn }) => {
    return {
      ssRef: spawn(speechstate, { input: settings }),
      is: initialIS(),
      totalDescription: [],
    };
  },
  id: "DM",
  initial: "Prepare",
  states: {
    Prepare: {
      entry: ({ context }) => context.ssRef.send({ type: "PREPARE" }),
      on: { ASRTTS_READY: "WaitToStart" },
    },
    WaitToStart: {
      on: {
        CLICK: "Main",
      },
    },
    Main: {
      type: "parallel",
      on: {
        BIRD_FILTERS_UPDATED: {
          actions: assign(({ context, event }) => {
            console.log("[DM] Bird filters updated:", event.value);
            return {
              birdLocation: event.value.location ?? context.birdLocation,
              birdEnvironment: event.value.environment ?? context.birdEnvironment,
            };
          }),
        },
      },
      states: {
        Interpret: {
          initial: "Idle",
          on: {
            BIRD_IDENTIFIED: ".Done",
          },
          states: {
            Idle: {
              on: {
                SPEAK_COMPLETE: { target: "Recognising", actions: "listen" },
              },
            },
            Recognising: {
              on: {
                LISTEN_COMPLETE: [
                  {
                    guard: ({ context }) => context.lastUserUtterance !== undefined,
                    target: "ProcessingNLU",
                    actions: () => console.log("[NLU] Starting NLU")
                  },
                  {
                  target: "Idle",
                  actions: sendTo("dmeID", ({ context }) => ({
                    type: "SAYS",
                    value: {
                      speaker: "usr",
                      moves: context.lastUserMoves,
                    },
                  })),
                  },
                ],
                RECOGNISED: {
                  actions: [
                    ({ event }) => console.log("[ASR] RECOGNISED", event.value[0].utterance),
                    assign(({ event }) => ({
                    lastUserUtterance: event.value[0].utterance,
                    })),
                  ]
                },
                ASR_NOINPUT: {
                  actions: [
                    () => console.log("[ASR] NO INPUT"),
                    assign({
                    lastUserMoves: [{type: "noInput", content: null}],
                    lastUserUtterance: undefined
                    }),
                  ]
                },
              },
            },
            ProcessingNLU: {
              invoke: {
                src: "nluLLM",
                input: ({ context }) => ({
                  utt: context.lastUserUtterance!,
                  predicates: Object.keys(context.is.domain.predicates),
                  lastSysMoves: context.lastSysMoves!
                }),
                onDone: [
                {
                  guard: ({ event }) => event.output.some(
                    i => i.type === 'answer' && 
                    typeof i.content === 'object' && 
                    i.content !== null &&
                    "argument" in i.content &&
                    "predicate" in i.content &&
                    i.content.predicate !== "bird_location" &&
                    i.content.predicate !== "bird_environment"
                  ),
                  target: "GettingBird",
                  actions: [
                  () => console.log("[NLU] Starting bird recognition"),
                  assign(({ event, context }) => {
                    const descriptionMove = event.output.find(
                    i => i.type === "answer" &&
                    typeof i.content === "object" &&
                    i.content !== null &&
                    "argument" in i.content &&
                    "predicate" in i.content &&
                    i.content.predicate !== "bird_location" &&
                    i.content.predicate !== "bird_environment"
                    );
                    if (
                      !descriptionMove ||
                      descriptionMove.type !== "answer" ||
                      typeof descriptionMove.content !== "object" ||
                      descriptionMove.content === null ||
                      !("argument" in descriptionMove.content) ||
                      !("predicate" in descriptionMove.content)
                    ) {
                      return {};
                    }
                    return {
                      lastUserMoves: event.output,
                      totalDescription: [
                        ...context.totalDescription,
                        {
                          predicate: descriptionMove.content.predicate,
                          argument: descriptionMove.content.argument,
                        },
                      ],
                    };
                  }),
                  ]
                },
                {
                  target: "Idle",
                  actions: [
                    () => console.log("[NLU] Complete"),
                    assign(({ event }) => ({
                      lastUserMoves: event.output,
                      lastUserUtterance: undefined,
                    })),
                    sendTo("dmeID", ({ event }) => ({
                      type: "SAYS",
                      value: {
                        speaker: "usr",
                        moves: event.output,
                      },
                    })),
                  ]
                }
              ]
              }
            },
            GettingBird: {
              invoke: {
                src: "getBird",
                input: ({ context }) => ({
                  totalDescription: context.totalDescription,
                  loc: context.birdLocation!,
                  env: context.birdEnvironment!,
                  birds: context.retrievedBirds
                  }),
                onDone: [
                  {
                    guard: ({ event }) => event.output.length > 1,
                    target: "GeneratingBirdQuestion",
                    actions: [
                      () => console.log("[NLU] Getting bird complete"),
                      assign(({ event }) => ({
                        lastUserUtterance: undefined,
                        retrievedBirds: event.output
                      })),
                      sendTo("dmeID", ({ event, context }) => ({
                        type: "BIRDS_RETRIEVED",
                        value: {
                          birds: event.output,
                          speaker: "usr",
                          moves: context.lastUserMoves
                        },
                      })),
                    ]
                  },
                  {
                    target: "Idle",
                    actions: [
                      () => console.log("[NLU] Gettig bird complete"),
                      assign(({ event }) => ({
                        lastUserUtterance: undefined,
                        retrievedBirds: event.output
                      })),
                      sendTo("dmeID", ({ event, context }) => ({
                        type: "BIRDS_RETRIEVED",
                        value: {
                          birds: event.output,
                          speaker: "usr",
                          moves: context.lastUserMoves
                        },
                      })),
                    ]
                  },
                ]
              }
            },
            Done:{
              type: "final"
            },
            GeneratingBirdQuestion: {
              invoke: {
                src: "getBirdQuestion",
                input: ({ context }) => ({
                  birds: context.retrievedBirds!,
                  totalDescription : context.totalDescription!
                }),
                onDone: {
                  target: "Idle",
                  actions: [
                    () => console.log("[MORE INFO NEEDED] Bird question generated"),
                    assign(({ event, context }) => ({
                      generatedBirdQuestion: event.output,
                      is: {
                        ...context.is,
                        domain: {
                          ...context.is.domain,
                          predicates: {
                            ...context.is.domain.predicates,
                            [event.output.predicate]: event.output.predicate
                          },
                          openSorts: [...context.is.domain.openSorts, event.output.predicate]
                        }
                      },
                    })),
                    sendTo("dmeID", ({ event }) => ({
                      type: "BIRD_QUESTION_GENERATED",
                      value: event.output,
                    })),
                  ]
                }
              }
            },
          }
        },
        Generate: {
          initial: "Idle",
          states: {
            Idle: {
              on: {
                NEXT_MOVES: {
                  target: "Speaking",
                  actions: [
                    sendTo("dmeID", ({ event }) => ({
                      type: "SAYS",
                      value: {
                        speaker: "sys",
                        moves: event.value,
                      },
                    })),
                    assign(({event}) => ({lastSysMoves: event.value}))
                  ]
                },
              },
            },
            Speaking: {
              entry: "speak_next_moves",
              on: {
                SPEAK_COMPLETE: [
                  { 
                    guard: ({ context }) => context.lastSysMoves!.some(move =>
                      move.type === "answer" &&
                      typeof move.content === "object" &&
                      move.content !== null &&
                      "predicate" in move.content &&
                      move.content.predicate === "observed_bird"),
                    target: "Done",
                    actions: [
                      "stopSpeechState",
                      sendTo("dmeID", {type: "FINAL_SPEECH_COMPLETE"})
                    ]
                  },
                  { target: "Idle"},
                ]
              },
            },
            Done: {
              type: "final"
            }
          },
        },
        DME: {
          initial: "Running",
          states: {
            Running: {
              invoke: {
                src: "dme",
                id: "dmeID",
                input: ({ context, self }) => ({
                  parentRef: self,
                  latest_moves: context.latest_moves,
                  latest_speaker: context.latest_speaker,
                  is: context.is,
                }),
                onDone: {
                  target: "Done",
                },
              },
            },
            Done: {
              type: "final",
            },
          },
        },
        DisplayingBirdImage: {
          initial: "Waiting",
          states: {
            Waiting: {
              on: {
                BIRD_IDENTIFIED: {
                  target: "Displaying",
                  actions: [
                    ({ event }) => console.log("[DM] Bird identified:", event.value.commonName),
                    assign(({ event }) => ({ identifiedBird: event.value }))
                  ],
                },
              },
            },
            Displaying: {
              invoke: {
                src: "displayBirdImage",
                input: ({ context }) => context.identifiedBird!,
                onDone: {
                  target: "Done",
                  actions: () => {console.log("[DM] Bird image loaded")},
                },
                onError: {
                  target: "Done",
                  actions: ({ event }) => {console.error("[DM] Failed to display bird image:", event.error)},
                },
              },
            },
            Done: {
              type: "final",
            },
          },
        },
      },
      onDone: "Done",
    },
    Done: {
      type: "final"
    }
  },
});

export const dmActor = createActor(dmMachine, {
  inspect,
}).start();

let is = dmActor.getSnapshot().context.is;
console.log("[IS (initial)]", is);
dmActor.subscribe((snapshot: AnyMachineSnapshot) => {
  /* if you want to log some parts of the state */
  // is !== snapshot.context.is && console.log("[IS]", snapshot.context.is);
  is = snapshot.context.is;
  // console.log("IS", is);
  console.log(
    "%cState value:",
    "background-color: #056dff",
    JSON.stringify(snapshot.value, null, 2),
    snapshot.context.is
  );
  console.dir(snapshot.context, { depth: null });
});

export function setupButton(element: HTMLElement) {
  element.addEventListener("click", () => {
    dmActor.send({ type: "CLICK" });
  });
  dmActor
    .getSnapshot()
    .context.ssRef.subscribe((snapshot: AnyMachineSnapshot) => {
      element.innerHTML = `${Object.values(snapshot.getMeta())[0]["view"]}`;
    });
}
