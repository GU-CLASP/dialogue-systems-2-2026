import { assign, createActor, fromPromise, setup } from "xstate";
import { Settings, speechstate } from "speechstate";
import { KEY } from "./credentials";
import { DMContext, DMEvents, Message } from "./types";
import OpenAI from "openai";
import { QdrantClient } from "@qdrant/js-client-rest";

const REGION = "northeurope";

const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  dangerouslyAllowBrowser: true,
});

const qdrant = new QdrantClient({ host: "localhost", port: 6333 });

const COLLECTION = "gu_stuservice";

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

const GREETING: Message = {
  role: "assistant",
  content: "Hi! How can I help you?",
};

const chatCompletion = fromPromise<
  string,
  { messages: Message[]; ragContext: string }
>(async ({ input }) => {
  const systemPrompt: Message = {
    role: "system",
    content:
      "You are a helpful voice assistant for students at the University of Gothenburg. " +
      "Answer politely in one or two short sentences. " +
      "Use plain text only: no markdown, no lists, no emoji, no special symbols, " +
      "because your answer will be read out loud by a speech synthesiser. " +
      "Use the information between CONTEXT START and CONTEXT END to answer. " +
      "If it does not contain the answer, say that you do not know.\n\n" +
      "CONTEXT START\n" +
      input.ragContext +
      "\nCONTEXT END",
  };

  const completion = await openai.chat.completions.create({
    model: "qwen3:4b",
    messages: [systemPrompt, ...input.messages.slice(1)],
  });
  return completion.choices[0].message.content ?? "";
});

const queryRAG = fromPromise<string, { question: string }>(
  async ({ input }) => {
    const embedding = await openai.embeddings
      .create({
        model: "qwen3-embedding",
        input: input.question,
        dimensions: 384,
      })
      .then((result) => result.data[0].embedding);

    const results = await qdrant.query(COLLECTION, {
      query: embedding,
      with_payload: true,
      limit: 5,
    });

    return results.points
      .map((p) => p.payload?.text as string)
      .join("\n---\n");
  },
);

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
  actors: { chatCompletion: chatCompletion, queryRAG: queryRAG },
}).createMachine({
  context: ({ spawn }) => ({
    ragContext: "",
    spstRef: spawn(speechstate, { input: settings }),
    lastResult: null,
    messages: [{ role: "system", content: "Reply in one or two sentences, and be polite." }],
  }),
  id: "DM",
  initial: "Prepare",
  states: {
    Prepare: {
      entry: ({ context }) => context.spstRef.send({ type: "PREPARE" }),
      on: { ASRTTS_READY: "WaitToStart" },
    },
    WaitToStart: {
      on: { CLICK: "Loop" },
    },
    Loop: {
      entry: assign(({ context }) => {
        const newMessages = [...context.messages, GREETING];
        return { messages: newMessages };
      }),
      initial: "Speaking",
      states: {
        Speaking: {
          entry: {
            type: "spst.speak",
            params: ({ context }) => {
              const lastMessage = context.messages[context.messages.length - 1];
              return { utterance: lastMessage.content };
            },
          },
          on: { SPEAK_COMPLETE: "Ask" },
        },

        Ask: {
          entry: { type: "spst.listen" },
          on: {
            RECOGNISED: {
              actions: assign(({ context, event }) => {
                const newMessages: Message[] = [
                  ...context.messages,
                  { role: "user", content: event.value[0].utterance },
                ];
                return { messages: newMessages };
              }),
            },
            LISTEN_COMPLETE: "Retrieval",
          },
        },

        Retrieval: {
          invoke: {
            src: "queryRAG",
            input: ({ context }) => ({
              question: context.messages[context.messages.length - 1].content,
            }),
            onDone: {
              target: "ChatCompletion",
              actions: assign(({ event }) => {
                return { ragContext: event.output };
              }),
            },
            onError: {
              target: "ChatCompletion",
              actions: assign(() => {
                return { ragContext: "" };
              }),
            },
          },
        },

        ChatCompletion: {
          invoke: {
            src: "chatCompletion",
            input: ({ context }) => ({
              messages: context.messages,
              ragContext: context.ragContext,
            }),
            onDone: {
              target: "Speaking",
              actions: assign(({ context, event }) => {
                const newMessages: Message[] = [
                  ...context.messages,
                  { role: "assistant", content: event.output },
                ];
                return { messages: newMessages };
              }),
            },
            onError: {
              target: "Speaking",
              actions: assign(({ context }) => {
                const newMessages: Message[] = [
                  ...context.messages,
                  {
                    role: "assistant",
                    content: "Sorry, I could not reach the language model.",
                  },
                ];
                return { messages: newMessages };
              }),
            },
          },
        },
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
