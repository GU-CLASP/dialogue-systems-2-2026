import { speechstate } from "speechstate";
import { assign, createActor, fromPromise, setup } from "xstate";

import { settings } from "./configs";
import { NO_INPUT_THRESHOLD, ROLES } from "./constants";
import prompts from "./prompts";
import { getChatCompletions, queryQdrant } from "./services";
import { DMContext, DMEvents, Message } from "./types";

/** backup: Azure access via FLoV proxy
const azureProxyCredentials = {
  proxyUrl: "https://rndserv.flov.gu.se:4000/api/token",
  key: "",
  };
*/

const getChatCompletionsLogic = fromPromise(
  async ({ input }: { input: { messages: Message[] } }) => {
    try {
      return await getChatCompletions(input.messages);
    } catch (error) {
      console.error("LLM error:", error);
      throw error;
    }
  },
);

const queryRagLogic = fromPromise(
  async ({ input }: { input: { query: string } }) => {
    try {
      return await queryQdrant("ServiceAndSupport", input.query);
    } catch (error) {
      console.error("RAG error:", error);
      throw error;
    }
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
  actors: {
    getChatCompletionsActor: getChatCompletionsLogic,
    queryRagActor: queryRagLogic,
  },
}).createMachine({
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    lastResult: null,
    messages: [
      {
        role: ROLES.System,
        content: prompts.systemDefault,
      },
    ],
    noInputCount: 0,
  }),
  id: "DM",
  initial: "Prepare",
  states: {
    Prepare: {
      entry: ({ context }) => context.spstRef.send({ type: "PREPARE" }),
      on: { ASRTTS_READY: "WaitToStart" },
    },
    WaitToStart: {
      on: { CLICK: "GenerateLLMResponse" },
    },
    GenerateLLMResponse: {
      invoke: {
        id: "getChatCompletionsActor",
        src: "getChatCompletionsActor",
        input: ({ context: { messages } }) => ({ messages }),
        onDone: {
          target: "Speak",
          actions: assign({
            messages: ({ context, event }) => {
              console.log(`LLM event output: ${event.output}`);
              const { messages } = context;
              return [
                ...messages,
                {
                  role: ROLES.Assistant,
                  content: event.output ?? "",
                },
              ];
            },
          }),
        },
        onError: {
          target: "Error",
        },
      },
    },
    QueryRAG: {
      invoke: {
        id: "queryRagActor",
        src: "queryRagActor",
        input: ({ context }) => ({
          query: context.lastResult?.[0]?.utterance ?? "",
        }),
        onDone: {
          target: "GenerateLLMResponse",
          actions: assign({
            messages: ({ context, event }) => {
              const { messages } = context;
              const userQuestion = context.lastResult?.[0]?.utterance ?? "";
              const ragResults = event.output;

              const conversationHistory = messages.filter(
                (message) => message.role !== ROLES.System,
              );
              const newSystemPrompt = `${prompts.systemDefault}\n\n${prompts.systemRAG}\n\nCONTEXT: ${ragResults}`;
              return [
                {
                  role: ROLES.System,
                  content: newSystemPrompt,
                },
                ...conversationHistory,
                {
                  role: ROLES.User,
                  content: userQuestion,
                },
              ];
            },
          }),
        },
        onError: {
          target: "Error",
        },
      },
    },
    Speak: {
      entry: {
        type: "spst.speak",
        params: ({ context }) => ({
          utterance:
            context.messages[context.messages.length - 1]?.content ||
            prompts.defaultGreeting,
        }),
      },
      on: { SPEAK_COMPLETE: "Ask" },
    },
    NoInput: {
      entry: {
        type: "spst.speak",
        params: ({ context }) => ({
          utterance:
            prompts.noInput[context.noInputCount - 1] || prompts.cannotHear,
        }),
      },
      on: {
        SPEAK_COMPLETE: [
          {
            target: "Done",
            guard: ({ context }) => context.noInputCount >= NO_INPUT_THRESHOLD,
          },
          {
            target: "Ask",
          },
        ],
      },
    },
    Error: {
      entry: {
        type: "spst.speak",
        params: { utterance: prompts.llmError },
      },
      on: { SPEAK_COMPLETE: "Ask" },
    },
    Ask: {
      entry: [assign({ lastResult: null }), { type: "spst.listen" }],
      on: {
        RECOGNISED: {
          actions: assign({
            lastResult: ({ event }) => event.value,
            noInputCount: 0,
          }),
        },
        ASR_NOINPUT: {
          actions: assign({
            lastResult: null,
            noInputCount: ({ context }) => context.noInputCount + 1,
          }),
        },
        LISTEN_COMPLETE: [
          {
            target: "QueryRAG",
            guard: ({ context }) =>
              !!context.lastResult?.[0]?.utterance?.trim(),
          },
          {
            target: "NoInput",
          },
        ],
      },
    },
    Done: {
      entry: assign({
        lastResult: null,
        messages: [
          {
            role: ROLES.System,
            content: prompts.systemDefault,
          },
        ],
        noInputCount: 0,
      }),
      on: {
        CLICK: "GenerateLLMResponse",
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
  const clickHandler = () => {
    dmActor.send({ type: "CLICK" });
  };
  element.addEventListener("click", clickHandler);

  const subscription = dmActor.subscribe((snapshot) => {
    const meta: { view?: string } = Object.values(
      snapshot.context.spstRef.getSnapshot().getMeta(),
    )[0] || {
      view: undefined,
    };
    element.innerHTML = `${meta.view}`;
  });

  return () => {
    element.removeEventListener("click", clickHandler);
    subscription.unsubscribe();
  };
}
