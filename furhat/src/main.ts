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
// led bulb
async function fhLed(red:number,green:number,blue:number) {

  return fetch(`http://${FURHATURI}/furhat/led?red=${red}&green=${green}&blue=${blue}`,{
    method: "POST", // change color of led
  
  });
}

// basic dialogue
async function fhSay(text: string) {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  const encText = encodeURIComponent(text);
  return fetch(`http://${FURHATURI}/furhat/say?text=${encText}&blocking=true`, {
    method: "POST", // making robot speak
    headers: myHeaders,
    body: "",
  });
}

// User tracking
async function fhAttend() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  const response = await fetch(`http://${FURHATURI}/furhat/users`, {
    method: "GET", // get current user
    headers: myHeaders,

  });
  const users = await response.json();
  if (users.length === 0) {
    console.log("No users detected");
    return;
  }
  const userId = users[0].id;
  console.log("Attending user:", userId);
  return fetch(
    `http://${FURHATURI}/furhat/attend?userid=${encodeURIComponent(userId)}`,
    {
      method: "POST", // attend  a user
      headers: myHeaders,
      body: "",
    }
  );
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
          time: [0.5], //ADD THE TIME FRAME OF YOUR LIKING
          persist: true,
          params: {
            //ADD PARAMETERS HERE IN ORDER TO CREATE A GESTURE
             
              NECK_TILT: 25.0,
          },
        },{
        time: [1.0], //ADD THE TIME FRAME OF YOUR LIKING
          persist: true,
          params: {
            //ADD PARAMETERS HERE IN ORDER TO CREATE A GESTURE
             
              NECK_TILT: -25.0,
          },
        },
        {
          time: [1.5], //ADD TIME FRAME IN WHICH YOUR GESTURE RESETS
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
  await fhLed(0, 0, 0);
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



async function fhRepeat(text: string) {
  await fhLed(127, 0, 0);
  newGesture();
  await fhSay(`Okay you said your name is ${text}. How can I help you today?`);
  //fhGesture("Wink");
  await fhLed(0, 0, 0);
}
async function fhAudio(url: string) {
  const encUrl = encodeURIComponent(url);
  return fetch(
    `http://${FURHATURI}/furhat/say?url=${encUrl}&blocking=true`,
    {
      method: "POST",
    }
  );
}
// chime sound when winking
async function fhAudioGesture() {
  fhGesture("Wink");
  await fhAudio(
    "http://127.0.0.1:8000/chime_fixed.wav"
  );
}

const dmMachine = setup({
  actors: {
    fhVoice: fromPromise<any, null>(async () => {
      return fhVoice("en-US-EchoMultilingualNeural");
    }),
    fhHello: fromPromise<any, null>(async () => {
      await fhLed(127, 0, 0);
      return fhSay("Hello. I am Fur hat. But you can call me Isabella. What can I call you?");
    }),
    fhName: fromPromise<any, null>(async () => {
      const name = await fhListen();
      console.log("User:", name);
      await fhRepeat(name);
    }),
    fhAnswer: fromPromise<any, null>(async () => {
      await fhLed(127, 0, 0);
      await fhSay("Your lecture is at Humanisten Building. Have fun studying");
       await fhAudioGesture();
      await fhLed(0, 0, 0);
    }),
    fhL: fromPromise<any, null>(async () => {
     return fhListen();
   }),
   fhA: fromPromise<any, null>(async () => {
    return fhAttend();
  }),
 
  },
}).createMachine({
  id: "root",
  initial: "Start",
  states: {
    Start: { after: { 1000: "Attend" } },
    Attend: {
      invoke: {
        src: "fhA",      
        input: null,
        onDone: {
          target: "Next",
          actions: ({ event }) => console.log("Attend",event.output),
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
        src: "fhName",      
        input: null,
        onDone: {
          target: "ListenQuestion",
         },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    
   
    ListenQuestion: {
      invoke: {
        src: "fhL",      
        input: null,
        onDone: {
          target: "Answer",
          actions: ({ event }) => {console.log("Question : ",event.output)
          
        },},
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    
    Answer: {
      invoke: {
        src: "fhAnswer",      
        input: null,
        onDone: {
          target: "Done",
         
        },},
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    
    
    Done:{},
    Fail: {},
  },
});

const actor = createActor(dmMachine).start();
console.log(actor.getSnapshot().value);

actor.subscribe((snapshot) => {
  console.log(snapshot.value);});

