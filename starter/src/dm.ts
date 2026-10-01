import { assign, createActor, fromPromise, setup } from "xstate";
import { Settings, speechstate } from "speechstate";
import { KEY } from "./azure";
import { DMContext, DMEvents , Message} from "./types";
import OpenAI from "openai";
import { QdrantClient } from "@qdrant/js-client-rest";


const REGION = "switzerlandnorth";

const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  dangerouslyAllowBrowser: true,
});

const client = new QdrantClient({ host: "localhost", port: 6333 });

const azureCredentials = {
  endpoint: `https://switzerlandnorth.api.cognitive.microsoft.com/sts/v1.0/issuetoken`,
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

//interface GrammarEntry {}

//const grammar: { [index: string]: GrammarEntry } = {
  //vlad: { person: "Vladislav Maraev" },
  //bora: { person: "Bora Kara" },
  //tal: { person: "Talha Bedir" },
  //tom: { person: "Tom Södahl Bladsjö" },
  //monday: { day: "Monday" },
  //tuesday: { day: "Tuesday" },
  //"10": { time: "10:00" },
  //"11": { time: "11:00" },};

//function isInGrammar(utterance: string) {
  //return utterance.toLowerCase() in grammar;}

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
  
  // actor - perform asynchronous tasks
  // fromPromise : promise to give result after some time
  
  actors: { 
    
    // chatCompletion : talkig to ollama and generates anwer
    chatCompletion: fromPromise(async ({input}: {
        input: {
          messages: Message[];
          ragResult: string;
        };}) => {
        const ragMessage: Message = {
          role: "system",
          content: input.ragResult,
        };
        const llmResult = await openai.chat.completions.create({
          model: "llama3.1",
          messages: [ragMessage, ...input.messages ] // conv hist, spread operator
     } );
     return llmResult; // response of question from llm. goes to state
      }
    ),
    
    //  qdrantRetrieval: Retrieval to query Qdrant using invoke
    qdrantRetrieval:  fromPromise(async ({input}:  { input: string }) => {
      const embedding = await openai.embeddings
          .create({
            model: "qwen3-embedding",
            input: input,
            dimensions: 384,
          })
          .then((result) => result.data[0].embedding);
 
        const results = await client.query("guServiceSupport", {
          with_payload: true,
          query: embedding,
          limit: 5, 
        });
        return results;
     }),
  },
  
}).createMachine({
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    lastResult: null,
    messages:[{role : "system",content : "Give answers in 1-2 short sentences"}],
    ragResult : "", 
    counter : 0
  }),
  id: "DM",
  initial: "Prepare",
  states: {
    
    // STATE 1 : PREPARE
    
    Prepare: {
      entry: ({ context }) => context.spstRef.send({ type: "PREPARE" }),
      on: { ASRTTS_READY: "WaitToStart" },
    },
    
    // STATE 2 : WAIT TO START
    
    WaitToStart: {
      on: { CLICK: "Greeting" },
    },
    
    // STATE 3 : GREETING 
    
    Greeting: {
      initial: "Prompt",
      on: {
        LISTEN_COMPLETE: [
          {
            target: "#DM.ragRetrieval", // # since its child state
            guard: ({ context }) => !!context.lastResult,
          },
          {
            target: "#DM.Done", // if no response  for 3 turns, goes to Done state
            guard: ({ context }) => context.counter>=3,
          },
          { target: ".NoInput" },
        ],
      },
      states: {
        Prompt: {
          entry: { type: "spst.speak", params: { utterance: `Hello there, how can I help you today!` } },
          on: { SPEAK_COMPLETE: "Ask" },
        },
        NoInput: {
          entry: {
            type: "spst.speak",
            params: { utterance: `Sorry, I can't hear you! Can you please repeat again louder` },
          },
          on: { SPEAK_COMPLETE: "Ask" },
        },
        Ask: {
          entry: { type: "spst.listen" },
          on: {
            RECOGNISED: {
              actions: assign(({context, event }) => {
                return {
                   lastResult: event.value,
                   messages: [...context.messages,{role:"user",content:event.value[0].utterance}] ,// ... spread operator. takes everything of context.messages, add new message and stores in messages
                   counter:0, // resetting to 0
                   };
              }),
            },
            
            // VG-1 Implement handling of ASR_NOINPUT
            //  Initialized a counter variable as 0 in context. For every no input, counter is incremented by 1. After 3 consecutive no-inputs, dialogue moves to Done state. The counter is reset to 0 when the user successfully speaks.
            ASR_NOINPUT: {
              actions: assign({ 
                lastResult: null ,
                counter : ({context})=>context.counter+1,
              }),
            },
          },
        },
      },
    },
    //CheckGrammar: {
     // entry: {
       // type: "spst.speak",
        //params: ({ context }) => ({
          //utterance: `You just said: ${context.lastResult![0].utterance}. And it ${
            //isInGrammar(context.lastResult![0].utterance) ? "is" : "is not"
          //} in the grammar.`, }),},
     // on: { SPEAK_COMPLETE: "llmLoading" },},
    
     // STATE 4 - RAG RETRIEVAL
     
     ragRetrieval:{
      invoke :{
        src : "qdrantRetrieval",
        input : ({ context }) => context.lastResult![0].utterance,
        
        onDone:{
        target:"llmLoading",
        
          actions: assign({
            ragResult: ({ event }) =>
              (event.output.points.map((p)=>p.payload?.text as string).join("\n")) // joining all 5 retrieved as 1 string and storing in ragResult
          })
            
          },
    },
  },
    // STATE 5 : LLM LOADING
    
    llmLoading : {
      invoke :{
                    src : "chatCompletion",// which actor to run
                    input: ({ context }) => ({
                      messages: context.messages,
                      ragResult: context.ragResult,
                    }), // passing the data into actor
                    
                    onDone:{
                      target:"llmReplySpeaking",
                      actions:assign({ messages: ({ context,event }) => [
                        ...context.messages,{
                          role : "assistant",
                          content: event.output.choices[0].message.content!,
                        }
                      ] }),
                    }
      },
    },
    
    // STATE 6 : LLM SPEAKING
    
    llmReplySpeaking :{
      entry: {
        type: "spst.speak",
        params:({ context }) => ({ utterance:  context.messages[context.messages.length - 1]?.content }),
      },
      on: {
        SPEAK_COMPLETE: {
          target: "#DM.Greeting.Ask",
        },
      },
    },
    
  
    // STATE 7 : DONE 
    
    Done: {
     // on: {
       // CLICK: "Greeting",
       entry: { type: "spst.speak", params: { utterance: `Bye Bye.. Have a good day` } },
      
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
