import { setup, createActor, sendTo, assign, waitFor } from "xstate";
import { describe, expect, test } from "vitest";
import { DMEContext, DMEEvent, NextMovesEvent } from "../src/types";
import { dme } from "../src/dme";
import { nlu, nlg } from "../src/nlug";
import { initialIS } from "../src/is";

interface Turn {
  speaker: string;
  message: string;
} // one line in the conversation

interface TestContext extends DMEContext {
  dialogue: Turn[]; // test stores a list of all dialogue turns
}

describe("DME tests", () => { // the test state machine
  const machine = setup({
    actors: {
      dme: dme,
    },
    actions: {
      notify: assign( // adds a new turn to the stored dialogue
        ({ context }, params: { speaker: string; message: string }) => {
          return { dialogue: [...context.dialogue, params] };
        }
      ),
    },
    types: {} as {
      context: TestContext;
      events: DMEEvent | { type: "INPUT"; value: string };
    },
  }).createMachine({
    context: {
      dialogue: [],
      parentRef: null,
      is: initialIS(),
    },
    initial: "DME",
    type: "parallel",
    states: {
      TestInterface: {
        on: {
          INPUT: { // when the user speaks
            actions: [
              { // first record the user message
                type: "notify",
                params: ({ event }) => ({
                  speaker: "usr",
                  message: event.value,
                }),
              },
              sendTo( // runs NLU
                "dmeTestID",
                ({ event }) => ({
                  type: "SAYS",
                  value: {
                    speaker: "usr",
                    moves: nlu(event.value),
                  },
                }),
                { delay: 1000 }
              ),
            ],
          },
          NEXT_MOVES: { // when the system wants to speak
            actions: [
              sendTo( // the systems own move is sent back into DME
                "dmeTestID", // allows the information state to remember what the system just said
                ({ event }) => ({
                  type: "SAYS",
                  value: {
                    speaker: "sys",
                    moves: (event as NextMovesEvent).value,
                  },
                }),
                { delay: 1000 }
              ),
              { // runs the system moves through NLG
                type: "notify",
                params: ({ event }: any) => ({
                  speaker: "sys",
                  message: nlg(event.value),
                }),
                delay: 2000,
              },
            ],
          },
        },
      },
      DME: {
        invoke: { // starts the actual dialogue manager as a child actor
          src: "dme",
          id: "dmeTestID",
          input: ({ context, self }) => { // what the dme recieves
            return {
              parentRef: self,
              latest_moves: context.latest_moves,
              latest_speaker: context.latest_speaker,
              is: context.is, // DME starts with the initial information state defifined in is.ts
            };
          },
        },
      },
    },
  });

  const runTest = (turns: Turn[]) => { // takes an expected conversation
    let expectedSoFar: Turn[] = []; // starts with no expected dialogue
    const actor = createActor(machine).start(); // starts the test state machine
    test.each(turns)("$speaker> $message", async (turn) => { // Vitest creates one test for every turn
      expectedSoFar.push(turn); // adds the current expected turn
      if (turn.speaker === "usr") { // if it is the users turn
        console.info("user input: ", turn.message);
        actor.send({ type: "INPUT", value: turn.message }); // send that input to the system
      } // but for system turns, it does not manually send anything, it waits for the dialogue manager to produce that system output automatically
      const snapshot = await waitFor(
        actor, // wait until the real dialogue contains as many turns as we currently expect
        (snapshot) => snapshot.context.dialogue.length === expectedSoFar.length,
        {
          timeout: 1000 /** allowed time to transition to the expected state */,
        }
      );
      expect(snapshot.context.dialogue).toEqual(expectedSoFar); // vitest checks whether the real conversation exactly equals the expected one
    });
  };

  describe("system answer from beliefs", () => { // first test: test sth system already knows in its beliefs
    runTest([
      { speaker: "sys", message: "Hello! You can ask me anything!" },
      { speaker: "usr", message: "What's your favorite food?" },
      { speaker: "sys", message: "Pizza." },
    ]);
  });

  // I added friday as well cuz of task one here
  describe("system answer from database", () => {
    runTest([
      { speaker: "sys", message: "Hello! You can ask me anything!" },
      { speaker: "usr", message: "Where is the lecture?" },
      { speaker: "sys", message: "Which day?" },
      { speaker: "usr", message: "Friday" },
      { speaker: "sys", message: "Which course?" },
      { speaker: "usr", message: "Dialogue Systems 2" },
      { speaker: "sys", message: "The lecture is in G212." },
    ]);
  });

  // for task one, failing tests

  describe("system answer from database, with day (Thursday)", () => {
    runTest([
      { speaker: "sys", message: "Hello! You can ask me anything!" },
      { speaker: "usr", message: "Where is the lecture?" },
      { speaker: "sys", message: "Which day?" },
      { speaker: "usr", message: "Thursday" },
      { speaker: "sys", message: "Which course?" },
      { speaker: "usr", message: "Dialogue Systems 2" },
      { speaker: "sys", message: "The lecture is in J440." },
    ]);
  });

  describe("system answer from database, with day (Friday)", () => {
    runTest([
      { speaker: "sys", message: "Hello! You can ask me anything!" },
      { speaker: "usr", message: "Where is the lecture?" },
      { speaker: "sys", message: "Which day?" },
      { speaker: "usr", message: "Friday" },
      { speaker: "sys", message: "Which course?" },
      { speaker: "usr", message: "Dialogue Systems 2" },
      { speaker: "sys", message: "The lecture is in G212." },
    ]);
  });

  // 2a
  describe("negative understanding feedback (no pending question)", () => {
    runTest([
      { speaker: "sys", message: "Hello! You can ask me anything!" },
      { speaker: "usr",message: "bla bla" },
      {speaker: "sys", message: "Sorry, I don't understand." },
    ]);
  });

  // 2b
  describe("negative understanding feedback with repeated question", () => {
    runTest([
      { speaker: "sys", message:"Hello! You can ask me anything!" },
      { speaker: "usr", message: "Where is the lecture?" },
      {speaker: "sys", message: "Which day?" },
      { speaker: "usr", message:"bla bla" },
      { speaker: "sys", message: "Sorry, I don't understand. Which day?" },
    ]);
  });

  //  2c
  describe("recovers and gives room info after repeated misunderstandings", () => {
    runTest([
      { speaker: "sys", message: "Hello! You can ask me anything!" },
      { speaker: "usr", message: "bla bla" },
      { speaker: "sys", message: "Sorry, I don't understand." },
      { speaker: "usr", message: "Where is the lecture?" },
      { speaker: "sys", message: "Which day?" },
      { speaker: "usr", message: "bla bla" },
      { speaker: "sys", message: "Sorry, I don't understand. Which day?" },
      { speaker: "usr", message: "Friday" },
      { speaker: "sys", message: "Which course?" },
      { speaker: "usr", message: "bla bla" },
      { speaker: "sys", message: "Sorry, I don't understand. Which course?" },
      { speaker: "usr", message: "Dialogue Systems 2" },
      { speaker: "sys", message: "The lecture is in G212." },
    ]);
  });

});
