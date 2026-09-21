import { Hypothesis, SpeechStateExternalEvent } from 'speechstate';
import { AnyActorRef } from 'xstate';

import { ROLES } from './constants';

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

export type MessageRole = (typeof ROLES)[keyof typeof ROLES];

export type Message = {
  role: MessageRole;
  content: string;
};
