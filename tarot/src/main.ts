// Tarot Furhat: a three-card tarot reading on the Furhat robot.
//
//   npm start        talk to the (virtual) Furhat via the Remote API
//   npm run text     same dialogue in the terminal (type; empty line = silence)
import { appendFileSync, mkdirSync } from "node:fs";
import { assign, createActor, fromPromise, setup } from "xstate";
import { advise, classifyFollowUp, describeCard, interpretCard, positionName, summarise, warmUp, type FollowUpIntent } from "./llm.ts";
import { checkNumbers, parseNumbers, randomNumbers, spokenList, type NumberCheck } from "./numbers.ts";
import { followUpIntent, isGoodbye, isNo, isVague, isYes, sensitiveTopic, topicOf, wantsRandom, type Sensitive } from "./nlu.ts";
import {
  CRISIS_REPLY, IS_IT_REAL, SENSITIVE_REPLY, TOPIC_QUESTION,
  cardWithArticle, goodOrBadAnswer, revealLine, whenAnswer, yesOrNoAnswer,
} from "./phrases.ts";
import { planFollowUp, type Route, type Subject } from "./followup.ts";
import { createRobot, type Gesture } from "./robot.ts";
import { cardTone, draw, loadDeck, searchCard, shuffle, toneOf, type Card, type DrawnCard } from "./tarot.ts";

const robot = createRobot();

// Every turn is written to transcripts/ for evaluation and the report appendix.
mkdirSync(new URL("../transcripts/", import.meta.url), { recursive: true });
const transcript = new URL(`../transcripts/${new Date().toISOString().replace(/[:.]/g, "-")}.txt`, import.meta.url);
const log = (speaker: string, text: string) => appendFileSync(transcript, `${speaker}: ${text}\n`);

interface Ctx {
  deck: Card[];
  shuffled: Card[];
  question: string;
  chosen: number[];
  lastCheck: NumberCheck & { parsed: number };
  drawn: DrawnCard[];
  readings: string[];
  summary: string;
  revealIndex: number;
  heard: string;
  lastSaid: string;
  silences: number;
  intent: FollowUpIntent;
  round: number; // readings done so far
  focus: Subject | null; // the card under discussion: what "it" refers to
  subject: Subject | null; // the card the current answer is about
  pendingGoodOrBad: boolean;
  route: Route;
  query: string;
  sensitive: Exclude<Sensitive, "crisis"> | null; // the sensitive question we offered to rephrase
}

const GESTURE_FOR_TONE: Record<ReturnType<typeof toneOf>, Gesture> = {
  bright: "BigSmile",
  hard: "BrowFrown",
  neutral: "Thoughtful",
};

// "So far I have 7 and 23. Choose one more number."
function remainingPrompt(c: Ctx): string {
  let sofar = "";
  if (c.chosen.length > 0) {
    sofar = `So far I have ${spokenList(c.chosen)}. `;
  }

  const left = 3 - c.chosen.length;
  if (left === 1) {
    return `${sofar}Choose one more number.`;
  }
  return `${sofar}Choose ${left} more numbers.`;
}

