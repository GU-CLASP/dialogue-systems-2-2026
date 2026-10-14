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
  }).then((response) => response.json());
}


const LED_RED = [255, 0, 0] as const;
const LED_OFF = [0, 0, 0] as const;
async function fhLed([red, green, blue]: readonly [number, number, number]) {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  return fetch(
    `http://${FURHATURI}/furhat/led?red=${red}&green=${green}&blue=${blue}`,
    { method: "POST", headers: myHeaders, body: "" },
  );
}

const setLed = (colour: readonly [number, number, number]) => {
  fhLed(colour).catch((e) => console.error("LED error:", e));
};


async function newGesture() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  return fetch(`http://${FURHATURI}/furhat/gesture?blocking=false`, {
    method: "POST",
    headers: myHeaders,
    body: JSON.stringify({
      name: "SmileTilt",
      frames: [
        {
          time: [0.4],
          persist: true,
          params: {
            SMILE_OPEN: 0.7,
            NECK_ROLL: 12,
          },
        },
        {
          time: [1.8],
          persist: true,
          params: {
            reset: true,
          },
        },
      ],
      class: "furhatos.gestures.Gesture",
    }),
  });
}

const playSmileTilt = () => {
  newGesture().catch((e) => console.error("Gesture error:", e));
};


const AUDIO_URL = "https://www.wavsource.com/snds_2020-10-01_3728627494378403/sfx/ahem_x.wav";

async function fhPlayAudio(url: string) {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  return fetch(
    `http://${FURHATURI}/furhat/say?url=${encodeURIComponent(url)}&blocking=true`,
    { method: "POST", headers: myHeaders, body: "" },
  );
}

async function chimeGesture() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  return fetch(`http://${FURHATURI}/furhat/gesture?blocking=false`, {
    method: "POST",
    headers: myHeaders,
    body: JSON.stringify({
      name: "SurpriseChime",
      frames: [
        {
          time: [0.1],
          persist: true,
          params: { BROW_UP_LEFT: 1.0, BROW_UP_RIGHT: 1.0, SMILE_OPEN: 0.5 },
        },
        { time: [1.2], persist: true, params: { reset: true } },
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
    .then((response) => response.json())
        .then((status) => {
      console.log("listen:", status);
      return status.success === false ? "" : String(status.message ?? "").trim();
    });
}

const NOT_HEARD = ["SILENCE", "INTERRUPTED", "FAILED"];

const dmMachine = setup({
  types: {} as { context: { heard: string } },
  actors: {
    fhVoice: fromPromise<any, null>(async () => {
      return fhVoice("en-US-EchoMultilingualNeural");
    }),
    fhAttend: fromPromise<any, null>(async () => {
      return fhAttend();
    }),
    fhSay: fromPromise<any, { text: string }>(async ({ input }) => {
      return fhSay(input.text);
    }),
    fhChime: fromPromise<any, null>(async () => {
      chimeGesture().catch((e) => console.error("Gesture error:", e));
      return fhPlayAudio(AUDIO_URL);
    }),
    fhL: fromPromise<string, null>(async () => {
      return fhListen();
    }),
  },
}).createMachine({
  id: "root",
  initial: "Start",
  context: { heard: "" },
  states: {
    Start: { after: { 1000: "Attend" } },
    Attend: {
      invoke: {
        src: "fhAttend",
        input: null,
        onDone: {
          target: "Chime",
          actions: ({ event }) => console.log("attend:", event.output),
        },
        onError: { target: "Fail", actions: ({ event }) => console.error(event) },
      },
    },
    Chime: {
      entry: () => setLed(LED_RED),
      invoke: {
        src: "fhChime",
        input: null,
        onDone: "Greet",
        onError: { target: "Fail", actions: ({ event }) => console.error(event) },
      },
    },
    Greet: {
      entry: () => {
        setLed(LED_RED);
        playSmileTilt();
      },
      invoke: {
        src: "fhSay",
        input: { text: "Hi! Say something and I will repeat it." },
        onDone: "Listen",
        onError: { target: "Fail", actions: ({ event }) => console.error(event) },
      },
    },
    Listen: {
      entry: () => setLed(LED_OFF),
      invoke: {
        src: "fhL",
        input: null,
        onDone: [
          {
            guard: ({ event }) => event.output === "" || NOT_HEARD.includes(event.output),
            target: "Reprompt",
            actions: ({ event }) => console.log("not heard:", event.output),
          },
          {
            target: "Echo",
            actions: assign({ heard: ({ event }) => event.output }),
          },
        ],
        onError: { target: "Fail", actions: ({ event }) => console.error(event) },
      },
    },
    Echo: {
      entry: () => {
        setLed(LED_RED);
        playSmileTilt();
      },
      invoke: {
        src: "fhSay",
        input: ({ context }) => ({ text: `You said: ${context.heard}` }),
        onDone: "Attend2",
        onError: { target: "Fail", actions: ({ event }) => console.error(event) },
      },
    },
    Reprompt: {
      entry: () => setLed(LED_RED),
      invoke: {
        src: "fhSay",
        input: { text: "I didn't hear anything. Try again." },
        onDone: "Attend2",
        onError: { target: "Fail", actions: ({ event }) => console.error(event) },
      },
    },
    Attend2: {
      invoke: {
        src: "fhAttend",
        input: null,
        onDone: "Listen",
        onError: { target: "Fail", actions: ({ event }) => console.error(event) },
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

