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

// implementing user tracking (closest user)
async function fhAttend() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");

  return fetch(`http://${FURHATURI}/furhat/attend?user=CLOSEST`, {
    method: "POST",
    headers: myHeaders,
    body: "",
  });
}

// LED light
async function fhLED(red: number, green: number, blue: number) {
  const response = await fetch(
    `http://${FURHATURI}/furhat/led?red=${red}&green=${green}&blue=${blue}`, 
    {
      method: "POST",
    }
  );

  if (!response.ok) {
    throw new Error(`LED failed: ${response.status}`);
  }

  return response;
}

// new Gesture
async function ponderingGesture() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  myHeaders.append("Content-Type", "application/json");

  return fetch(`http://${FURHATURI}/furhat/gesture?blocking=true`, {
    method: "POST",
    headers: myHeaders,
    body: JSON.stringify({
      name: "PonderingGesture",
      frames: [
        {
          time: [0.3],
          persist: true,
          params: {
            GAZE_PAN: 10,
            GAZE_TILT: -15,
            NECK_PAN: 5,
            BROW_UP_LEFT: 1.0,
            BROW_UP_RIGHT: 1.0,
          },
        },
        {
          time: [1.5],
          persist: true,
          params: {
            GAZE_PAN: -10,
            GAZE_TILT: -15,
            NECK_PAN: -5,
            BROW_UP_LEFT: 1.0,
            BROW_UP_RIGHT: 1.0,
          },
        },
        {
          time: [2.5],
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

// new Gesture with sound
async function laughGesture() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  myHeaders.append("Content-Type", "application/json");

  return fetch(`http://${FURHATURI}/furhat/gesture?blocking=true`, {
    method: "POST",
    headers: myHeaders,
    body: JSON.stringify({
      name: "LaughGesture",
      frames: [
        {
          time: [0.2],
          persist: true,
          params: {
            SMILE_OPEN: 1.0,
            SMILE_CLOSED: 0.7,
            SQUINT_LEFT: 0.7,
            SQUINT_RIGHT: 0.7,
            NECK_TILT: 5,
          },
        },
        {
          time: [0.7],
          persist: true,
          params: {
            SMILE_OPEN: 1.0,
            SQUINT_LEFT: 1.0,
            SQUINT_RIGHT: 1.0,
            NECK_TILT: -5,
          },
        },
        {
          time: [1.2],
          persist: true,
          params: {
            SMILE_OPEN: 1.0,
            SQUINT_LEFT: 0.7,
            SQUINT_RIGHT: 0.7,
            NECK_TILT: 5,
          },
        },
        {
          time: [2.5],
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

// adding the audio
async function laughWithAudio() {
  return Promise.all([ // starting both operations at the same time
    laughGesture(),
    fhSay("Hihihi hihi!"),
  ]);
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

  // implementing a simple dialogue
  types: {
    context: {} as {
      userSpeech: string;
    },
  },

  actors: {
    fhVoice: fromPromise<any, null>(async () => {
      return fhVoice("en-US-EchoMultilingualNeural");
    }),
    fhHello: fromPromise<any, null>(async () => {
      await fhLED(127, 0, 0); // turning the LED red
      return fhSay("Hi! What's up?");
    }),
    fhL: fromPromise<any, null>(async () => {
      await fhLED(0, 127, 0); // turning the LED green
      return fhListen();
   }),
   fhAttend: fromPromise<any, null>(async () => {
      return fhAttend();
   }),
   fhRepeat: fromPromise<any, { text: string }>(async ({ input }) => {
      await fhLED(127, 0, 0); // turning the LED red
      return fhSay(`You said: ${input.text}`);
   }),
   fhPonderingGesture: fromPromise<any, null>(async () => {
      await fhLED(127, 0, 0); // turning the LED red
      return ponderingGesture();
   }),
   fhLaughGesture: fromPromise<any, null>(async () => {
      await fhLED(127, 0, 0); // turning the LED red
      return laughWithAudio();
   }),
  },
}).createMachine({
  id: "root",

  // implementing a simple dialogue
  context: {
    userSpeech: "",
  },

  initial: "Start",
  states: {
    Start: {
      invoke: {

        // added attending to the closest user
        src: "fhAttend",
        input: null,
        onDone: {
          target: "Next",
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
          target: "Listen",
          //  actions: ({ event }) => console.log(event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },

    // implementing a simple dialogue
    Listen: {
      invoke: {
        src: "fhL",
        input: null,
        onDone: {
          target: "Gesture",

          actions: assign({
            userSpeech: ({ event }) => event.output,
          }),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },

      },
    },

    // adding the new gesture to the dialogue
    Gesture: {
      invoke: {
        src: "fhPonderingGesture",
        input: null,
        onDone: {
          target: "Laugh",
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },

    // adding gesture with audio
    Laugh: {
      invoke: {
        src: "fhLaughGesture",
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

    // implementing a simple dialogue
    Repeat: {
      invoke: {
        src: "fhRepeat",
        input: ({ context }) => ({
          text: context.userSpeech,
        }),
        onDone: {
          target: "Done",
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },

    Fail: {
      entry: () => {
        fhLED(0, 0, 0).catch(console.error); // turning the LED off
      },
    },
    Done: {
      entry: () => {
        fhLED(0, 0, 0).catch(console.error); // turning the LED off
      },
    },
  },
});

const actor = createActor(dmMachine).start();
console.log(actor.getSnapshot().value);

actor.subscribe((snapshot) => {
  console.log(snapshot.value);
});
