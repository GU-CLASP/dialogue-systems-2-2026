import type {Hypothesis, SpeechStateExternalEvent} from "speechstate";
import type { AnyActorRef } from "xstate";
import type { DialogueState } from "./dialogueState";

export type Breed = {
  id: string;
  name: string;
  life_span: string | null;
  temperament: string | null;
  origin: string | null;
  description: string | null;
  breed_group: string | null;
  weight?: {
    imperial?: string; // in pounds
    metric?: string; // kligrams
  };
  height?: {
    imperial?: string; //inches
    metric?: string; // centimeters
  };
  image?: {
    id: string;
    url: string;
    width: number;
    height: number;
  };
};

export type Message = {
  role: "assistant" | "user" | "system";
  content: string;
};

export interface DMContext {
  spstRef: AnyActorRef;
  lastResult: Hypothesis[] | null;
  messages: Message[];

  dialogueState: DialogueState;

  // Latest recognized user utterance
  currentUtterance: string | null;
}

export type DMEvents = SpeechStateExternalEvent| { type: "CLICK" } | { type: "DONE" };
