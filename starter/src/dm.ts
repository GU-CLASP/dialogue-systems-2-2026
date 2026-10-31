import { QdrantClient } from "@qdrant/js-client-rest";
import { assign, createActor, fromPromise, setup } from "xstate";
import { Settings, speechstate } from "speechstate";
import { KEY } from "./credentials";
import { DMContext, DMEvents } from "./types";
import OpenAI from "openai";

const REGION = "norwayeast";

const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  dangerouslyAllowBrowser: true,
});

const qdrant = new QdrantClient({
  host: "localhost",
  port: 6333,
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
  asrDefaultNoInputTimeout: 10000,
  locale: "en-US",
  ttsDefaultVoice: "en-US-DavisNeural",
  bargeIn: false,
};

interface GrammarEntry {
  person?: string;
  day?: string;
  time?: string;
}

const grammar: { [index: string]: GrammarEntry } = {
  vlad: { person: "Vladislav Maraev" },
  bora: { person: "Bora Kara" },
  tal: { person: "Talha Bedir" },
  tom: { person: "Tom Södahl Bladsjö" },
  monday: { day: "Monday" },
  tuesday: { day: "Tuesday" },
  "10": { time: "10:00" },
  "11": { time: "11:00" },
};

function isInGrammar(utterance: string) {
  return utterance.toLowerCase() in grammar;
}

const dmMachine = setup({
  types: {
    /** you might need to extend these */
    context: {} as DMContext,
    events: {} as DMEvents,
  },
  actions: {
    /** define your actions here */
    "spst.speak": ({ context }, params: { utterance: string }) => {
      console.log("SENDING SPEAK:", params.utterance);
      context.spstRef.send({
        type: "SPEAK",
        value: {
          utterance: params.utterance,
        },
      });
    },
    "spst.listen": ({ context }) =>
      context.spstRef.send({
        type: "LISTEN",
      }),
    },
    actors: {
      chatCompletion: fromPromise(
        async ({ input }: { input: { messages: DMContext["messages"] } }) => {
          // 1. Getting the student's latest question
          const lastMessage = input.messages[input.messages.length - 1];
          const question = lastMessage.content;
          // 2. Converting the question into an embedding
          const embedding = await openai.embeddings.create({
            model: "qwen3-embedding",
            input: question,
            dimensions: 384,
          });
          // 3. Searching the university documents in Qdrant
          const results = await qdrant.query("gu-student-support", {
            query: embedding.data[0].embedding,
            with_payload: true,
            limit: 5,
          });
          // 4. Extracting the retrieved text
          const retrievedText = results.points
          .map((point) => point.payload?.text)
          .filter((text): text is string => typeof text === "string")
          .join("\n\n");
          console.log("RETRIEVED DOCUMENTS:", retrievedText);
          // 5. Asking Llama 3.2 to answer using the documents
          const completion = await openai.chat.completions.create({
            model: "llama3.2",
            messages: [
              {
                role: "system",
                content: `You are a friendly voice assistant for students at the University of Gothenburg. Use the following university information to answer the student's question. If the information does not contain the answer, say that you do not know. Keep your answers brief and conversational.
                University information:
                ${retrievedText}`,
              },
              ...input.messages.filter((message) => message.role !== "system"),
            ],
          });
          return completion.choices[0].message.content ?? "";
        }
      ),
    },
  }).createMachine({
    context: ({ spawn }) => ({
      spstRef: spawn(speechstate, { input: settings }),
      lastResult: null,
      messages: [
        {
          role: "system",
          content: "You are a friendly voice chatbot. Keep your responses very brief and conversational.",
        },
      ],
    }),
    id: "DM",
    initial: "Prepare",
    on: {
      ASR_NOINPUT: {
        actions: () => console.log("GLOBAL ASR_NOINPUT RECEIVED"),
      },
      LISTEN_COMPLETE: {
        actions: () => console.log("GLOBAL LISTEN_COMPLETE RECEIVED"),
      },
    },
    states: {
      Prepare: {
        entry: ({ context }) => context.spstRef.send({ type: "PREPARE" }),
        on: { ASRTTS_READY: "WaitToStart" },
      },
      WaitToStart: {
        on: { CLICK: "Greeting" },
      },
      Greeting: {
        entry: assign({
          messages: ({ context }) => [
            ...context.messages,
            {
              role: "assistant",
              content: "Hello! How can I help you?",
            },
          ],
        }),
        always: "Speaking",
    },
    Speaking: {
      entry: [({ context }) => {
        console.log(
          "BOT IS SAYING:",
          context.messages[context.messages.length - 1].content,
        );
      },
      {
        type: "spst.speak",
        params: ({ context }) => ({
          utterance:
          context.messages[context.messages.length - 1].content,
        }),
      },
    ],
    on: {
      SPEAK_COMPLETE: "Ask",
    },
  },
  Ask: {
    entry: [
      () => console.log("ENTERED ASK STATE"),
      { type: "spst.listen" },
    ],
    on: {
      RECOGNISED: {
        target: "ChatCompletion",
        actions: assign({
          messages: ({ context, event }) => [
            ...context.messages,
            {
              role: "user",
              content: event.value[0].utterance,
            },
          ],
        }),
      },
    },
  },
  ChatCompletion: {
  invoke: {
    src: "chatCompletion",
    input: ({ context }) => ({
      messages: context.messages,
    }),
    onDone: {
      target: "Speaking",
      actions: assign({
        messages: ({ context, event }) => [
          ...context.messages,
          {
            role: "assistant",
            content: event.output,
          },
        ],
      }),
    },
    onError: {
      target: "Done",
      actions: ({ event }) => {
        console.error("Ollama error:", event.error);
      },
    },
  },
},
CheckGrammar: {
  entry: {
    type: "spst.speak",
    params: ({ context }) => ({
      utterance: `You just said: ${context.lastResult![0].utterance}. And it ${
        isInGrammar(context.lastResult![0].utterance) ? "is" : "is not"
      } in the grammar.`,
    }),
  },
  on: { SPEAK_COMPLETE: "Done" },
},
Done: {
  on: {
    CLICK: "Greeting",
  },
},
},
});
const dmActor = createActor(dmMachine, {}).start();
dmActor.on("*", (event) => {
  console.log("SPEECH EVENT:", event.type, event);
});
dmActor.getSnapshot().context.spstRef.subscribe((snapshot) => {
  console.log(
    "SPEECHSTATE STATUS:",
    JSON.stringify(snapshot.value, null, 2)
  );
  console.log(
    "SPEECHSTATE EVENT:",
    snapshot.event
  );
});
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
