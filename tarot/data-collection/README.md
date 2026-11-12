# Data collection: human–human tarot readings

Before building the system further, I collected human–human dialogues to see how a
tarot reading actually unfolds as a conversation. One participant plays the **reader**
(the role Tarot Furhat takes), the other plays the **client** (the user).

## Setup

- **Participants:** friends, in pairs. Neither needs to know tarot.
- **Medium:** text chat (WeChat / Messenger), one session per pair and scenario.
  Text is less realistic than speech, but much faster to collect and transcribe.
- **Length:** 5–10 minutes per session, 5 sessions or more.
- **Materials**
  - [reader-instructions.md](reader-instructions.md) and the shuffled [card-sheet.md](card-sheet.md) for the reader
  - [client-instructions.md](client-instructions.md) and one scenario card for the client
- The reader is **not** told how Tarot Furhat behaves, so the data is not shaped by my design.

## Procedure

1. Ask both participants for consent (see below).
2. Send the reader their instructions and the card sheet; send the client their
   instructions and **one** scenario card (a different one for each session).
3. Let them chat. Do not interrupt.
4. Copy the whole chat into `dialogues/dialogue-NN.md` using [dialogues/TEMPLATE.md](dialogues/TEMPLATE.md).
   Replace names with **Reader** and **Client**.
5. After all sessions, fill in [analysis.md](analysis.md).

## Consent (send to both)

> Hi! For my dialogue systems course I'm collecting short role-played tarot readings in
> text chat. It takes about 10 minutes. Your names will be removed, and the anonymised
> chat may appear in my report and presentation. Is that OK with you?

## Sessions

| # | Scenario card | Reader | Client | Date | File |
|---|---|---|---|---|---|
| 01 | | | | | dialogues/dialogue-01.md |
| 02 | | | | | dialogues/dialogue-02.md |
| 03 | | | | | dialogues/dialogue-03.md |
| 04 | | | | | dialogues/dialogue-04.md |
| 05 | | | | | dialogues/dialogue-05.md |
