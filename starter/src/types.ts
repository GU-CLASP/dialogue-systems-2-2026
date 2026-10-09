import { Hypothesis, SpeechStateExternalEvent } from "speechstate";
import { AnyActorRef } from "xstate";

export type Message = {
  role: "assistant" | "user" | "system";
  content: string;
};    

export interface DMContext {
  spstRef: AnyActorRef;
  lastResult: Hypothesis[] | null;
  messages: Message[];
  retrievedContext: string; // Context retrieved from Qdrant
  // nextUtterance: string;
};

export type DMEvents = SpeechStateExternalEvent | { type: "CLICK" } | {type: "DONE"};
