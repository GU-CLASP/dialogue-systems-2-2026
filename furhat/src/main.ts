import { setup, createActor, fromPromise, assign } from "xstate";
import { createServer } from "node:http"; // for gesture with audio
import { readFile } from "node:fs/promises";
import OpenAI from "openai";
import { QdrantClient } from "@qdrant/js-client-rest";

const FURHATURI = "127.0.0.1:54321"; // this says where the furhats api lives
const AUDIO_URL = "http://127.0.0.1:8765/beep.wav"; // beep sound
const COLLECTION_N = "gu_support";


// setup for rag and llm
const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
});

const qdrant = new QdrantClient({ host: "localhost", port: 6333 });

type Message = { role: "assistant" | "user" | "system"; content: string };

const systemPrompt: Message = {
  role: "system",
  content: "You are Furhat, a friendly, helpful voice assistant. Keep responses very brief.",
};

const embed = async (input: string) =>
  openai.embeddings
    .create({ model: "qwen3-embedding", input, dimensions: 384 })
    .then((result) => result.data[0].embedding);

async function retrieve(query: string): Promise<string> {
  const embedding = await embed(query);
  const results = await qdrant.query(COLLECTION_N, {
    query: embedding,
    with_payload: true,
    limit: 3,
  });
  return results.points
    .map((p) => (p.payload as { text: string }).text)
    .join("\n\n");
}

async function chatCompletion(messages: Message[]): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "llama3.1",
    messages,
  });
  return response.choices[0].message.content ?? "";
}

// for beep
createServer(async (_req, res) => { // creating a tiny web server that gives furhat access to the beep.wav file
  try {
    const audio = await readFile("./audio/beep.wav");
    res.writeHead(200, {
      "Content-Type": "audio/wav",
      "Content-Length": audio.length,
    });
    res.end(audio);

  } catch (error) { // if we face error and there was no file
    console.error("Could not load audio file:", error);
    res.writeHead(500); // 500 means sth went wrong on the server
    res.end("Could not load audio file"); // we send error respond instead of the file
  }
}).listen(8765, "127.0.0.1"); // and this starts the server


// ------------- furhat Helper Functions 
async function fhAttend() { // for attending user
  const headers = new Headers({ accept: "application/json", });
  const response = await fetch(`http://${FURHATURI}/furhat/attend?user=CLOSEST`, // so attend to the closest detected user
    {
      method: "POST",
      headers,
      body: "",
    });
  const result = await response.json(); // read furhat response
  return result;
}

async function fhVoice(name: string) { // u give function a voice name 
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json"); // response in json format
  const encName = encodeURIComponent(name); // to put the voicee name into a safe form for putting inside a URL
  return fetch(`http://${FURHATURI}/furhat/voice?name=${encName}`, {
    method: "POST", // sending an http post command to furhat
    headers: myHeaders,
    body: "",
  });
}

async function fhSay(text: string) { // speak
  // to make furhat speak
  await fhLed(0, 0, 255); // speaking = blue
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  // speaks
  const res = await fetch(`http://${FURHATURI}/furhat/say?text=${encodeURIComponent(text)}&blocking=true`, // when blocking is true it means wait until furhat has finished speaking before continuing
    {
      method: "POST",
      headers: myHeaders,
      body: ""
    },
  );
  await fhLed(0, 0, 0); // to turn the led off
  return res;
}

async function newGesture() { // smile gesture
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  myHeaders.append("Content-Type", "application/json");
  return fetch(`http://${FURHATURI}/furhat/gesture?blocking=true`, {
    method: "POST",
    headers: myHeaders,
    body: JSON.stringify({
      name: "cheekySmile", // we name it this
      frames: [ // to describe the gesture
        {
          time: [0.4, 1.6],
          persist: false,
          params: {
            SMILE_OPEN: 0.7, // smile with open mouth
            BROW_UP_LEFT: 1.0, // raises the left eyebrow
            BROW_UP_RIGHT: 0.1, // slightly raise the right eyebrow
            NECK_ROLL: 12, // roll the head slightly
            LOOK_UP: 0.4,
          },
        },
        {
          time: [2.2],
          persist: true,
          params: { reset: true }
        }, // to reset the gesture, return the face/head toward the neutral/default state
      ],
      class: "furhatos.gestures.Gesture", // interpret the json Im sending as a furhat gesture
    }),
  });
}

async function fhListen() { // listen
  await fhLed(0, 255, 0); // listening = green
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");

  try {
    const response = await fetch(`http://${FURHATURI}/furhat/listen?language=en-US`, // sending the listen request
      {
        method: "GET",
        headers: myHeaders,
      });

    const result = await response.json();
    const msg = result.message;

    // to handle cases where there was no proper speech
    if (msg === "SILENCE" || msg === "INTERRUPTED" || msg === "FAILED") {
      return "";
    }
    return typeof msg === "string" ? msg : ""; // if the msg was string return the msg otherwise return empty string
  } finally { // when the listening operation ends
    await fhLed(0, 0, 0); // so turning the led off
  }
}

async function fhLed(red: number, green: number, blue: number) { // LED
  return fetch(`http://${FURHATURI}/furhat/led?red=${red}&green=${green}&blue=${blue}`,
    {
      method: "POST",
      headers: { accept: "application/json" },
      body: ""
    },
  );
}

