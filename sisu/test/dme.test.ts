import { describe, expect, test } from "vitest";
import { assign, createActor, sendTo, setup, waitFor } from "xstate";

import { dme } from "../src/dme";
import { initialIS } from "../src/is";
import { nlg, nlu } from "../src/nlug";
import { DMEContext, DMEEvent, NextMovesEvent } from "../src/types";

interface Turn {
  speaker: string;
  message: string | null;
}

interface TestContext extends DMEContext {
  dialogue: Turn[];
}

describe("DME tests", () => {
  const machine = setup({
    actors: {
      dme: dme,
    },
    actions: {
      notify: assign(
        ({ context }, params: { speaker: string; message: string | null }) => {
          return { dialogue: [...context.dialogue, params] };
        },
      ),
    },
    types: {} as {
      context: TestContext;
      events: DMEEvent | { type: "INPUT"; value: string | null };
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
          INPUT: {
            actions: [
              {
                type: "notify",
                params: ({ event }) => ({
                  speaker: "usr",
                  message: event.value,
                }),
              },
              sendTo(
                "dmeTestID",
                ({ event }) => ({
                  type: "SAYS",
                  value: {
                    speaker: "usr",
                    moves: event.value !== null ? nlu(event.value) : null,
                  },
                }),
                { delay: 1000 },
              ),
            ],
          },
          NEXT_MOVES: {
            actions: [
              sendTo(
                "dmeTestID",
                ({ event }) => ({
                  type: "SAYS",
                  value: {
                    speaker: "sys",
                    moves: (event as NextMovesEvent).value,
                  },
                }),
                { delay: 1000 },
              ),
              {
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
          timeout: 1000 /** allowed time to transition to the expected state */,
        },
      );
      expect(snapshot.context.dialogue).toEqual(expectedSoFar);
    });
  };

  describe("system answer from beliefs", () => {
    runTest([
      { speaker: "sys", message: "Hello! You can ask me anything!" },
      { speaker: "usr", message: "What's your favorite food?" },
      { speaker: "sys", message: "Pizza." },
    ]);
  });

  describe("(1) system answer from database - Fri", () => {
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

  describe("(1) system answer from database - Thu", () => {
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

  describe("(1) system answer from database - Tue", () => {
    runTest([
      { speaker: "sys", message: "Hello! You can ask me anything!" },
      { speaker: "usr", message: "Where is the lecture?" },
      { speaker: "sys", message: "Which day?" },
      { speaker: "usr", message: "Tuesday" },
      { speaker: "sys", message: "Which course?" },
      { speaker: "usr", message: "Dialogue Systems 2" },
      { speaker: "sys", message: "The lecture is in J440." },
    ]);
  });

  describe("(2A) negative semantic understanding feedback", () => {
    runTest([
      { speaker: "sys", message: "Hello! You can ask me anything!" },
      { speaker: "usr", message: "How is the weather today?" },
      { speaker: "sys", message: "Sorry, I don't understand." },
    ]);
  });

  describe("(2B) feedback followed by repeated question", () => {
    runTest([
      { speaker: "sys", message: "Hello! You can ask me anything!" },
      { speaker: "usr", message: "bla bla" },
      { speaker: "sys", message: "Sorry, I don't understand." },
      { speaker: "usr", message: "Where is the lecture?" },
      { speaker: "sys", message: "Which day?" },
      { speaker: "usr", message: "bla bla" },
      { speaker: "sys", message: "Sorry, I don't understand. Which day?" },
    ]);
  });

  describe("(2C) feedback followed by several repeated question", () => {
    runTest([
      { speaker: "sys", message: "Hello! You can ask me anything!" },
      { speaker: "usr", message: "Where is the lecture?" },
      { speaker: "sys", message: "Which day?" },
      { speaker: "usr", message: "bla bla" },
      { speaker: "sys", message: "Sorry, I don't understand. Which day?" },
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

  describe("(VG-A) negative perception feedback", () => {
    runTest([
      { speaker: "sys", message: "Hello! You can ask me anything!" },
      { speaker: "usr", message: null },
      { speaker: "sys", message: "I didn't hear what you said." },
    ]);
  });

  describe("(VG-A) negative perception feedback followed by repeated question", () => {
    runTest([
      { speaker: "sys", message: "Hello! You can ask me anything!" },
      { speaker: "usr", message: "Where is the lecture?" },
      { speaker: "sys", message: "Which day?" },
      { speaker: "usr", message: null },
      { speaker: "sys", message: "I didn't hear what you said. Which day?" },
      { speaker: "usr", message: "Friday" },
      { speaker: "sys", message: "Which course?" },
      { speaker: "usr", message: "Dialogue Systems 2" },
      { speaker: "sys", message: "The lecture is in G212." },
    ]);
  });
});
