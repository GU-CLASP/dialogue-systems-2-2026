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
async function fhSound(url: string) {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  const encUrl = encodeURIComponent(url);
  return fetch(`http://${FURHATURI}/furhat/say?url=${encUrl}&blocking=false`, {
    method: "POST",
    headers: myHeaders,
    body: "",
  });
}

async function fhAttend(user: string) {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  const encUser = encodeURIComponent(user);
  return fetch(`http://${FURHATURI}/furhat/attend?user=${encUser}`, {
    method: "POST",
    headers: myHeaders,
    body: "",
  });
}

async function fhLED(red: number, green: number, blue: number) {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  const encRed = encodeURIComponent(red.toString());
  const encGreen = encodeURIComponent(green.toString());
  const encBlue = encodeURIComponent(blue.toString());
  return fetch(`http://${FURHATURI}/furhat/led?red=${encRed}&green=${encGreen}&blue=${encBlue}`, {
    method: "POST",
    headers: myHeaders,
    body: "",
  });
}

async function newGesture() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  return fetch(`http://${FURHATURI}/furhat/gesture?blocking=true`, {
    method: "POST",
    headers: myHeaders,
    body: JSON.stringify({
      name: "FlirtyWink",
      frames: [
        {
          time: [0.4], //ADD THE TIME FRAME OF YOUR LIKING
          persist: true,
          params: {
            //ADD PARAMETERS HERE IN ORDER TO CREATE A GESTURE
            BLINK_LEFT: 1.0,
            EYE_SQUINT_LEFT: 0.4,
            BROW_DOWN_LEFT: 0.5,
            SMILE_OPEN: 0.4,
          },
        },
        {
          time: [0.6], //ADD TIME FRAME IN WHICH YOUR GESTURE RESETS
          persist: true,
          params: {
            reset: true,
          },
        },
        //ADD MORE TIME FRAMES IF YOUR GESTURE REQUIRES THEM
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
      return fhVoice("en-US-EchoMultilingualNeural");
    }),
    fhHello: fromPromise<any, null>(async () => {
      return fhSay("Hi");
    }),
    fhL: fromPromise<any, null>(async () => {
     return fhListen();
   }),
    fhAttend: fromPromise<any, null>(async () => {
     return fhAttend("CLOSEST");
   }),
    
    fhRepeat: fromPromise<any, string>(async ({ input }) => {
      return fhSay(input);
    }),
    
    fhLEDRed: fromPromise<any, null>(async () => {
      return fhLED(255,0,0);
    }),

    fhLEDOff: fromPromise<any, null>(async () => {
      return fhLED(0,0,0);
    }),

    fhCreateFlirtyWink: fromPromise<any, null>(async () => {
      return newGesture();
    }),

    fhSoundWink: fromPromise<any, null>(async () => {
      return Promise.all([
        fhSound("https://raw.githubusercontent.com/Nosstogla/dialogue-systems-2-2026-fork/lab-3/furhat/sound/cartoon_wink_magic_sparkle.wav"),
        newGesture()
      ]);
    }),
 
  },
}).createMachine({
  id: "root",
  initial: "Start",
  context: {
    userSaid: "",
  },
  states: {
    Start: { after: { 1000: "Attend" } },
    Attend: {
      invoke: {
        src: "fhAttend",      
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
      invoke: {
        src: "fhHello",      
        input: null,
        onDone: {
          target: "CreateFlirtyWink",
          actions: ({ event }) => console.log(event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    CreateFlirtyWink: {
      invoke: {
        src: "fhCreateFlirtyWink",
        input: null,
        onDone: {
          target: "FlirtyWinkAndSound",
          actions: ({ event }) => console.log(event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    FlirtyWinkAndSound: {
        invoke: {
        src: "fhSoundWink",
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
      invoke: {
        src: "fhL",      
        input: null,
        onDone: {
          target: "LEDRed",
          actions: assign({
            userSaid: ({ event }) => event.output,
          }),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    LEDRed: {
      invoke: {
        src: "fhLEDRed",      
        input: null,
        onDone: {
          target: "Repeat",
          actions: ({ event }) => console.log(event.output),
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
        input: ({ context }) => context.userSaid,
        onDone: {
          target: "LEDOff",
          actions: ({ event }) => console.log(event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    LEDOff: {
      invoke: {
        src: "fhLEDOff",      
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
    Fail: {},
  },
});

const actor = createActor(dmMachine).start();
console.log(actor.getSnapshot().value);

actor.subscribe((snapshot) => {
  console.log(snapshot.value);
});

