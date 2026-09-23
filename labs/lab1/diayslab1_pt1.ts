// create very short state machine

// enter system prompt
// enter llm request
// receive prompt
// fallback state
// exit state

type Message = {
  role: "assistant" | "user" | "system";
  content: string;
}
