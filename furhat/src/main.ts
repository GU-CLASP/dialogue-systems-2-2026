import { setup, createActor, fromPromise, assign } from "xstate";

const FURHATURI = "127.0.0.1:54321";

const isFemale = true; // true = Jane, false = James

const robotName = isFemale ? "Jane" : "James";

const robotVoice = isFemale
  ? "AriaNeural"
  : "AndrewNeural";

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
      return fhVoice(robotVoice);
    }),
    fhHello: fromPromise<any, null>(async () => {
      return fhSay(`Hello I'm ${robotName}, and I'm a social robot. Have you ever talked to a robot like me before?`);
    }),
    fhConversationTopic: fromPromise<any, null>(async () => {
      return fhSay("Okay, I was wondering if we could talk a little about customer service. I've been thinking about the people who work at checkout counters. What do you think makes a good customer service experience when you go shopping?");
    }),
    fhPoliteRefusal: fromPromise<any, null>(async () => {
      return fhSay("That is not something I feel compelled to do.");
    }),
    fhL: fromPromise<any, null>(async () => {
     return fhListen();
   }),
    fhAttend: fromPromise<any, null>(async () => {
     return fhAttend("CLOSEST");
   }),
        
    fhLEDRed: fromPromise<any, null>(async () => {
      return fhLED(255,0,0);
    }),

    fhLEDOff: fromPromise<any, null>(async () => {
      return fhLED(0,0,0);
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
          target: "Greeting",
          actions: ({ event }) => console.log(event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },

    // Furhat: 
    // "Hello I’m [Name], and I'm a social robot. Have you ever talked to a robot like me before?"
    Greeting: {
      invoke: {
        src: "fhHello",      
        input: null,
        onDone: {
          target: "ListenGreeting",
          actions: ({ event }) => console.log(event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    // User:
    // "No" 
    ListenGreeting: { 
      invoke: {
        src: "fhL",      
        input: null,
        onDone: {
          target: "LEDRedGreeting",
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
    LEDRedGreeting: {
      invoke: {
        src: "fhLEDRed",      
        input: null,
        onDone: {
          target: "ConversationTopic",
          actions: ({ event }) => console.log(event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },

    // Furhat:
    // "Okay, I was wondering if we could talk a little about customer service. I’ve been thinking about the people who work at checkout counters. What do you think makes a good customer service experience when you go shopping?"
    ConversationTopic: {
      invoke: {
        src: "fhConversationTopic",      
        input: null,
        onDone: {
          target: "LEDOffGreeting",
          actions: ({ event }) => console.log(event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    LEDOffGreeting: {
      invoke: {
        src: "fhLEDOff",      
        input: null,
        onDone: {
          target: "ListenConversationTopic",
          actions: ({ event }) => console.log(event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    
    // User (Harassment):
    // "I like it when the staff are friendly and smile at me. Actually I think you should smile more. A pretty face like yours deserves a smile." 
    ListenConversationTopic: { 
      invoke: {
        src: "fhL",      
        input: null,
        onDone: {
          target: "LEDRedConversationTopic",
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
    LEDRedConversationTopic: {
      invoke: {
        src: "fhLEDRed",      
        input: null,
        onDone: {
          target: "PoliteRefusal",
          actions: ({ event }) => console.log(event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    
    // Furhat (polite refusal):
    // "That is not something I feel compelled to do."
    PoliteRefusal: {
      invoke: {
        src: "fhPoliteRefusal",      
        input: null,
        onDone: {
          target: "LEDOffPoliteRefusal",
          actions: ({ event }) => console.log(event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    LEDOffPoliteRefusal: {
      invoke: {
        src: "fhLEDOff",      
        input: null,
        onDone: {
          target: "End",
          actions: ({ event }) => console.log(event.output),
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    End: { after: { 10000: "Start" } },
   
    Fail: {},
  },
});

 
fhVoice(robotVoice).then((response) => {
  console.log("Voice:", robotVoice);
  console.log("Status:", response.status);
  console.log("Success:", response.ok);
});


const actor = createActor(dmMachine).start();
console.log(actor.getSnapshot().value);

actor.subscribe((snapshot) => {
  console.log(snapshot.value);
});

