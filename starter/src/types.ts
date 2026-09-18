import { Hypothesis, SpeechStateExternalEvent } from "speechstate";
import { AnyActorRef } from "xstate";

export type Message = {
  role: "assistant" | "user" | "system";
  content: string;
}

export interface DMContext {
  spstRef: AnyActorRef;
  lastResult: Hypothesis[] | null;
  // nextUtterance: string;
  messages: Message[] // for the history thingy
  retrievedContext: string; // for the things retrieved from qdrant
}

export type DMEvents = SpeechStateExternalEvent | { type: "CLICK" } | {type: "DONE"};
