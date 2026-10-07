import { speechstate } from "speechstate";
import { assign, createActor, fromPromise, setup } from "xstate";

import {
  fhGesture,
  fhLed,
  fhListen,
  fhSay,
  newGesture,
  setFurhatBaseUrl,
} from "../../furhat/src/services";
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
setFurhatBaseUrl(window.location.origin);

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
    fhSay: fromPromise<any, string>(async ({ input }) => {
      return fhSay(input);
    }),
    fhListen: fromPromise<any, null>(async () => {
      return fhListen();
    }),
  },
}).createMachine({
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    lastResult: null,
    lastUtterance: null,
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
      entry: ({ context }) => {
        fhLed(0, 0, 0);
        context.spstRef.send({ type: "PREPARE" });
      },
      on: { ASRTTS_READY: "WaitToStart" },
    },
    WaitToStart: {
      entry: () => fhLed(0, 0, 255),
      on: { CLICK: "GenerateLLMResponse" },
    },
    GenerateLLMResponse: {
      entry: () => {
        fhLed(255, 0, 0);
        fhGesture("GazeAway", false);
      },
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
      entry: () => {
        fhLed(255, 0, 0);
        newGesture();
      },
      invoke: {
        id: "queryRagActor",
        src: "queryRagActor",
        input: ({ context }) => ({
          // query: context.lastResult?.[0]?.utterance ?? "",
          query: context.lastUtterance ?? "",
        }),
        onDone: {
          target: "GenerateLLMResponse",
          actions: assign({
            messages: ({ context, event }) => {
              const { messages } = context;
              // const userQuestion = context.lastResult?.[0]?.utterance ?? "";
              const userQuestion = context.lastUtterance ?? "";
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
      entry: () => fhLed(255, 0, 0),
      invoke: {
        src: "fhSay",
        input: ({ context }) =>
          context.messages[context.messages.length - 1]?.content ||
          prompts.defaultGreeting,
        onDone: {
          target: "Ask",
          actions: ({ event }) => console.log("\t", event.output),
        },
        onError: {
          target: "Error",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    NoInput: {
      entry: () => {
        fhLed(255, 0, 0);
        fhGesture("Shake", false);
      },
      invoke: {
        src: "fhSay",
        input: ({ context }) =>
          prompts.noInput[context.noInputCount - 1] || prompts.cannotHear,
        onDone: [
          {
            target: "Done",
            guard: ({ context }) => context.noInputCount >= NO_INPUT_THRESHOLD,
          },
          {
            target: "Ask",
            actions: ({ event }) => console.log("\t", event.output),
          },
        ],
        onError: {
          target: "Error",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    Error: {
      entry: () => {
        fhLed(255, 0, 0);
        fhGesture("Shake", false);
      },
      invoke: {
        src: "fhSay",
        input: prompts.llmError,
        onDone: {
          target: "Ask",
          actions: ({ event }) => console.log("\t", event.output),
        },
        onError: {
          target: "Error",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    Ask: {
      entry: () => {
        fhLed(0, 255, 0);
        fhGesture("Nod", false);
      },
      invoke: {
        src: "fhListen",
        input: null,
        onDone: [
          {
            target: "NoInput",
            guard: ({ event }) => {
              return (
                !event.output.message ||
                event.output.message.trim() === "" ||
                event.output.message === "SILENCE"
              );
            },
            actions: [
              () => console.log("\tNo input"),
              assign({
                lastUtterance: null,
                noInputCount: ({ context }) => context.noInputCount + 1,
              }),
            ],
            // actions: () => console.log("\tNo input"),
          },
          {
            target: "QueryRAG",
            actions: [
              assign({
                lastUtterance: ({ event }) => event.output.message,
                noInputCount: 0,
              }),
              ({ event }) => console.log("\t", event.output.message),
            ],
          },
        ],
        onError: {
          target: "Error",
          actions: ({ event }) => console.error(event),
        },
      },
    },
    Done: {
      entry: [
        () => {
          fhLed(0, 0, 0);
          fhGesture("BigSmile", false);
        },
        assign({
          lastUtterance: null,
          messages: [
            {
              role: ROLES.System,
              content: prompts.systemDefault,
            },
          ],
          noInputCount: 0,
        }),
      ],
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
