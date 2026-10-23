import { setup, createActor, fromPromise, assign } from "xstate";

const FURHATURI = "127.0.0.1:54321";

async function fhVoice(name: string) {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  const encName = encodeURIComponent(name);

  return fetch(`http://${FURHATURI}/furhat/voice?name=${encName}`, {
    method: "POST",
    headers: myHeaders,
    body: "",
  });
} 

async function fhAttendClosest() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");

  return fetch(`http://${FURHATURI}/furhat/attend?user=CLOSEST`, {
    method: "POST",
    headers: myHeaders,
    body: "",
  });
}

async function fhSay(text: string) {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  const encText = encodeURIComponent(text);

  return fetch(`http://${FURHATURI}/furhat/say?text=${encText}&blocking=true`, {
    method: "POST",
    headers: myHeaders,
    body: "",
  });
}

async function newGesture() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  myHeaders.append("Content-Type", "application/json");

  const response = await fetch(
    `http://${FURHATURI}/furhat/gesture?blocking=false`,
    {
      method: "POST",
      headers: myHeaders,
      body: JSON.stringify({
        name: "newGesture",
        frames: [
          {
            time: [0.3],
            persist: true,
            params: {
              BROW_UP_LEFT: 1.0,
              BROW_UP_RIGHT: 1.0,
              SMILE_OPEN: 0.5,
            },
          },
          {
            time: [1.5],
            persist: true,
            params: {
              reset: true,
            },
          },
        ],
        class: "furhatos.gestures.Gesture",
      }),
    },
  );

  console.log(
    "Custom gesture:",
    response.status,
    response.statusText,
    await response.text(),
  );

  return response;
}

async function fhGesture(text: string) {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");

  return fetch(
    `http://${FURHATURI}/furhat/gesture?name=${text}&blocking=true`,
    {
      method: "POST",
      headers: myHeaders,
      body: "",
    },
  );
}

async function fhListen() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");

  return fetch(`http://${FURHATURI}/furhat/listen`, {
    method: "GET",
    headers: myHeaders,
  })
    .then((response) => response.body)
    .then((body) => body.getReader().read())
    .then((reader) => reader.value)
    .then((value) => JSON.parse(new TextDecoder().decode(value)).message);
}

async function fhLedRed() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");

  return fetch(
    `http://${FURHATURI}/furhat/led?red=127&green=0&blue=0`,
    {
      method: "POST",
      headers: myHeaders,
      body: "",
    },
  );
}

async function fhLedOff() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");

  return fetch(
    `http://${FURHATURI}/furhat/led?red=0&green=0&blue=0`,
    {
      method: "POST",
      headers: myHeaders,
      body: "",
    },
  );
}

const dmMachine = setup({
  actors: {
    fhAttend: fromPromise<any, null>(async () => {
      return fhAttendClosest();
    }),

    fhVoice: fromPromise<any, null>(async () => {
      return fhVoice("en-US-EchoMultilingualNeural");
    }),

    fhHello: fromPromise<any, null>(async () => {
      return fhSay("Hi! Say something and I will repeat it back to you.");
    }),

    fhL: fromPromise<any, null>(async () => {
      return fhListen();
    }),

    fhRepeat: fromPromise<any, { text: string }>(async ({ input }) => {
      return fhSay(`You said: ${input.text}`);
    }),

    fhLedRed: fromPromise<any, null>(async () => {
      return fhLedRed();
    }),

    fhLedOff: fromPromise<any, null>(async () => {
      return fhLedOff();
    }),

    fhNewGesture: fromPromise<any, null>(async () => {
      return newGesture();
    }),

    // NEW:
    fhGestureWithSound: fromPromise<any, null>(async () => {
      await Promise.all([
        fhGesture("Smile"),
        fhSay("Nice!"),
      ]);
    }),
  },
}).createMachine({
  id: "root",

  context: {
    userUtterance: "",
  },

  initial: "Start",

  states: {
    Start: {
      after: {
        1000: "Attend",
      },
    },

    Attend: {
      invoke: {
        src: "fhAttend",
        input: null,

        onDone: {
          target: "Next" as const,
          actions: ({ event }) => console.log(event.output),
        },

        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },

    Next: {
      invoke: {
        src: "fhHello",
        input: null,

        onDone: {
          target: "CustomGesture",
        },

        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },

    CustomGesture: {
      invoke: {
        src: "fhNewGesture",
        input: null,

        onDone: {
          target: "Listen",
        },

        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },

    Listen: {
      invoke: {
        src: "fhL",
        input: null,

        onDone: {
          target: "LedOn",

          actions: assign({
            userUtterance: ({ event }) => event.output,
          }),
        },

        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },

    LedOn: {
      invoke: {
        src: "fhLedRed",
        input: null,

        onDone: {
          target: "Repeat",
        },

        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },

    Repeat: {
      invoke: {
        src: "fhRepeat",

        input: ({ context }) => ({
          text: context.userUtterance,
        }),

        onDone: {
          target: "GestureWithSound",
        },

        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },

    // NEW:
    GestureWithSound: {
      invoke: {
        src: "fhGestureWithSound",
        input: null,

        onDone: {
          target: "LedOff",
        },

        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },

    LedOff: {
      invoke: {
        src: "fhLedOff",
        input: null,

        onDone: {
          target: "Listen",
        },

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

console.log(actor.getSnapshot().value);

actor.subscribe((snapshot) => {
  console.log(snapshot.value);
});