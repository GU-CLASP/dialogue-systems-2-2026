import { setup, createActor, fromPromise} from "xstate";
import WebSocket = require("ws");


const FURHATURI = "127.0.0.1:54321";
const FURHAT_WS = "ws://127.0.0.1:9000/v1/events";

let furhatSocket: WebSocket;
let isListening = false;
let roarAfterReply = false;

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

function playElephantRoar() {
  sendFurhatEvent("request.speak.audio", {
    url: "https://furhat-files.s3.eu-west-1.amazonaws.com/sounds/elephant.wav",
    text: "Elephant roar",
    lipsync: false,
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
      name: "ThinkingGesture",
      frames: [
        {
          time: [0.3, 0.8], //ADD THE TIME FRAME OF YOUR LIKING
          persist: false,
          params: {
            NECK_ROLL: 20.0,
            EXPR_ANGER: 0.8,
            BROW_DOWN_LEFT: 0.7,
            BROW_DOWN_RIGHT: 0.7,
            
            //ADD PARAMETERS HERE IN ORDER TO CREATE A GESTURE
          },
        },
        {
          time: [1.2], //ADD TIME FRAME IN WHICH YOUR GESTURE RESETS
          persist: false,
          params: {
            reset: true,
          },
        },
        //ADD MORE TIME FRAMES IF YOUR GESTURE REQUIRES THEM
      ],
      class: "furhatos.gestures.Gesture",
    }),
  },
);

const body = await response.text();

console.log("ThinkingGesture response:", response.status);
console.log("Gesture result:", body);

if (!response.ok) {
  throw new Error(`Gesture registration failed: ${response.status}`);
}
}


async function fhGesture(name: string) {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");

  const url = 
    `http://${FURHATURI}/furhat/gesture?name=${encodeURIComponent(name)}&blocking=true`;

    console.log("Gesture request URL:", url);

    const response = await fetch(url, {
      method: "POST",
      headers: myHeaders,
      body: "",
    });
    const body = await response.text();
    console.log("Gesture playback:", response.status, body);
    return {
      ok: response.ok,
      status: response.status,
      body,
    };
  }


async function fhListen() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  
  const response = await fetch(`http://${FURHATURI}/furhat/listen`, {
    method: "GET",
    headers: myHeaders,
  });
    const body = response.body;
    if (!body) { throw new Error("Response body is empty");
    }

    const result = await body.getReader().read();
    if (!result.value) {
      throw new Error("No listening result was returned");
    }

    return JSON.parse(new TextDecoder().decode(result.value)).message;
  }

  function sendFurhatEvent(
    type: string,
     payload: Record<string, unknown> = {},
    ) {
      if (!furhatSocket || furhatSocket.readyState !== WebSocket.OPEN) {
        console.error("Furhat WebSocket is not connected");
        return;
      }

  furhatSocket.send(JSON.stringify({ type, ...payload }));
}

function resetFaceAndListen(){
  sendFurhatEvent("request.face.reset");

  sendFurhatEvent("request.face.headpose", {
    yaw: 0,
    pitch: 0,
    roll: 0,
    relative: false,
    speed: "medium",
  });

  // Turn the LED off while Furhat responds.
  sendFurhatEvent("request.led.set", {
    color: "#00FF00",
  });
  sendFurhatEvent("request.listen.start");
}

