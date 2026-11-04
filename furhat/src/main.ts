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

async function myFrownGesture() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  return fetch(`http://${FURHATURI}/furhat/gesture?blocking=false`, {
    method: "POST",
    headers: myHeaders,
    body: JSON.stringify({
      name: "myFrownGesture",
      frames: [
        {
          time: [0.6, 3.2],
          persist: true,
          params: {
            BROW_UP_LEFT: 1,
            BROW_DOWN_RIGHT: 0.8,

            BROW_IN_LEFT: 0.3,
            BROW_IN_RIGHT: 0.8,

            EYE_SQUINT_LEFT: 0.6,
            EYE_SQUINT_RIGHT: 0.6,

            NECK_ROLL: 8,
          },
        },
        {
          time: [3.6], //ADD TIME FRAME IN WHICH YOUR GESTURE RESETS
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

async function attendUser() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  return fetch(
    `http://${FURHATURI}/furhat/attend?user=CLOSEST`,
    {
      method: "POST",
      headers: myHeaders,
      body: "",
    },
  );
}

async function playMyOwnAudio(url: string) {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  const encUrl = encodeURIComponent(url);
  return fetch(
      `http://${FURHATURI}/furhat/say?url=${encUrl}&lipsync=false&blocking=true`,
      {method: "POST", headers: myHeaders, body: ""},
  );
}

async function mySighGesture() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  return fetch(
      `http://${FURHATURI}/furhat/gesture?blocking=false`,
      {
        method: "POST",
        headers: myHeaders,
        body: JSON.stringify({
          name: "sigh",
          frames: [
            {
              time: [0.6, 3.2],
              persist: true,
              params: {
                //NECK_TILT: 5,
                NECK_ROLL: 10,
                LOOK_UP: 0.7,
                BROW_UP_LEFT: 0.3,
                BROW_UP_RIGHT: 0.3,
              },
            },
            {
              time: [3.9],
              persist: true,
              params: { reset: true },
            },
          ],
          class: "furhatos.gestures.Gesture",
        })
      }
  )
}

async function sighWithSound() {
  await mySighGesture();
  const response = await playMyOwnAudio("http://localhost:8000/annoyed_sound_louder.wav");
  console.log("Playing custom audio: ", response.status, await response.text());
  return response;
}

async function switchLED(red: number, green: number, blue: number) {
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

// switch to red LED while furhat speaks
// call the pre-built fhSay from within function
async function redLED(text: string) {
  await switchLED(255, 0, 0); // red light
  const result = await fhSay(text); // furhat speaks, wait till done
  await switchLED(0,0,0); // turn LED off again
  return result;
}

// switch to green LED while furhat listens
// call the pre-built fhListen from within function
async function greenLED() {
  await switchLED(0, 255, 0); // green light
  const result = await fhListen(); // furhat listens, wait till done
  await switchLED(0,0,0); // turn LED off again
  return result;
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
      return fhSay("Hello, welcome to my virtual home. Can I get you anything?");
    }),
    fhL: fromPromise<any, null>(async () => {
     return greenLED();
   }),
    fhA: fromPromise<any, null>(async () => {
      return attendUser();
    }),
    fhSpeak: fromPromise<any, {text: string}>(async ({ input}) => {
      return redLED(input.text);
    }),
    fhFrown: fromPromise<any, null>(async () => {
      return myFrownGesture();
    }),
    fhAnnoyed: fromPromise<any, null>(async () => {
      return sighWithSound();
    })
  },
  types: {
    context: {} as {lastUtterance: string},
  },
}).createMachine({
  id: "root",
  context: { lastUtterance: ""},
  initial: "Start",
  states: {
    Start: { after: { 1000: "AttendUser" } },
    AttendUser: {
      invoke: {
        src: "fhA",
        input: null,
        onDone: { target: "Next"},
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      }
    },
    Next: {
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
      invoke: {
        src: "fhL",
        input: null,
        onDone: {
          target: "Repeat",
          actions: [
              ({ event }) => console.log("User: ", event.output),
              assign({lastUtterance: ({event}) => event.output ?? ""}),
          ],
        },
        onError: {
          target: "Fail",
              actions: ({ event }) => console.error(event),
        }
      },
  },
    Repeat: {
      invoke: {
      src: "fhSpeak",
        input: ({ context }) => ({
        text: context.lastUtterance ? `${context.lastUtterance}` : "Sorry, I didn't hear that. Can you repeat please?",
      }),
        onDone: {
          target: "Pause",
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    Pause: {
      after: {1800: "AnnoyedSigh"},
    },
    AnnoyedSigh: {
      invoke: {
        src: "fhAnnoyed",
        input: null,
        onDone: { target: "Frown"},
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        }
      }
    },
    Frown: {
      invoke: {
        src: "fhFrown",
        input: null,
        onDone: { target: "thatIsRidiculous"},
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    thatIsRidiculous: {
      invoke: {
        src: "fhSpeak",
        input: { text: "That was a ridiculous thing to say."},
        onDone: { target: "Done"},
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    Done: {},
    Fail: {},
  },
});

const actor = createActor(dmMachine).start();
console.log(actor.getSnapshot().value);

actor.subscribe((snapshot) => {
  console.log(snapshot.value);
});

