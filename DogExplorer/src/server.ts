// processDialogue() calls Ollama, we should expose it through a small local backend rather than directly importing it into the browser, so I used express
// keeps a separate information state for each session, instead of sharing one set of preferences between all users. For now, sessions are stored in memory and reset when the server restarts
import express from "express";
import cors from "cors";

import {createInitialState,processDialogue} from "./processDialogue";

const app = express();

app.use(express.json());
app.use(cors({origin: "http://localhost:5173"}));

const sessions = new Map<string, ReturnType<typeof createInitialState>>();

app.post("/api/dialogue", async (req, res) => {
  try {
    const { sessionId, utterance } = req.body;

    if (typeof sessionId !== "string" || !sessionId || typeof utterance !== "string" || !utterance.trim()) {
      res.status(400).json({
        error: "Valid sessionId and utterance are required"});
      return;
    }

    let state = sessions.get(sessionId);

    if (!state) {
      state = createInitialState();
      sessions.set(sessionId, state);
    }

    const response = await processDialogue(utterance,state);

    res.json({response, preferences: state.preferences});

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Dialogue processing failed",
    });
  }
});

app.listen(3001, "127.0.0.1", () => {
  console.log("DogExplorer backend running at http://localhost:3001");
});