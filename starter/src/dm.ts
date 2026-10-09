import { assign, createActor, fromPromise, setup } from "xstate";
import { Settings, speechstate } from "speechstate";
import { KEY } from "./credentials";
import { DMContext, DMEvents } from "./types";
import OpenAI from "openai";
import { Message } from "./types";
import { QdrantClient } from "@qdrant/js-client-rest";

const REGION = "italynorth";

const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  dangerouslyAllowBrowser: true,
});

// Connect to Qdrant database
const client = new QdrantClient({ host: "localhost", port: 6333 });

// Converting text into embeddings for Qdrant 
const embed = async (input: string) =>
  openai.embeddings
    .create({
      model: "qwen3-embedding",
      input: input,
      dimensions: 384,
    })
    .then((result) => result.data[0].embedding);

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

const dmMachine = setup({
  types: {
    /** you might need to extend these */
    context: {} as DMContext,
    events: {} as DMEvents,
  },
  actions: {
    /** define your actions here */
    "spst.speak": ({ context }, params: { utterance: string }) =>
      context.spstRef.send({
        type: "SPEAK",
        value: {
          utterance: params.utterance,
        },
      }),
    "spst.listen": ({ context }) =>
      context.spstRef.send({
        type: "LISTEN",
      }),
  },
  actors: {
    ChatReply: fromPromise(async ({ input }: { input: { messages: Message[]; retrievedContext: string } }): Promise<string> => {
      // Add the retrieved information to the LLM prompt
      const messagesWithContext: Message[] = [
        {
        role: "system",
        content: `Use the following retrieved GU information to answer the user:\n\n${input.retrievedContext}`,
      },
      ...input.messages,
    ];

      const completion = await openai.chat.completions.create({
        model: "llama3.2:latest",
        messages: messagesWithContext,
      });
      return completion.choices[0].message.content ?? "";
      }),
    // Search Qdrant for information related to the user's question  
    Retrieval: fromPromise(async ({ input } : { input: string }): Promise<string> => {
      const embedding = await embed(input);
      // Retrieve the five most relevant chunks
      const results = await client.query("gu_student_support", {
        with_payload: true,
        query: embedding,
        limit: 5,
      });
      // Get the text from the retrieved Qdrant results
      const texts = results.points.map((point) => point.payload?.text);
      const validTexts = texts.filter((text) => text !== undefined);
      // Combine the retrieved chunks into one context 
      const context = validTexts.join("\n\n");

      return context;
    }),
  },
}).createMachine({
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    lastResult: null,
    messages: [
      {
      role: "system",
      content: "You are a helpful voice assistant. Keep your responses short and conversational, like a spoken reply — one or two sentences at most.",
      },
    ],
    retrievedContext: "",
  }),
  id: "DM",
  initial: "Prepare",
  states: {
    Prepare: {
      entry: ({ context }) => context.spstRef.send({ type: "PREPARE" }),
      on: { ASRTTS_READY: "WaitToStart" },
    },
    WaitToStart: {
      on: { CLICK: "Greeting" },
    },
    Greeting: {
      entry: {
        type: "spst.speak",
        params: { utterance: "Hello world!" },
      },
      on: {
        SPEAK_COMPLETE: "Ask",
      },
    },
    Ask: {
      entry: { type: "spst.listen" },
      on: {
        // Save the recognised user utterance in the dialogue history
        RECOGNISED: {
          actions: assign(({ context, event }) => {
            return {  
              lastResult: event.value,
              messages: [...context.messages, { role: "user", content: event.value[0].utterance }],
            };
          }),
        },
        // Handle no input
        ASR_NOINPUT: {
          actions: assign({ lastResult: null }),
        },
        LISTEN_COMPLETE: [
          {
            target: "Retrieval",
            guard: ({ context }) => !!context.lastResult,
          },
          {
            target: "NoInput",
          },
        ]
      },
    },
    Retrieval: {
      invoke:{
        src: "Retrieval",
        input: ({ context }) => {
          // Use the last two user messages to give retrieval more dialogue context
          const userMessages = context.messages.filter(
            (message) => message.role === "user"
          );
          const lastTwo = userMessages.slice(-2);
          const retrievalQuery = lastTwo.map((message) => message.content).join("\n");

          return retrievalQuery;
        },   
        // Save the retrieved information for ChatCompletion 
        onDone: {
          target: "ChatCompletion",
          actions: assign(({ event }) => {
            return {
              retrievedContext: event.output,
            };
          }),
        },
      },
    },
    NoInput: {
      entry: {
        type: "spst.speak",
        params: {
          utterance: "I didn't hear anything. Please try again.",
        },
      },
      on: {
        SPEAK_COMPLETE: "Ask",
      },
    },
    ChatCompletion: {
      invoke: {
        src: "ChatReply",
        input: ({ context }) => ({
          messages: context.messages,
          retrievedContext: context.retrievedContext,
        }),
        onDone: {
          target: "Speaking",
          // Add the LLM response to the dialogue history
          actions: assign(({ context, event }) => {
            return {
              messages: [...context.messages, { role: "assistant", content: event.output }],
            };
          }),
        },
      },
    },
    Speaking: {
      entry: ({ context }) => {
        const lastMessage = context.messages[context.messages.length - 1];

        context.spstRef.send({
          type: "SPEAK",
          value: {
            utterance: lastMessage.content
          },
        });
      },
      on: {
        SPEAK_COMPLETE: "Ask",
      },
    },
    Done: {
      on: {
        CLICK: "Greeting",
      },
    },
  },
});

const dmActor = createActor(dmMachine, {}).start();

dmActor.subscribe((state) => {
  console.group("State update");
  console.log("State value:", state.value);
  console.log("State context:", state.context);
  console.groupEnd();
});

export function setupButton(element: HTMLButtonElement) {
  element.addEventListener("click", () => {
    dmActor.send({ type: "CLICK" });
  });
  dmActor.subscribe((snapshot) => {
    const meta: { view?: string } = Object.values(
      snapshot.context.spstRef.getSnapshot().getMeta(),
    )[0] || {
      view: undefined,
    };
    element.innerHTML = `${meta.view}`;
  });
}
