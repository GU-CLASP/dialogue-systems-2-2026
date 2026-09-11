import { assign, createActor, fromPromise, setup } from "xstate";
import { Settings, speechstate } from "speechstate";
import { KEY, REGION, TOKEN_ENDPOINT } from "./credentials";
import { DMContext, DMEvents } from "./types";
import OpenAI from "openai";

/** 连本地/隧道上的 Ollama（OpenAI 兼容接口） */
const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  dangerouslyAllowBrowser: true,
});

const azureCredentials = {
  endpoint: TOKEN_ENDPOINT,
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
    context: {} as DMContext,
    events: {} as DMEvents,
  },
  actions: {
    /** 让 SpeechState 朗读一段文字 */
    "spst.speak": ({ context }, params: { utterance: string }) =>
      context.spstRef.send({
        type: "SPEAK",
        value: {
          utterance: params.utterance,
        },
      }),

    /** 让 SpeechState 开始听麦克风 */
    "spst.listen": ({ context }) =>
      context.spstRef.send({
        type: "LISTEN",
      }),

    /**
     * 点按钮进入对话时：往 messages 追加一句开场白（assistant）
     * Speaking 状态会朗读 messages 里的最后一条
     */
    appendGreeting: assign(({ context }) => ({
      messages: [
        ...context.messages,
        { role: "assistant" as const, content: "Hi! I'm Altlas. How can I help you?" },
      ],
    })),

    /**
     * 听完用户说话后：把识别结果追加为 user 消息
     * 这样下一轮 LLM 能看到完整对话历史
     */
    appendUserFromSpeech: assign(({ context }) => {
      const utterance = context.lastResult?.[0]?.utterance ?? "";
      return {
        messages: [
          ...context.messages,
          { role: "user" as const, content: utterance },
        ],
      };
    }),

    /**
     * LLM 调用成功后：把回复追加为 assistant 消息
     * event.output 来自下面 chatCompletion actor 的 return 值
     */
    appendAssistantFromLLM: assign(({ context, event }) => {
      const message = (
        event as { output: { role: "assistant"; content: string } }
      ).output;
      return {
        messages: [...context.messages, message],
      };
    }),
  },
  actors: {
    /**
     * 异步调用 Ollama 做 chat completion
     * input.messages = 当前全部对话历史（含 system）
     * 返回一条 assistant 消息，供 onDone 写入 context
     */
    chatCompletion: fromPromise(
      async ({
        input,
      }: {
        input: { messages: DMContext["messages"] };
      }) => {
        console.log("[LLM] calling ollama with messages:", input.messages);
        try {
          const response = await openai.chat.completions.create({
            model: "llama3.2", // 必须是 curl /api/tags 里有的模型名
            messages: input.messages,
          });
          const content = response.choices[0]?.message?.content ?? "";
          console.log("[LLM] reply:", content);
          return { role: "assistant" as const, content };
        } catch (err) {
          console.error("[LLM] failed:", err);
          throw err;
        }
      },
    ),
  },
}).createMachine({
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    lastResult: null,
    /** 一开始就放一条 system，约束 LLM 回复要短（适合语音） */
    messages: [
      {
        role: "system",
        content:
          "You are a friendly voice assistant. Keep replies very short.",
      },
    ],
  }),
  id: "DM",
  initial: "Prepare",
  states: {
    /** 初始化 Azure 语音；就绪后才能点按钮 */
    Prepare: {
      entry: ({ context }) => context.spstRef.send({ type: "PREPARE" }),
      on: { ASRTTS_READY: "WaitToStart" },
    },

    /** 等待用户点击页面按钮 */
    WaitToStart: {
      on: {
        CLICK: {
          target: "Loop",
          actions: "appendGreeting", // 先写入开场白，再进入循环
        },
      },
    },

    /**
     * Part 1 核心循环（对照 lab 图）:
     * Speaking → Ask → ChatCompletion → Speaking → ...
     */
    Loop: {
      initial: "Speaking",
      states: {
        /** 朗读 messages 的最后一条（开场白或 LLM 回复） */
        Speaking: {
          entry: {
            type: "spst.speak",
            params: ({ context }) => ({
              utterance:
                context.messages[context.messages.length - 1].content,
            }),
          },
          on: { SPEAK_COMPLETE: "Ask" },
        },

        /** 听用户说话；有结果就进 ChatCompletion */
        Ask: {
          entry: { type: "spst.listen" },
          on: {
            RECOGNISED: {
              actions: assign(({ event }) => ({
                lastResult: event.value,
              })),
            },
            ASR_NOINPUT: {
              // 暂时清空；VG-1 可以在这里做更友好的处理
              actions: assign({ lastResult: null }),
            },
            LISTEN_COMPLETE: [
              {
                guard: ({ context }) => !!context.lastResult,
                target: "ChatCompletion",
                actions: "appendUserFromSpeech",
              },
              {
                // 没听清：重新进入 Ask，才会再次执行 listen
                target: "Ask",
                reenter: true,
              },
            ],
          },
        },

        /** 调用 LLM；成功则追加回复并回到 Speaking */
        ChatCompletion: {
          invoke: {
            src: "chatCompletion",
            input: ({ context }) => ({
              messages: context.messages,
            }),
            onDone: {
              target: "Speaking",
              actions: "appendAssistantFromLLM",
            },
            onError: {
              target: "Speaking",
              actions: assign(({ context }) => ({
                messages: [
                  ...context.messages,
                  {
                    role: "assistant" as const,
                    content: "Sorry, I had a problem answering.",
                  },
                ],
              })),
            },
          },
        },
      },
    },
  },
});

const dmActor = createActor(dmMachine, {}).start();

dmActor.subscribe((state) => {
  // 看这里：浏览器 Console（不是下面跑 vite 的终端）
  console.log(">>> state:", JSON.stringify(state.value));
  console.log(">>> messages:", state.context.messages);
  console.log(">>> lastResult:", state.context.lastResult);
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
