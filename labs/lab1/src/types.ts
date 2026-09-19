import type { Hypothesis, SpeechStateExternalEvent } from "speechstate";
import type { AnyActorRef } from "xstate";

export interface DMContext {
  spstRef: AnyActorRef;
  lastResult: Hypothesis[] | null;
  messages: Message[];
  nextUtterance: string;

  
  // nextUtterance: string;
}

export type DMEvents = SpeechStateExternalEvent 
| { type: "CLICK" } | {type: "DONE"};
export type Message = {role: "assistant" | "user" | "system"; content: string;}
        
