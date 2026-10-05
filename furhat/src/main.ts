import { setup, createActor, fromPromise, assign } from "xstate";

const FURHATURI = "127.0.0.1:54321";

type DMContext = {
  lastUtterance: string | undefined,
}

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

async function newGesture() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  return fetch(`http://${FURHATURI}/furhat/gesture?blocking=false`, {
    method: "POST",
    headers: myHeaders,
    body: JSON.stringify({
      name: "newGesture",
      frames: [
        {
          time: [], //ADD THE TIME FRAME OF YOUR LIKING
          persist: true,
          params: {
            //ADD PARAMETERS HERE IN ORDER TO CREATE A GESTURE
          },
        },
        {
          time: [], //ADD TIME FRAME IN WHICH YOUR GESTURE RESETS
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

async function fhGetUser() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  return fetch(`http://${FURHATURI}/furhat/users`, {
    method: "GET",
    headers: myHeaders,
    //body:"",
  });
}

async function fhAttendUser() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  return fetch(`http://${FURHATURI}/furhat/attend?user=CLOSEST`, {
    method: "POST",
    headers: myHeaders,
    body: JSON.stringify({enum: "CLOSEST"}),
  });
}

// built-in BigSmile gesture implemented for testing (source code: https://docs.furhat.io/remote-api/#furhatgestures)
async function fhBigSmile() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  return fetch(`http://${FURHATURI}/furhat/gesture?blocking=false`, {
    method: "POST",
    headers: myHeaders,
    body: JSON.stringify({
      name: "BigSmile",
      frames:[
    {
      "time":[0.32,0.64],
      "persist":false, 
      "params":{
        "BROW_UP_LEFT":1,
        "BROW_UP_RIGHT":1,
        "SMILE_OPEN":0.4,
        "SMILE_CLOSED":0.7
        }
    },
    {
      "time":[0.96],
      "persist":false, 
      "params":{
        "reset":true
        }
    }],
  class:"furhatos.gestures.Gesture"
    }),
  });
}

async function fhRollingEyes() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  return fetch(`http://${FURHATURI}/furhat/gesture?blocking=false`, {
    method: "POST",
    headers: myHeaders,
    body: JSON.stringify({
      name: "RollingEyes",
      "frames":[
        {
      "time":[0.2,2],
      "persist":false, 
      "params":{
        "BROW_UP_LEFT":0.8,
        "BROW_UP_RIGHT":0.8,
        "SMILE_OPEN":1,
        }
    },
    {
      "time":[0.2,0.4],
      "persist":false, 
      "params":{
        "LOOK_LEFT":0.8,
        }
    },
    {
      "time":[0.4,0.6],
      "persist":false, 
      "params":{
        "LOOK_UP_LEFT":0.8,
        }
    },
    {
      "time":[0.6,0.8],
      "persist":false, 
      "params":{
        "LOOK_UP":0.8,
        }
    },
    {
      "time":[0.8,1],
      "persist":false, 
      "params":{
        "LOOK_UP_RIGHT":0.8,
        }
    },
    {
      "time":[1,1.2],
      "persist":false, 
      "params":{
        "LOOK_RIGHT":0.8,
        }
    },
    {
      "time":[1.2,1.4],
      "persist":false, 
      "params":{
        "LOOK_DOWN_RIGHT":0.8,
        }
    },
    {
      "time":[1.4,1.6],
      "persist":false, 
      "params":{
        "LOOK_DOWN":0.8,
        }
    },
    {
      "time":[1.6,1.8],
      "persist":false, 
      "params":{
        "LOOK_DOWN_LEFT":0.8,
        }
    },
    {
      "time":[1.8,2],
      "persist":false, 
      "params":{
        "LOOK_LEFT":0.8,
        }
    },
    {
      "time":[2],
      "persist":false, 
      "params":{
        "reset":true
        }
    }],
  "class":"furhatos.gestures.Gesture"
    }),
  });
}

async function fhSound(url: string) {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  const encText = encodeURIComponent(url);
  return fetch(`http://${FURHATURI}/furhat/say?url=${encText}&blocking=true`, {
    method: "POST",
    headers: myHeaders,
    body: "",
  });
}

async function fhRedLight(red: number) {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  const encText = encodeURIComponent(red);
  return fetch(`http://${FURHATURI}/furhat/led?red=${encText}`, {
    method: "POST",
    headers: myHeaders,
    body: "",
  });
}

const dmMachine = setup({
  types: {
    context: {} as DMContext,
    },
  actors: {
    fhVoice: fromPromise<any, null>(async () => {
      return fhVoice("en-US-EchoMultilingualNeural");
    }),
    fhHello: fromPromise<any, null>(async () => {
      return fhSay("Hello!");
    }),
    fhL: fromPromise<any, null>(async () => {
      await fhRedLight(0);
      await new Promise(resolve => setTimeout(resolve, 200));
      const utterance = await fhListen();
      await fhRedLight(255);
      return utterance
    }),
    fhGetUser: fromPromise<any, null>(async () => {
      return fhGetUser();
    }),
    fhAttendUser: fromPromise<any, null>(async () => {
      return fhAttendUser();
    }),
    fhS: fromPromise<any, string>(async ({input}) => {
      return fhSay(input);
      }),
    fhBigSmile: fromPromise<any, null>(async () => {
      return fhBigSmile();
    }),
    fhRollingEyes: fromPromise<any, null>(async () => {
      return fhRollingEyes();
    }),
    // original audio file source: https://pixabay.com/sound-effects/people-grrr-137901/
    fhAngerWithSound: fromPromise<any, null>(async () => {
      return Promise.all ([
      fhSound('https://raw.githubusercontent.com/guscaroot/dialogue-systems-2-2026/lab3/furhat/src/grrr-137901.wav'),
      fhGesture("ExpressAnger")])
   }),
   fhRedLight: fromPromise<any, null>(async () => {
      await fhRedLight(255);
    }),
  }
}).createMachine({
  context: { 
    lastUtterance: undefined
  },
  id: "root",
  initial: "Start",
  states: {
    Start: { 
      invoke: {
        src: "fhRedLight",      
        input: null,
        onDone: {
          target: "StartDelay",
          actions: ({ event }) => console.log(event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    StartDelay: { after: { 1000: "Next" } },
    Next: {
      invoke: {
        src: "fhHello",      
        input: null,
        onDone: {
          target: "GetUser",
          actions: ({ event }) => console.log(event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    GetUser: {
      invoke: {
        src: "fhGetUser",      
        input: null,
        onDone: {
          target: "AttendUser",
          actions: ({ event }) => console.log(event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    AttendUser: {
      invoke: {
        src: "fhAttendUser",      
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
          target: "Speak",
          actions: [
            ({ event }) => console.log(event.output), 
            assign({lastUtterance: ({ event}) =>  event.output})]
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    RedLightOn: {
      invoke: {
        src: "fhRedLight",      
        input: null,
        onDone: {
          target: "Speak",
          actions: ({ event }) => console.log(event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    Speak: {
      invoke: {
        src: "fhS",      
        input: ({context}) => context.lastUtterance as string,
        onDone: {
          target: "RollingEyes",
          actions: ({ event }) => console.log(event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    BigSmile: {
      invoke: {
        src: "fhBigSmile",      
        input: null,
        onDone: {
          target: "BigSmileDelay",
          actions: ({ event }) => console.log(event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    BigSmileDelay: { after: { 1000: "RollingEyes"} },
    RollingEyes: {
      invoke: {
        src: "fhRollingEyes",      
        input: null,
        onDone: {
          target: "RollingEyesDelay",
          actions: ({ event }) => console.log(event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    RollingEyesDelay: { after: { 2000: "Listen"} },
    Anger: {
      invoke: {
        src: "fhAngerWithSound",      
        input: null,
        onDone: {
          target: "Done",
          actions: ({ event }) => console.log(event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    Fail: {},
    Done: {},
  },
});

const actor = createActor(dmMachine).start();
console.log(actor.getSnapshot().value);

actor.subscribe((snapshot) => {
  console.log(snapshot.value);
});

