import type { Hypothesis, SpeechStateExternalEvent } from "speechstate";
import type { AnyActorRef } from "xstate";


export type Breed = {
    id: string;
    name: string;
    life_span: string | null;
    temperament: string | null;
    origin: string | null;
    description: string | null;
    breed_group: string | null;

    weight: {
        imperical: string;
        metric: string;
    };

    height: {
        imperical: string;
        metric: string;
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

  sessionId: string; // conversation on node backend, preferences are remembered between turns
  currentUtterance: string | null;                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        
}

export type DMEvents = | SpeechStateExternalEvent | { type: "CLICK" } | { type: "DONE" };