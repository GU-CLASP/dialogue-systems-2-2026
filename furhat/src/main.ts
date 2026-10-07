import { assign, createActor, fromPromise, setup } from "xstate";

import {
  fhAttend,
  fhAudio,
  fhGesture,
  fhLed,
  fhListen,
  fhSay,
  fhVoice,
  newGesture,
} from "./services";

// const FURHATURI = "http://127.0.0.1:54321";
const AUDIO_URL =
  "https://raw.githubusercontent.com/kscottz/PiCommander/master/lion_growl.wav";

// let furhatUrlBase = "";

type LEDColor = {
  red?: number;
  green?: number;
  blue?: number;
};

type Gesture = {
  name: string;
  blocking: boolean;
};

type Audio = {
  url: string;
  blocking: boolean;
};

const dmMachine = setup({
  actors: {
    fhVoice: fromPromise<any, null>(async () => {
      return fhVoice("en-US-EchoMultilingualNeural");
    }),
    fhSay: fromPromise<any, string>(async ({ input }) => {
      return fhSay(input);
    }),
    fhAudio: fromPromise<any, Audio>(async ({ input }) => {
      const { url, blocking } = input;
      return fhAudio(url, blocking);
    }),
    fhListen: fromPromise<any, null>(async () => {
      return fhListen();
    }),
    fhAttend: fromPromise<any, null>(async () => {
      return fhAttend("CLOSEST");
    }),
    fhLed: fromPromise<any, LEDColor>(async ({ input }) => {
      const { red, green, blue } = input;
      return fhLed(red, green, blue);
    }),
    fhNewGesture: fromPromise<any, null>(async () => {
      return newGesture();
    }),
    fhGesture: fromPromise<any, Gesture>(async ({ input }) => {
      const { name, blocking } = input;
      return fhGesture(name, blocking);
    }),
  },
}).createMachine({
  id: "root",
  context: {
    lastUtterance: null,
  },
  initial: "Attend",
  states: {
    Attend: {
      entry: () => fhLed(0, 0, 0),
      invoke: {
        src: "fhAttend",
        input: null,
        onDone: {
          target: "Greet",
          actions: ({ event }) => console.log("\t", event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    Greet: {
      entry: () => {
        fhLed(255, 0, 0);
        newGesture();
      },
      invoke: {
        src: "fhSay",
        input: "Hello there",
        onDone: {
          target: "Listen",
          actions: ({ event }) => console.log("\t", event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    NoInput: {
      entry: () => {
        fhLed(255, 0, 0);
        fhGesture("Shake", false);
      },
      invoke: {
        src: "fhSay",
        input: "I can't hear you.",
        onDone: {
          target: "Listen",
          actions: ({ event }) => console.log("\t", event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    Repeat: {
      entry: () => fhLed(255, 0, 0),
      invoke: {
        src: "fhSay",
        input: ({ context }) => `You said ${context.lastUtterance}`,
        onDone: [
          {
            target: "Angry",
            guard: ({ context }) =>
              context.lastUtterance?.toLowerCase().includes("angry") ?? false,
            actions: ({ event }) => console.log("\t", event.output),
          },
          {
            target: "Listen",
            actions: ({ event }) => console.log("\t", event.output),
          },
        ],
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    Angry: {
      entry: () => {
        fhLed(255, 0, 0);
        fhGesture("ExpressAnger", false);
      },
      invoke: {
        src: "fhAudio",
        input: {
          url: AUDIO_URL,
          blocking: true,
        },
        onDone: {
          target: "Listen",
          actions: ({ event }) => console.log("\t", event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    Listen: {
      entry: () => fhLed(0, 255, 0),
      invoke: {
        src: "fhListen",
        input: null,
        onDone: [
          {
            target: "NoInput",
            guard: ({ event }) => {
              return (
                !event.output.message ||
                event.output.message.trim() === "" ||
                event.output.message === "SILENCE"
              );
            },
            actions: () => console.log("\tNo input"),
          },
          {
            target: "Repeat",
            actions: [
              assign({
                lastUtterance: ({ event }) => event.output.message,
              }),
              ({ event }) => console.log("\t", event.output.message),
            ],
          },
        ],
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    Fail: {},
  },
});

const actor = createActor(dmMachine).start();
console.log(`[State]: ${actor.getSnapshot().value}`);

actor.subscribe((snapshot) => {
  console.log(`[State] ${snapshot.value}`);
});
