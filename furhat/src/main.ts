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

async function fhAttend() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  return fetch(`http://${FURHATURI}/furhat/attend?user=CLOSEST`, {
    method: "POST",
    headers: myHeaders,
    body: "",
  });
}

async function fhLED(red: number, green: number, blue: number) {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  return fetch(
    `http://${FURHATURI}/furhat/led?red=${red}&green=${green}&blue=${blue}`,
    {
      method: "POST",
      headers: myHeaders,
      body: "",
    },
  );
}

async function newGesture() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  return fetch(`http://${FURHATURI}/furhat/gesture?blocking=true`, {
    method: "POST",
    headers: myHeaders,
    body: JSON.stringify({
      name: "CheekyWink",
      frames: [
        {
          time: [0.3],
          persist: false,
          params: {
            SMILE_CLOSED: 0.6,
            NECK_ROLL: 8.0,
          },
        },
        {
          time: [0.5],
          persist: false,
          params: {
            BLINK_LEFT: 1.0,
            BROW_UP_RIGHT: 0.7,
          },
        },
        {
          time: [0.8],
          persist: false,
          params: {
            BLINK_LEFT: 0.0,
          },
        },
        {
          time: [1.5],
          persist: false,
          params: {
            reset: true,
          },
        },
      ],
      class: "furhatos.gestures.Gesture",
    }),
  });
}

async function grumpyGesture() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  const soundPath = `file://${process.cwd()}/sounds/noway.wav`;
  return fetch(`http://${FURHATURI}/furhat/gesture?blocking=true`, {
    method: "POST",
    headers: myHeaders,
    body: JSON.stringify({
      name: "Grumpy",
      frames: [
        {
          time: [0.3],
          persist: false,
          audio: soundPath,
          params: {
            BROW_DOWN_LEFT: 1.0,
            BROW_DOWN_RIGHT: 1.0,
            NECK_PAN: 20.0,
          },
        },
        {
          time: [1.5],
          persist: false,
          params: {
            reset: true,
          },
        },
      ],
      class: "furhatos.gestures.Gesture",
    }),
  });
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

const dmMachine = setup({
  actors: {
    fhVoice: fromPromise<any, null>(async () => {
      return fhVoice("JennyNeural");
    }),
    fhHello: fromPromise<any, null>(async () => {
      return fhSay("Hi");
    }),
    fhL: fromPromise<any, null>(async () => {
      return fhListen();
    }),
    fhAttendUser: fromPromise<any, null>(async () => {
      return fhAttend();
    }),
    fhSpeak: fromPromise<any, { text: string }>(async ({ input }) => {
      return fhSay(input.text);
    }),
    fhCheekyWink: fromPromise<any, null>(async () => {
      return newGesture();
    }),
    fhGrumpy: fromPromise<any, null>(async () => {
      return grumpyGesture();
    }),
  },
}).createMachine({
  id: "root",
  initial: "Start",
  context: { lastResult: "" },
  states: {
    Start: { after: { 1000: "SetVoice" } },
    SetVoice: {
      invoke: {
        src: "fhVoice",
        input: null,
        onDone: {
          target: "Attend",
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    Attend: {
      invoke: {
        src: "fhAttendUser",
        input: null,
        onDone: {
          target: "Next",
          actions: ({ event }) => console.log(event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    Next: {
      entry: () => fhLED(255, 0, 0),
      invoke: {
        src: "fhHello",
        input: null,
        onDone: {
          target: "Listen",
          actions: ({ event }) => console.log(event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    Listen: {
      entry: () => fhLED(0, 0, 0),
      invoke: {
        src: "fhL",
        input: null,
        onDone: {
          target: "Wink",
          actions: assign({ lastResult: ({ event }) => event.output }),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    Wink: {
      entry: () => fhLED(255, 0, 0),
      invoke: {
        src: "fhCheekyWink",
        input: null,
        onDone: {
          target: "Echo",
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    Echo: {
      entry: () => fhLED(255, 0, 0),
      invoke: {
        src: "fhSpeak",
        input: ({ context }) => ({ text: `You said ${context.lastResult}` }),
        onDone: {
          target: "Grumpy",
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    Grumpy: {
      invoke: {
        src: "fhGrumpy",
        input: null,
        onDone: {
          target: "Done",
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    Done: {
      entry: () => fhLED(0, 0, 0),
    },
    Fail: {},
  },
});

const actor = createActor(dmMachine).start();
console.log(actor.getSnapshot().value);

actor.subscribe((snapshot) => {
  console.log(snapshot.value);
});

