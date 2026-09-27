import { assign, createActor, fromPromise, setup } from "xstate";
import { Settings, speechstate } from "speechstate";
import { KEY } from "./credentials";
import { DMContext, DMEvents, Message } from "./types";
import OpenAI from "openai";

const REGION = "swedencentral";

const systemPrompt: Message = { // to tell at first to LLM how to behave
  role: "system",
  content: "You are a friendly, helpful voice assistant. Keep responses very brief.",
};

const greeting: Message = { // for speechstate to speak at first
  role: "assistant",
  content: "Hello world!",
}

// llm client (creates an api client)
const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/", // port 11434
  apiKey: "ollama",
  dangerouslyAllowBrowser: true,
});

const azureCredentials = {
  endpoint: `https://${REGION}.api.cognitive.microsoft.com/sts/v1.0/issuetoken`,
  key: KEY,
};

/** backup: Azure access via FLoV proxy
const azureProxyCredentials = {
  proxyUrl: "https://rndserv.flov.gu.se:4000/api/token",
  key: "",
  };
*/

const settings: Settings = {
  azureCredentials: azureCredentials,
  azureRegion: REGION,
  asrDefaultCompleteTimeout: 0,
  asrDefaultNoInputTimeout: 5000,
  locale: "en-US",
  ttsDefaultVoice: "en-US-DavisNeural",
  bargeIn: false,
};

// llm helper function
async function chatCompletion(messages: Message[]): Promise<string> {
  const response = await openai.chat.completions.create({ // sending the request to ollama and waiting for the llm respond before moving on
    model: "llama3.1",
    messages: messages, // we send the messages to llama which is out conversation history
  });
  return response.choices[0].message.content ?? ""; // and then take the first generated response
}

const dmMachine = setup({
  types: {
    /** you might need to extend these */
    context: {} as DMContext,
    events: {} as DMEvents,
  },
  actions: {
    /** define your actions here */
    "spst.speak": ({ context }) =>
      context.spstRef.send({
        type: "SPEAK",
        value: {
          utterance: context.messages[context.messages.length - 1].content, // for it to speak the last message to the user
        },
      }),
    "spst.listen": ({ context }) =>
      context.spstRef.send({
        type: "LISTEN",
      }),
    // append action for appending new message to the history (so updating context)
    append: assign(({ context }, params: { message: Message }) => ({
      messages: [...context.messages, params.message],
    })),
  },
  actors: {
    // this is the actor that machine can invoke
    chatCompletion: fromPromise<string, Message[]>(async ({ input }) => {
      return await chatCompletion(input); // when the actor starts -> take its input, pass it to our chatCompletion() function and wait for the result and then return it
    }),
  },
}).createMachine({
  // initial context (will be created when the machine starts)
  context: ({ spawn }) => ({ // spawn creates another actor
    spstRef: spawn(speechstate, { input: settings }),
    lastResult: null,
    messages: [systemPrompt] // so initally the message history contains only the system prompt that we created up there
  }),

  id: "DM",
  initial: "Prepare",

  states: {
    Prepare: {
      entry: ({ context }) => context.spstRef.send({ type: "PREPARE" }), // initialize speech recognition and text-to-speech services
      on: { ASRTTS_READY: "WaitToStart" },
    },
    WaitToStart: {
      on: { CLICK: "Loop" },
    },

    // the whole thing is in a loop state
    Loop: {
      entry: { // when we enter the loop we execute the append action first for adding the greeting thing to message history 
        type: "append",
        params: { message: greeting }, // so after entering the loop state our massages would have first system prompt and then this greeting thing
      },
      initial: "Speaking",

      // we have three states in the loop
      states: { 

        Speaking: {
          entry: {
            type: "spst.speak" // so speaking the last message in the history to user
          },
          on: {
            SPEAK_COMPLETE: "Ask"
          },
        },

        Ask: {
          entry: {
            type: "spst.listen" // entering this state it would listen to user
          },
          on: {
            RECOGNISED: { // it recognized what the user said
              actions: {
                type: "append",
                params: ({ event }) => ({ // it appends what the user said to the messages
                  message: {
                    role: "user",
                    content: event.value[0].utterance
                  },
                }),
              },
            },
            ASR_NOINPUT: {
              actions: assign({ lastResult: null }), // if nothing was recognized
            },
            LISTEN_COMPLETE: "ChatCompletion", // if the listening was complete we move to last state
          },
        },

        ChatCompletion: { // in this state we call the LLM
          invoke: { // start an actor while this state is active
            id: "chatCompletion", // invoke id
            src: "chatCompletion", // actor source
            input: ({ context }) => context.messages, // actor input
            onDone: { // when the promise actor completed successfully, we know actor would return a string
              actions: {
                type: "append",
                params: ({ event }) => ({ // we append what the actor returned (which is llamas response) to the messages
                  message: {
                    role: "assistant",
                    content: event.output
                  },
                }),
              },
              target: "Speaking", // so when it goes to speaking now it would speak the llamas answer which is the last item in messages
            },
            onError: { // if the llm promise fails
              actions: ({ event }) => console.error(event.error), // we print the error to the browser console
              target: "Speaking",
            },
          },
        },
      },
    },
  },
});

const dmActor = createActor(dmMachine, {}).start();

dmActor.subscribe((state) => { // every time the machine's state changes call this function
  console.group("State update");
  console.log("State value:", state.value);
  console.log("State context:", state.context);
  console.groupEnd();
});

export function setupButton(element: HTMLButtonElement) {
  element.addEventListener("click", () => {
    dmActor.send({ type: "CLICK" });
  });
  dmActor.subscribe((snapshot) => { // snapchot is the machines current state
    const meta: { view?: string } = Object.values(
      snapshot.context.spstRef.getSnapshot().getMeta(),
    )[0] || {
      view: undefined,
    };
    element.innerHTML = `${meta.view}`;
  });
}
