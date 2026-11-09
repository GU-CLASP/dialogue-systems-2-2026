import type { Hypothesis, SpeechStateExternalEvent } from "speechstate";

export interface DMContext {
  messages: Message[];
  nextUtterance: string;
  retrievedText: string;
  mode: RobotMode;

  
  // nextUtterance: string;
}

export type DMEvents = SpeechStateExternalEvent 
| { type: "CLICK" } | {type: "DONE"};
export type Message = {role: "assistant" | "user" | "system"; content: string;};
export type RobotMode = "cautious" | "confident";
export const ROBOT_MODE: RobotMode = "cautious";
        
