import { assign, createActor, fromPromise, setup } from "xstate";
import { type Settings, speechstate } from "speechstate";
import { KEY } from "./credentials";
import type { DMContext, DMEvents, Message } from "./types";

const REGION = "swedencentral";

const greeting: Message = { // for speechstate to speak at first
  role: "assistant",
  content: "Hello! I can help you explore dog breeds. What kind of dog are you looking for?",
}

const azureCredentials = {
  endpoint: `https://${REGION}.api.cognitive.microsoft.com/sts/v1.0/issuetoken`,
  key: KEY,
};

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
async function chatCompletion(utterance: string, sessionId: string): Promise<string> {
  const response = await fetch("http://localhost:3001/api/dialogue",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, utterance }),
    }
  );

  if (!response.ok) {
    throw new Error(`DogExplorer backend error: ${response.status}`);
  }

  const result: { response: string } = await response.json();
  return result.response;
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
    chatCompletion: fromPromise<string, { utterance: string; sessionId: string }>(async ({ input }) => {
      return await chatCompletion(input.utterance, input.sessionId);
    }),
  },
}).createMachine({
  // initial context (will be created when the machine starts)
  context: ({ spawn }) => ({ // spawn creates another actor
    spstRef: spawn(speechstate, { input: settings }),
    lastResult: null,
    messages: [],
    sessionId: crypto.randomUUID(),
    currentUtterance: null,
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
          entry: [
            assign({ currentUtterance: null }),
            {
              type: "spst.listen",
            },
          ],
          on: {
            RECOGNISED: {
              guard: ({ event }) => Boolean(event.value[0]?.utterance?.trim()),
              actions: [
                {
                  type: "append",
                  params: ({ event }) => ({
                    message: {
                      role: "user",
                      content: event.value[0].utterance,
                    },
                  }),
                },
                assign({
                  currentUtterance: ({ event }) => event.value[0]?.utterance ?? null,
                }),
              ],
            },
            ASR_NOINPUT: {
              target: "NoInput",
            },
            LISTEN_COMPLETE: [
              {
                guard: ({ context }) => Boolean(context.currentUtterance?.trim()),
                target: "ChatCompletion",
              },
              {
                target: "NoInput",
              },
            ],
          },
        },

        NoInput: {
          entry: [
            assign({currentUtterance: null,}),
            {
              type: "append",
              params: {
                message: {
                  role: "assistant",
                  content: "Sorry, I didn't hear you. Could you repeat that?",
                },
              },
            },
          ],
          always: "Speaking",
        },

        ChatCompletion: { // in this state we call the LLM
          invoke: { // start an actor while this state is active
            id: "chatCompletion", // invoke id
            src: "chatCompletion", // actor source
            input: ({ context }) => ({
              utterance: context.currentUtterance ?? "",
              sessionId: context.sessionId,
            }),
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
            onError: {
              actions: [
                ({ event }) =>
                  console.error("Backend error:", event.error),
                {
                  type: "append",
                  params: {
                    message: {
                      role: "assistant",
                      content: "Sorry, something went wrong. Could you repeat that?",
                    },
                  },
                },
              ],
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
