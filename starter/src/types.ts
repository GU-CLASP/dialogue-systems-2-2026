import { Hypothesis, SpeechStateExternalEvent } from "speechstate";
import { AnyActorRef } from "xstate";

export interface DMContext {
  spstRef: AnyActorRef;
  lastResult: Hypothesis[] | null;
  // nextUtterance: string;

  messages: Message[]
}

type Message = {
  role: "assistant" | "user" | "system";
  content: string;
}
        
export type DMEvents = SpeechStateExternalEvent | { type: "CLICK" } | {type: "DONE"};