const machine = setup({
  types: { context: {} as Ctx },
  actions: {
    rememberSaid: assign({ lastSaid: ({ event }) => (event as unknown as { output: string }).output }),
    rememberHeard: assign({ heard: ({ event }) => (event as unknown as { output: string }).output }),
    logError: ({ event }) => console.error((event as { error?: unknown }).error),
  },
  actors: {
    load: fromPromise(async () => {
      void warmUp(); // not awaited: the model loads during the greeting and the breathing ritual
      await robot.setVoice(process.env.VOICE ?? "CoraMultilingualNeural");
      // The mask name really is "anime [legacy]", exactly as the web interface shows it.
      await robot.setFace(process.env.FACE_MASK ?? "anime [legacy]", process.env.FACE_CHARACTER ?? "AnimePink");
      await robot.attendUser().catch(() => {});
      return loadDeck();
    }),
    speak: fromPromise(async ({ input }: { input: { text: string; gesture?: Gesture } }) => {
      if (input.gesture) await robot.gesture(input.gesture);
      log("Furhat", input.text);
      await robot.say(input.text);
      return input.text;
    }),
    listen: fromPromise(async () => {
      const heard = await robot.listen();
      log("User", heard || "(silence)");
      return heard;
    }),
    // Interpretations are prepared in parallel while Furhat is already talking.
    prepareReading: fromPromise(async ({ input }: { input: { question: string; drawn: DrawnCard[] } }) => {
      const intro = "Let me turn your cards and see what they have to say.";
      log("Furhat", intro);
      const [readings, summary] = await Promise.all([
        Promise.all(input.drawn.map((d, i) => interpretCard(input.question, d, i, input.drawn.slice(0, i)))),
        summarise(input.question, input.drawn),
        robot.gesture("Thoughtful").then(() => robot.say(intro)),
      ]);
      return { readings: readings.map((r) => r.text), summary: summary.text };
    }),
    // "What does the Tower mean?" Returns what to say, and the card so that "it" can refer to it next.
    describe: fromPromise(async ({ input }: { input: { query: string; c: Ctx } }): Promise<{ text: string; subject: Subject | null }> => {
      const card = await searchCard(input.query, input.c.deck);
      if (!card) {
        // Not a card name, e.g. "which card means good luck?" -> out of scope
        return { text: "", subject: null };
      }

      // Is it one of the user's three cards? (-1 if not)
      const drawnAt = input.c.drawn.findIndex((d) => d.card.name === card.name);

      let subject: Subject;
      let where: string;
      if (drawnAt >= 0) {
        // One of the user's cards: use it as drawn (with its orientation).
        subject = { drawn: input.c.drawn[drawnAt], index: drawnAt };
        where = `${card.spokenName} is your ${positionName(drawnAt)} card. `;
      } else {
        // Not drawn: wrap it in the same shape, upright, with index -1.
        subject = { drawn: { card, reversed: false, number: 0 }, index: -1 };
        where = "";
      }

      const description = await describeCard(card, input.c.question);
      return { text: where + description.text, subject };
    }),
    advise: fromPromise(async ({ input }: { input: { question: string; drawn: DrawnCard[] } }) => (await advise(input.question, input.drawn)).text),
    classify: fromPromise(async ({ input }: { input: string }) => classifyFollowUp(input)),
  },
}).createMachine({
  id: "tarot",
  initial: "Boot",
  context: {
    deck: [],
    shuffled: [],
    question: "",
    chosen: [],
    lastCheck: { accepted: [], outOfRange: [], repeated: [], parsed: 0 },
    drawn: [],
    readings: [],
    summary: "",
    revealIndex: 0,
    heard: "",
    lastSaid: "",
    silences: 0,
    intent: { intent: "other" },
    round: 0,
    focus: null,
    subject: null,
    pendingGoodOrBad: false,
    route: "OutOfScope",
    query: "",
    sensitive: null,
  },
  states: {
    Boot: {
      invoke: {
        src: "load",
        onDone: { target: "Greeting", actions: assign({ deck: ({ event }) => event.output }) },
        onError: { target: "Fail", actions: ({ event }) => console.error("Could not load the deck:", event.error) },
      },
    },

    // ---------- 1. Ask ----------
    Greeting: say(() => "Welcome, seeker. I am Tarot Furhat, and the cards are waiting for you.", "Ritual", () => "Smile"),
    // A moment of "connection" before the question: Furhat closes its eyes and waits.
    Ritual: say(
      (c) =>
        c.round === 0
          ? "Before we begin, let us connect. Take a slow, deep breath, and quietly think of the question you want to ask."
          : "Let us clear the cards. Take a deep breath, and think of your next question.",
      "Breathe",
      () => "CloseEyes",
    ),
    Breathe: { after: { 4000: "AskQuestion" } },
    AskQuestion: say(() => "Good. When you are ready, tell me your question.", "HearQuestion", () => "OpenEyes"),
    HearQuestion: hear("ProcessQuestion"),
    ProcessQuestion: {
      always: [
        // Second silence in a row: just do a general reading.
        { guard: ({ context }) => !context.heard && context.silences >= 1, target: "Shuffle", actions: assign({ question: "", silences: 0 }) },
        { guard: ({ context }) => !context.heard, target: "NoQuestion", actions: assign({ silences: ({ context }) => context.silences + 1 }) },
        { guard: ({ context }) => isGoodbye(context.heard), target: "Goodbye" },
        // Questions an ethical tarot reader would not read on.
        { guard: ({ context }) => sensitiveTopic(context.heard) === "crisis", target: "Crisis", actions: assign({ silences: 0 }) },
        {
          guard: ({ context }) => sensitiveTopic(context.heard) !== undefined,
          target: "Sensitive",
          actions: assign({ sensitive: ({ context }) => sensitiveTopic(context.heard) as Exclude<Sensitive, "crisis">, silences: 0 }),
        },
        // "Tell me about my life": ask which area first.
        { guard: ({ context }) => isVague(context.heard), target: "AskTopic", actions: assign({ silences: 0 }) },
        { target: "Shuffle", actions: assign({ question: ({ context }) => context.heard, silences: 0 }) },
      ],
    },
    NoQuestion: say(() => "Take your time. Tell me what is on your mind, or ask for a general reading.", "HearQuestion"),

    Crisis: say(() => CRISIS_REPLY, "HearQuestion"),

    // Decline, and offer a gentler question instead (as real readers do).
    Sensitive: say(
      (c) => {
        const { reply, reframe } = SENSITIVE_REPLY[c.sensitive!];
        return `${reply} But we could ask the cards something gentler: ${reframe} Shall we ask that instead?`;
      },
      "HearReframe",
      () => "Thoughtful",
    ),
    HearReframe: hear("ProcessReframe"),
    ProcessReframe: {
      always: [
        { guard: ({ context }) => !context.heard && context.silences >= 1, target: "Goodbye" },
        { guard: ({ context }) => !context.heard, target: "ReframeAgain", actions: assign({ silences: ({ context }) => context.silences + 1 }) },
        { guard: ({ context }) => isGoodbye(context.heard), target: "Goodbye" },
        {
          guard: ({ context }) => isYes(context.heard) && !isNo(context.heard),
          target: "Shuffle",
          actions: assign({ question: ({ context }) => SENSITIVE_REPLY[context.sensitive!].reframe, silences: 0 }),
        },
        { guard: ({ context }) => isNo(context.heard) && context.heard.split(" ").length <= 3, target: "OtherQuestion" },
        // Anything else is taken as a new question, and checked again.
        { target: "ProcessQuestion" },
      ],
    },
    ReframeAgain: say((c) => `Shall we ask: ${SENSITIVE_REPLY[c.sensitive!].reframe} Yes or no?`, "HearReframe"),
    OtherQuestion: say(() => "Of course. Then tell me another question.", "HearQuestion"),

    AskTopic: say(() => "Gladly. To focus the cards: is it about love, work, or yourself? Or shall I do a general reading?", "HearTopic", () => "BrowRaise"),
    HearTopic: hear("ProcessTopic"),
    ProcessTopic: {
      always: [
        { guard: ({ context }) => isGoodbye(context.heard), target: "Goodbye" },
        // Silence or "general": a general reading.
        { guard: ({ context }) => !context.heard || topicOf(context.heard) === "general", target: "Shuffle", actions: assign({ question: "" }) },
        {
          guard: ({ context }) => topicOf(context.heard) !== undefined,
          target: "Shuffle",
          actions: assign({ question: ({ context }) => TOPIC_QUESTION[topicOf(context.heard) as Exclude<ReturnType<typeof topicOf>, "general" | undefined>] }),
        },
        // They answered with a real question instead.
        { target: "Shuffle", actions: assign({ question: ({ context }) => context.heard }) },
      ],
    },

    // ---------- 2. Choose ----------
    Shuffle: {
      entry: assign({ shuffled: ({ context }) => shuffle(context.deck), chosen: [], silences: 0 }),
      ...say(
        (c) =>
          (c.question
            ? "Keep your question in mind while I shuffle the cards... "
            : "Then let the cards speak freely. I am shuffling the deck... ") +
          "The deck is ready. Choose three numbers between 1 and 78.",
        "HearNumbers",
        () => "Thoughtful",
      ),
    },
    HearNumbers: hear("ProcessNumbers"),
    ProcessNumbers: {
      entry: assign(({ context }) => {
        if (!context.heard) return { silences: context.silences + 1 };
        if (wantsRandom(context.heard)) {
          return { chosen: [...context.chosen, ...randomNumbers(3 - context.chosen.length, context.chosen)], silences: 0 };
        }
        const heard = parseNumbers(context.heard);
        const check = checkNumbers(heard, context.chosen);
        return { chosen: [...context.chosen, ...check.accepted], lastCheck: { ...check, parsed: heard.length }, silences: 0 };
      }),
      always: [
        { guard: ({ context }) => context.chosen.length === 3, target: "Confirm" },
        { guard: ({ context }) => isGoodbye(context.heard), target: "Goodbye" },
        { guard: ({ context }) => !context.heard && context.silences >= 3, target: "ChooseForThem" },
        { guard: ({ context }) => !context.heard, target: "NoNumbers" },
        { guard: ({ context }) => context.lastCheck.outOfRange.length > 0, target: "OutOfRange" },
        { guard: ({ context }) => context.lastCheck.repeated.length > 0, target: "Repeated" },
        { guard: ({ context }) => context.lastCheck.parsed === 0, target: "NotNumbers" },
        { target: "AskMoreNumbers" },
      ],
    },
    OutOfRange: say(
      (c) => {
        const bad = c.lastCheck.outOfRange;
        return `The cards are numbered from 1 to 78, so ${spokenList(bad)} ${bad.length > 1 ? "are" : "is"} not in the deck. ${remainingPrompt(c)}`;
      },
      "HearNumbers",
      () => "Shake",
    ),
    Repeated: say((c) => `You already chose ${c.lastCheck.repeated[0]}. Pick a different number. ${remainingPrompt(c)}`, "HearNumbers"),
    NotNumbers: say(() => "I need numbers between 1 and 78. You can also say: you choose.", "HearNumbers"),
    NoNumbers: say(
      (c) => {
        if (c.silences >= 2) {
          return "If you like, just say: you choose, and I will pick for you.";
        }
        return "Just say three numbers, like seven, twenty-three and sixty-one.";
      },
      "HearNumbers",
    ),
    ChooseForThem: {
      entry: assign({ chosen: ({ context }) => [...context.chosen, ...randomNumbers(3 - context.chosen.length, context.chosen)], silences: 0 }),
      ...say(() => "Then let me choose for you.", "Confirm", () => "Wink"),
    },
    AskMoreNumbers: say(
      (c) => {
        if (c.chosen.length === 2) {
          return `${spokenList(c.chosen)}. And your last number?`;
        }
        return remainingPrompt(c);
      },
      "HearNumbers",
    ),

    // Grounding: confirm before the irreversible step of turning the cards.
    Confirm: say((c) => `${spokenList(c.chosen)}. Shall I turn the cards?`, "HearConfirm"),
    HearConfirm: hear("ProcessConfirm"),
    ProcessConfirm: {
      always: [
        // Silent twice: the user has probably walked away.
        { guard: ({ context }) => !context.heard && context.silences >= 1, target: "Goodbye" },
        { guard: ({ context }) => !context.heard, target: "ConfirmAgain", actions: assign({ silences: ({ context }) => context.silences + 1 }) },
        { guard: ({ context }) => isYes(context.heard) && !isNo(context.heard), target: "Draw", actions: assign({ silences: 0 }) },
        // "No, thirty, not thirteen" — start over with whatever numbers came with the correction.
        { guard: ({ context }) => parseNumbers(context.heard).length > 0, target: "ProcessNumbers", actions: assign({ chosen: [] }) },
        { guard: ({ context }) => isNo(context.heard), target: "Rechoose", actions: assign({ chosen: [] }) },
        { target: "ConfirmAgain" },
      ],
    },
    ConfirmAgain: say((c) => `Should I turn the cards ${spokenList(c.chosen)}? Yes or no?`, "HearConfirm"),
    Rechoose: say(() => "No problem. Tell me your three numbers again.", "HearNumbers"),

    // ---------- 3. Read ----------
    Draw: {
      entry: assign({
        drawn: ({ context }) => draw(context.shuffled, context.chosen),
        revealIndex: 0,
        round: ({ context }) => context.round + 1,
        focus: null,
        pendingGoodOrBad: false,
      }),
      invoke: {
        src: "prepareReading",
        input: ({ context }) => ({ question: context.question, drawn: context.drawn }),
        onDone: { target: "RevealCard", actions: assign({ readings: ({ event }) => event.output.readings, summary: ({ event }) => event.output.summary }) },
        onError: { target: "Fail", actions: ({ event }) => console.error(event.error) },
      },
    },
    RevealCard: say(
      (c) => {
        // Explain "reversed" the first time a reversed card turns up.
        const firstReversed = c.drawn.findIndex((d) => d.reversed);
        return revealLine(c.revealIndex, c.drawn[c.revealIndex], c.revealIndex === firstReversed && c.round === 1);
      },
      "SpeakReading",
      (c) => GESTURE_FOR_TONE[toneOf(c.drawn[c.revealIndex])],
    ),
    SpeakReading: say((c) => c.readings[c.revealIndex], "NextCard"),
    NextCard: {
      always: [
        { guard: ({ context }) => context.revealIndex < 2, target: "RevealCard", actions: assign({ revealIndex: ({ context }) => context.revealIndex + 1 }) },
        { target: "Summary" },
      ],
    },
    Summary: say((c) => `${c.summary} Is there anything you would like to know about your cards?`, "HearFollowUp", () => "Nod"),

    // ---------- 4. Follow up ----------
    HearFollowUp: hear("ProcessFollowUp"),
    ProcessFollowUp: {
      always: [
        { guard: ({ context }) => !context.heard && context.silences >= 1, target: "Goodbye" },
        { guard: ({ context }) => !context.heard, target: "FollowUpSilence", actions: assign({ silences: ({ context }) => context.silences + 1 }) },
        {
          guard: ({ context }) => followUpIntent(context.heard, context.deck) !== undefined,
          target: "RouteFollowUp",
          actions: assign({ intent: ({ context }) => followUpIntent(context.heard, context.deck)!, silences: 0 }),
        },
        { target: "ClassifyFollowUp", actions: assign({ silences: 0 }) },
      ],
    },
    ClassifyFollowUp: {
      invoke: {
        src: "classify",
        input: ({ context }) => context.heard,
        onDone: { target: "RouteFollowUp", actions: assign({ intent: ({ event }) => event.output }) },
        onError: { target: "RouteFollowUp", actions: assign({ intent: { intent: "other" } }) },
      },
    },
    RouteFollowUp: {
      entry: assign(({ context }) => {
        const plan = planFollowUp(context.intent, context);
        return {
          route: plan.route,
          subject: plan.subject ?? null,
          query: plan.query ?? "",
          pendingGoodOrBad: plan.pendingGoodOrBad,
          focus: plan.subject ?? context.focus, // whatever we talk about now is what "it" means next
        };
      }),
      always: [
        { guard: ({ context }) => context.route === "AnswerDrawnCard", target: "AnswerDrawnCard" },
        { guard: ({ context }) => context.route === "DescribeCard", target: "DescribeCard" },
        { guard: ({ context }) => context.route === "GoodOrBad", target: "GoodOrBad" },
        { guard: ({ context }) => context.route === "AskWhichCard", target: "AskWhichCard" },
        { guard: ({ context }) => context.route === "YesOrNo", target: "YesOrNo" },
        { guard: ({ context }) => context.route === "When", target: "When" },
        { guard: ({ context }) => context.route === "Advice", target: "Advice" },
        { guard: ({ context }) => context.route === "IsItReal", target: "IsItReal" },
        { guard: ({ context }) => context.route === "Thanks", target: "Thanks" },
        { guard: ({ context }) => context.route === "Repeat", target: "Repeat" },
        { guard: ({ context }) => context.route === "AnotherReading", target: "AnotherReading" },
        { guard: ({ context }) => context.route === "Goodbye", target: "Goodbye" },
        { target: "OutOfScope" },
      ],
    },
    AnswerDrawnCard: say(
      (c) => {
        const { drawn: d, index: i } = c.subject!;
        return `Your ${positionName(i)} card was ${cardWithArticle(d)}${d.reversed ? ", reversed" : ""}. ${c.readings[i]} Anything else?`;
      },
      "HearFollowUp",
    ),
    GoodOrBad: say(
      (c) => `${goodOrBadAnswer(c.subject!.drawn)} Anything else?`,
      "HearFollowUp",
      (c) => {
        if (cardTone(c.subject!.drawn.card) === "bright") return "BigSmile";
        return "Thoughtful";
      },
    ),
    YesOrNo: say(
      (c) => `${yesOrNoAnswer(c.drawn).text} Anything else?`,
      "HearFollowUp",
      (c) => {
        if (yesOrNoAnswer(c.drawn).lean === "yes") return "BigSmile";
        return "Thoughtful";
      },
    ),
    When: say((c) => `${whenAnswer(c.drawn)} Anything else?`, "HearFollowUp", () => "Thoughtful"),
    Advice: {
      invoke: {
        src: "advise",
        input: ({ context }) => ({ question: context.question, drawn: context.drawn }),
        onDone: { target: "SpeakAdvice", actions: assign({ lastSaid: ({ event }) => event.output }) },
        onError: { target: "OutOfScope" },
      },
    },
    SpeakAdvice: say((c) => `${c.lastSaid} Anything else?`, "HearFollowUp", () => "Smile"),
    IsItReal: say(() => `${IS_IT_REAL} Anything else?`, "HearFollowUp", () => "Wink"),
    Thanks: say(() => "You are very welcome! Is there anything else you would like to know?", "HearFollowUp", () => "Smile"),
    AskWhichCard: say(() => "Which card do you mean: the first, the second, or the third?", "HearFollowUp", () => "BrowRaise"),
    DescribeCard: {
      invoke: {
        src: "describe",
        input: ({ context }) => ({ query: context.query, c: context }),
        onDone: [
          { guard: ({ event }) => !event.output.text, target: "OutOfScope" },
          {
            target: "SpeakDescription",
            actions: assign({ lastSaid: ({ event }) => event.output.text, focus: ({ event, context }) => event.output.subject ?? context.focus }),
          },
        ],
        onError: { target: "OutOfScope" },
      },
    },
    SpeakDescription: say((c) => `${c.lastSaid} Anything else?`, "HearFollowUp"),
    Repeat: say((c) => c.lastSaid, "HearFollowUp"),
    OutOfScope: say(
      () => "That is beyond what the cards can show me. You can ask about one of your cards, ask what to do next, ask for another reading, or say goodbye.",
      "HearFollowUp",
      () => "GazeAway",
    ),
    FollowUpSilence: say(() => "You can ask about any of your cards, or say goodbye.", "HearFollowUp"),
    AnotherReading: {
      entry: assign({ question: "", chosen: [], drawn: [], readings: [], silences: 0 }),
      ...say(() => "Of course.", "Ritual", () => "Smile"),
    },

    Goodbye: say(
      () =>
        "Thank you for visiting Tarot Furhat. Remember, the cards are just for fun: " +
        "they cannot really see the future, and your choices are always your own. Goodbye, and good luck!",
      "Done",
      () => "BigSmile",
    ),
    Done: { type: "final" },
    Fail: { type: "final" },
  },
});

// State helpers: "say something, then go to target" and "listen, then go to target".
function say(text: (c: Ctx) => string, target: string, gesture?: (c: Ctx) => Gesture) {
  return {
    invoke: {
      src: "speak" as const,
      input: ({ context }: { context: Ctx }) => ({ text: text(context), gesture: gesture?.(context) }),
      onDone: { target, actions: "rememberSaid" as const },
      onError: { target: "Fail", actions: "logError" as const },
    },
  };
}

function hear(target: string) {
  return {
    invoke: {
      src: "listen" as const,
      onDone: { target, actions: "rememberHeard" as const },
      onError: { target: "Fail", actions: "logError" as const },
    },
  };
}

const actor = createActor(machine);
actor.subscribe((snapshot) => {
  if (process.env.DEBUG) console.log(`[state] ${String(snapshot.value)}`);
  if (snapshot.status === "done") {
    robot.close();
    console.log(`Transcript saved to ${transcript.pathname}`);
    process.exit(snapshot.value === "Fail" ? 1 : 0);
  }
});
process.on("SIGINT", () => {
  robot.close();
  process.exit(0);
});
actor.start();