function connectToFurhat(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(FURHAT_WS);

    socket.once("open", () => {
      furhatSocket = socket;
      console.log("Connected to Furhat Realtime API");

      newGesture().catch((error) => {
        console.error("Could not register ThinkingGesture:", error);
      });

      // Start detecting users.
      sendFurhatEvent("request.users.start");

      //Attend to the closest detected user
      sendFurhatEvent("request.attend.user", {
        user_id: "closest",
        speed: "medium",
      });
      resolve(socket);
    });

    socket.once("error", (error) => {
      reject(error);
    });

    socket.on("message", (rawData) => {
      try {
        const event = JSON.parse(rawData.toString());
        console.log("Furhat event:", event);

        if(event.type === "response.speak.start") {
          console.log("Furhat started speaking");

          sendFurhatEvent("request.led.set", { color: "#000000"});

          sendFurhatEvent("request.face.headpose", {
            
            roll: 20,
            relative: true,
            speed: "medium",
          });
        }

        //when furhat recognises speech, turn off the LED
        // and perform the thinking gesture.
        if (event.type === "response.hear.end" && event.text) {
          console.log("You said:", event.text);
          
          newGesture().catch((error) => {
            console.error("ThinkingGesture error:", error);
          });
          
          sendFurhatEvent("request.face.params", {
            params: {
              EXPR_ANGER: 0.8,
              BROW_DOWN_LEFT: 0.7,
              BROW_DOWN_RIGHT: 0.7,
              SMILE_CLOSED: 0,
              SMILE_OPEN: 0,
            },
          });
          
          sendFurhatEvent("request.face.headpose", {
            yaw: 0,
            pitch: 0,
            roll: 20,
            relative: false,
            speed: "medium",
          });

          //roar is queued only for this reply
          roarAfterReply = true;

          // Speak the recognized words.
          sendFurhatEvent("request.speak.text", {
            text: `You said: ${event.text}`,
          });
        }
          /*sendFurhatEvent("request.gesture.start", {
            name: "Angry",
            intensity: 1,
            duration: 3,
          });
          
          // Speak the recognized words.
          sendFurhatEvent("request.speak.text", {
            text: `You said: ${event.text}`,
          });
        }
           */

        if (event.type === "response.speak.end") {
          console.log("Furhat finished speaking:", event.text);


          //play the roar only after the angry reply, never after the roar itself
          if (roarAfterReply && event.text?.startsWith("You said:")) {
            roarAfterReply = false;

            playElephantRoar();
            return;
          }

          //When the roar has finished, restore Furhat and resume listening.
          if (event.text === "Elephant roar") {
            resetFaceAndListen();
            return;
          }

          //After the roar finishes, restore the face and resume listening.
          resetFaceAndListen();
        
          }

      } catch (error) {
          console.error("Could not parse Furhat event:", error);
        }
      });
      
      socket.on("close", () => {
        console.log("Furhat WebSocket disconnected");
      });
    }); 
  }
    
/*newGesture()
  .then((response) => {
    console.log("ThinkingGesture response:", response.status);
    return response.text();
  })
  .then((body) => console.log("Gesture result:", body))
  .catch((error) => console.error("Gesture failed:", error)); */



const dmMachine = setup({
  actors: {
    connectToFurhat: fromPromise<WebSocket, null>(async () => {
      return connectToFurhat();
    }),
    fhVoice: fromPromise<any, null>(async () => {
      return fhVoice("en-US-EchoMultilingualNeural");
    }),
    fhHello: fromPromise<any, null>(async () => {
      return fhSay("Hi");
    }),
    fhL: fromPromise<any, null>(async () => {
     return fhListen();
   }),
  },
}).createMachine({
  id: "root",
  initial: "Start",
  states: {
    Start: { 
      invoke: {
        src: "connectToFurhat",
        input: null,
        onDone: {
          target: "Next",
          actions: () => {
            console.log("Furhat connection is ready.");
            sendFurhatEvent("request.speak.text",{
              text: "Hello there, I am connected to the dialogue manager.",
            });
          },
        },
        onError: {
          target: "Fail",
          actions: ({ event }) => {
            console.error("Could not connect to Furhat:", event.error);
          },
        },
      },
     },
    Next: {
      entry: () => {
        console.log("Greeting sent through the Realtime API.");
        sendFurhatEvent("request.led.set", {
          color: "#000000",
        });
      },
      always: "Listen",
    },
    Listen: {
      entry: () => {
        console.log("Furhat is listening...");
        sendFurhatEvent("request.led.set", {
          color: "#00FF00",
        });
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

