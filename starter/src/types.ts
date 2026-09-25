import { Hypothesis, SpeechStateExternalEvent } from "speechstate";
import { AnyActorRef } from "xstate";

export type Payload = {
  page: string,
  text: string
}
export interface DMContext {
  spstRef: AnyActorRef;
  lastResult: Hypothesis[] | null;
  messages: Message[];
  noInput: number ;
  retrievedPoints: any;
  payloads: Payload[],
}

export type DMEvents = SpeechStateExternalEvent | { type: "CLICK" } | {type: "DONE"};

export type Message = {
  role: "assistant" | "user" | "system" ;
  content: string
}