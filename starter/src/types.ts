import { Hypothesis, SpeechStateExternalEvent } from "speechstate";
import { AnyActorRef } from "xstate";

export type Message = {
 role: "assistant" | "user" | "system"; // who is speaking?
content: string; // what is said
}
export interface DMContext {
  spstRef: AnyActorRef;
  lastResult: Hypothesis[] | null;
  messages: Message[]; // messages is an array containing so many Message object eg : role:user,content:hello, role:assistant,content:"tell me"
  ragResult: string
  // nextUtterance: string;
  // adding a counter for handling ASR_NOINPUT to track the number of times there is no response
  counter :number;
 
}

export type DMEvents = SpeechStateExternalEvent | { type: "CLICK" } | {type: "DONE"};
