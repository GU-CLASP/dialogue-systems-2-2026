import { Hypothesis, SpeechStateExternalEvent } from "speechstate";
import { AnyActorRef } from "xstate";

export interface DMContext {
  spstRef: AnyActorRef;
  lastResult: Hypothesis[] | null;
  // nextUtterance: string;
  messages: Message[];
}

export type DMEvents =
  | SpeechStateExternalEvent
  | { type: "CLICK" }
  | { type: "DONE" };

export const ROLES = ["assistant", "user", "system"] as const;

export type MessageRole = (typeof ROLES)[number];

export type Message = {
  role: MessageRole;
  content: string;
};