async function fhPlayAudio(url: string) {  // to play the wav file
  return fetch(`http://${FURHATURI}/furhat/say?url=${encodeURIComponent(url)}&blocking=true`,
    {
      method: "POST",
      headers: { accept: "application/json" },
      body: ""
    },
  );
}

async function surpriseWithSound() { // second gesture
  const gesture = fetch(`http://${FURHATURI}/furhat/gesture?blocking=true`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "surpriseWithSound",
      frames: [
        {
          time: [0.1, 1.0],
          persist: false,
          params: {
            SURPRISE: 1.0,
            BROW_UP_LEFT: 1.0,
            BROW_UP_RIGHT: 1.0,
            NECK_TILT: -8
          },
        },
        {
          time: [1.6],
          persist: true,
          params: { reset: true }
        },
      ],
      class: "furhatos.gestures.Gesture",
    }),
  });
  await Promise.all([gesture, fhPlayAudio(AUDIO_URL)]); // so start both asynchronous operations together and wait for both to finish
}


// ------------- DM
interface DMContext {
  messages: Message[];
  retrievedContext: string;
}

const dmMachine = setup({
  types: {
    context: {} as DMContext
  },
  actors: {
    fhVoice: fromPromise<any, null>(async () => { // voice actor
      return fhVoice("en-US-EchoMultilingualNeural");
    }),
    fhL: fromPromise<string, null>(async () => { // Listening actor
      return fhListen();
    }),
    fhAttend: fromPromise<any, null>(async () => fhAttend()), // actor for the user tracking thing I wrote
    fhGreet: fromPromise<any, null>(async () => { // greeting actor
      await fhSay("Hello! I am Furhat. Ask me anything about GU student support.");
      await newGesture();
    }),
    fhBye: fromPromise<any, null>(async () => { // goodbye actor
      await surpriseWithSound();
      await fhSay("That was fun. Goodbye!");
    }),
    retrieve: fromPromise<string, string>(async ({ input }) => retrieve(input)),
    chatCompletion: fromPromise<string, Message[]>(async ({ input }) => chatCompletion(input)),
    fhSpeak: fromPromise<any, string>(async ({ input }) => fhSay(input)),
  },
}).createMachine({
  id: "root",
  initial: "Start",
  context: {
    messages: [systemPrompt],
    retrievedContext: "",
  },
  states: {
    Start: {
      after: { 1000: "SetVoice" } // so it stayes 1000 milliseconds then it goes to SetVoice
    },
    SetVoice: {
      invoke: {
        src: "fhVoice",
        input: null,
        onDone: "Attend",
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event)
        },
      },
    },
    Attend: {
      invoke: {
        src: "fhAttend",
        input: null,
        onDone: "Greet",
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event)
        },
      }
    },
    Greet: {
      invoke: {
        src: "fhGreet",
        input: null,
        onDone: "Speaking",
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event)
        },
      },
    },
    Speaking: {
      invoke: {
        src: "fhSpeak",
        input: ({ context }) => context.messages[context.messages.length - 1].content,
        onDone: "Ask",
        onError: { target: "Fail", actions: ({ event }) => console.error(event) },
      },
    },
    Ask: {
      invoke: {
        src: "fhL",
        input: null,
        onDone: [
          {
            target: "NoInput",
            guard: ({ event }) => !event.output, 
          },
          {
            target: "Retrieve",
            actions: assign(({ context, event }) => ({
              messages: [...context.messages, { role: "user" as const, content: event.output }],
            })),
          },
        ],
        onError: { target: "Fail", actions: ({ event }) => console.error(event) },
      },
    },
    NoInput: {
      entry: assign(({ context }) => ({
        messages: [...context.messages, { role: "assistant" as const, content: "Sorry, I didn't catch that. Could you repeat?" }],
      })),
      always: "Speaking",
    },
    Retrieve: {
      invoke: {
        src: "retrieve",
        input: ({ context }) => context.messages[context.messages.length - 1].content,
        onDone: {
          actions: assign(({ event }) => ({ retrievedContext: event.output })),
          target: "ChatCompletion",
        },
        onError: {
          actions: [
            ({ event }) => console.error("Retrieval failed:", event.error),
            assign({ retrievedContext: "" }),
          ],
          target: "ChatCompletion",
        },
      },
    },
    ChatCompletion: {
      invoke: {
        src: "chatCompletion",
        input: ({ context }) => {
          const augmentedSystem: Message = {
            role: "system",
            content:
              `${systemPrompt.content}\n\n` +
              `Use the following information from GU's student portal if it helps answer the user's question. ` +
              `If it isn't relevant, ignore it and answer normally.\n\n` +
              context.retrievedContext,
          };
          return [augmentedSystem, ...context.messages.slice(1)];
        },
        onDone: {
          actions: assign(({ context, event }) => ({
            messages: [...context.messages, { role: "assistant" as const, content: event.output }],
          })),
          target: "Speaking",
        },
        onError: { target: "Speaking", actions: ({ event }) => console.error(event) },
      },
    },
    Done: {
      type: "final"
    },
    Bye: {
      invoke: {
        src: "fhBye",
        input: null,
        onDone: "Done",
        onError: {
          target: "Fail",
          actions: ({ event }) => console.error(event)
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
  console.log("messages:", JSON.stringify(snapshot.context.messages, null, 2));
});

