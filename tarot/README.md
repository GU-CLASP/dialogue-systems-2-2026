# Madame Furhat — a robot tarot reader

A three-card tarot reading on the Furhat robot (Dialogue Systems 2 project).
The user asks a question, picks three numbers between 1 and 78, and Furhat turns
and interprets the cards (past, present, future), then answers follow-up questions.

## Running

```bash
npm install
ssh -f -N -L 11434:127.0.0.1:11434 mltgpu    # Ollama on mltgpu (see tutorials/invoke-llm.org)

npm start          # virtual/physical Furhat: launch the SDK and start the Remote API first
npm run text       # same dialogue in the terminal: type your turn, empty line = silence
SCRIPT=scenarios/01-presentation-example.txt npx tsx src/main.ts   # replay a test scenario
npm test           # unit tests
```

Options (environment variables): `LLM_MODEL` (default `gemma4`), `OLLAMA_URL`,
`FURHAT_HOST` (default `127.0.0.1:54321`), `VOICE` (default `CoraMultilingualNeural`, Azure; avoid Polly `-generative` voices),
`FACE_MASK` / `FACE_CHARACTER` (default `anime [legacy]` / `AnimePink`; copy the names exactly as the web interface shows them),
`DEBUG=1` (print every state). Every dialogue is saved in `transcripts/`.

## Architecture

| File | Role |
|---|---|
| `src/main.ts` | XState dialogue manager: ask → choose numbers → confirm → read → follow-up |
| `src/robot.ts` | Furhat Remote API (speech, listening, gestures, LED turn-taking) and a console stand-in |
| `src/tarot.ts` | Cards from [tarotapi.dev](https://tarotapi.dev) merged with modern meanings from [dariusk/corpora](https://github.com/dariusk/corpora) (Mark McElroy, *A Guide to Tarot Meanings*); cached for offline demos |
| `src/numbers.ts` | Number understanding (digits, words, homophones like "for"), range/duplicate checks |
| `src/nlu.ts` | Rule-based NLU for confirmations and follow-ups |
| `src/llm.ts` | Ollama: phrases readings, classifies follow-ups the rules miss; output is cleaned, checked, and replaced by a template on failure |

The LLM never chooses cards or invents meanings: the API decides the card, the dataset
gives its meaning, and the LLM only phrases it for the user's question.
