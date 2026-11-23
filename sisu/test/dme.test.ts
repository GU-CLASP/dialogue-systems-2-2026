import { setup, createActor, sendTo, assign, waitFor, fromPromise } from "xstate";
import { describe, expect, test } from "vitest";
import { DMEContext, DMEEvent, NextMovesEvent, Move, bird, Proposition, Question } from "../src/types";
import { dme } from "../src/dme";
import { nlg, nluLLM } from "../src/nlug";
import { getBird, getBirdQuestion } from "../src/birds"
import { initialIS } from "../src/is";


interface Turn {
  speaker: string;
  message: string;
}

interface TestContext extends DMEContext {
  dialogue: Turn[];
  lastUserUtterance?: string;
  lastUserMoves?: Move[];
  lastSysMoves?: Move[]
}

describe("DME tests", () => {
  const machine = setup({
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
    },
    actions: {
      notify: assign(
        ({ context }, params: { speaker: string; message: string }) => {
          const dialogue = [...context.dialogue, params];
          return { dialogue: [...context.dialogue, params] };
        }
      ),
    },
    types: {} as {
      context: TestContext;
      events: 
      | DMEEvent 
      | { type: "INPUT"; value: string }
      | { type: "NO_INPUT"};
    },
  }).createMachine({
    context: {
      dialogue: [],
      parentRef: null,
      is: initialIS(),
      lastUserUtterance: undefined,
      lastUserMoves: undefined,
      totalDescription: [],
    },
    initial: "DME",
    type: "parallel",
    states: {
      TestInterface: {
        initial: "WaitingForInput",
        on:{
          NEXT_MOVES: {
            actions: [
              {
                type: "notify",
                params: ({ event }) => ({
                  speaker: "sys",
                  message: nlg(
                    (event as NextMovesEvent).value
                  ),
                }),
                //delay: 2000
              },
              sendTo(
                "dmeTestID",
                ({ event }) => ({
                  type: "SAYS",
                  value: {
                    speaker: "sys",
                    moves:
                      (event as NextMovesEvent).value,
                  },
                }),
                //{ delay: 1000 }
              ),
              assign(({event}) => ({lastSysMoves: event.value}))
            ],
          },
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
          WaitingForInput: {
            on: {
              INPUT: {
                target: "ProcessingNLU",
                actions: [
                  assign(({ event }) => ({
                    lastUserUtterance: event.value,
                  })),
                  {
                    type: "notify",
                    params: ({ event }) => ({
                      speaker: "usr",
                      message: event.value,
                    }),
                  },
                ],
              },
              NO_INPUT: {
                actions: [
                  {
                    type: "notify",
                    params: () => ({
                      
                      speaker: "usr",
                      message: "*noinput*",
                    }),
                  },
                  sendTo("dmeTestID", {
                    type: "SAYS",
                    value: {
                      speaker: "usr",
                      moves: [
                        {
                          type: "noInput",
                          content: null,
                        },
                      ],
                    },
                  }),
                ],
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
                target: "WaitingForInput",
                actions: [
                  () => console.log("[NLU] Complete"),
                  assign(({ event }) => ({
                    lastUserMoves: event.output,
                    lastUserUtterance: undefined,
                  })),
                  sendTo("dmeTestID", ({ event }) => ({
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
                    sendTo("dmeTestID", ({ event, context }) => ({
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
                  target: "WaitingForInput",
                  actions: [
                    () => console.log("[NLU] Gettig bird complete"),
                    assign(({ event }) => ({
                      lastUserUtterance: undefined,
                      retrievedBirds: event.output
                    })),
                    sendTo("dmeTestID", ({ event, context }) => ({
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
          GeneratingBirdQuestion: {
            invoke: {
              src: "getBirdQuestion",
              input: ({ context }) => ({
                birds: context.retrievedBirds!,
                totalDescription : context.totalDescription!
              }),
              onDone: {
                target: "WaitingForInput",
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
                  sendTo("dmeTestID", ({ event }) => ({
                    type: "BIRD_QUESTION_GENERATED",
                    value: event.output,
                  })),
                ]
              }
            }
          },
        },
      },
      DME: {
        invoke: {
          src: "dme",
          id: "dmeTestID",
          input: ({ context, self }) => {
            return {
              parentRef: self,
              latest_moves: context.latest_moves,
              latest_speaker: context.latest_speaker,
              is: context.is,
            };
          },
        },
      },
    },
  });

  const runTest = (turns: Turn[]) => {
    let expectedSoFar: Turn[] = [];
    const actor = createActor(machine).start();
    test.each(turns)("$speaker> $message", async (turn) => {
      expectedSoFar.push(turn);
      if (turn.speaker === "usr") {
        console.info("user input: ", turn.message);
        actor.send({ type: "INPUT", value: turn.message });
      }
      const snapshot = await waitFor(
        actor,
        (snapshot) => snapshot.context.dialogue.length === expectedSoFar.length,
        {
          timeout: 30000 // allowed time to transition to the expected state
        }
      );
      expect(snapshot.context.dialogue).toEqual(expectedSoFar);
    },
    35000 // Vitest test timeout
    );
  };


  describe("bird observation - blue tit", () => {
    runTest([
      { speaker: "sys", message: "Hello and welcome to BirdyTalk! How can I help you?" },
      { speaker: "usr", message: "What is this bird?" },
      { speaker: "sys", message: "Where are you birdwatching today?" },
      { speaker: "usr", message: "Sweden" },
      { speaker: "sys", message: "What kind of environment is the bird in? A forest, a garden, a beach, or somewhere else?" },
      { speaker: "usr", message: "Some park" },
      { speaker: "sys", message: "Please describe the bird." },
      { speaker: "usr", message: "I see a small bird, yellow on the breast, with a blue crown" },
      { speaker: "sys", message: "I think I've identified the species: eurasian blue tit" },
    ]);
  });

  describe("bird observation - grey heron", () => {
    runTest([
      { speaker: "sys", message: "Hello and welcome to BirdyTalk! How can I help you?" },
      { speaker: "usr", message: "I want help to identify some bird" },
      { speaker: "sys", message: "Where are you birdwatching today?" },
      { speaker: "usr", message: "I'm south of France, in some wetlands" },
      { speaker: "sys", message: "Please describe the bird." },
      { speaker: "usr", message: "It's a big bird with a long neck and long legs, and it is white and grey" },
      { speaker: "sys", message: "I think I've identified the species: grey heron" },
    ]);
  });

  describe("bird observation - northern shoveler", () => {
    runTest([
      { speaker: "sys", message: "Hello and welcome to BirdyTalk! How can I help you?" },
      { speaker: "usr", message: "Please assist me in identifying a bird" },
      { speaker: "sys", message: "Where are you birdwatching today?" },
      { speaker: "usr", message: "I'm nearby the sea in Stockholm" },
      { speaker: "sys", message: "Please describe the bird." },
      { speaker: "usr", message: "It looks like a duck, with a green head, but a big spatulated beak." },
      { speaker: "sys", message: "What colour is the bird's speculum?" },
      { speaker: "usr", message: "the speculum is green" },
      { speaker: "sys", message: "I think I've identified the species: northern shoveler" },
    ]);
  });
/*
  describe("bird observation - european green woodpecker", () => {
    runTest([
      { speaker: "sys", message: "Hello and welcome to BirdyTalk! How can I help you?" },
      { speaker: "usr", message: "I'm birdwatching and want to know which species is this bird." },
      { speaker: "sys", message: "Where are you birdwatching today?" },
      { speaker: "usr", message: "In the woods, near Linköping" },
      { speaker: "sys", message: "Please describe the bird." },
      { speaker: "usr", message: "The bird resembles a woodpecker, but bigger, with a green back, and a red crown" },
      { speaker: "sys", message: "What colour is the bird's nape?" },
      { speaker: "usr", message: "the nape is red" },
      { speaker: "sys", message: "What pattern do the bird's wings have?" },
      { speaker: "usr", message: "the wings are green" },
      { speaker: "sys", message: "What colour is the bird's bill?" },
      { speaker: "usr", message: "the bill is greyish" },
      { speaker: "sys", message: "How long is the bird's tail?"},
      { speaker: "usr", message: "the tail is relatively short" },
      { speaker: "sys", message: "I think I've identified the species: european green woodpecker." },
    ]);
  });
/*
  describe("bird observation - eurasian oystercatcher", () => {
    runTest([
      { speaker: "sys", message: "Hello! You can ask me anything!" },
      { speaker: "usr", message: "I want to know species name of some bird I'm watching" },
      { speaker: "sys", message: "Where are you birdwatching today?" },
      { speaker: "usr", message: "I'm on the beach in Normandie" },
      { speaker: "sys", message: "Please describe the bird." },
      { speaker: "usr", message: "It's medium size, with  black and white plumage, a very long thin orange bill" },
      { speaker: "sys", message: "I think I've identified the species: eurasian oystercatcher." },
    ]);
  });
*/
});
