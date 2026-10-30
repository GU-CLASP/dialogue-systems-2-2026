// Deciding how to answer a follow-up question, including reference resolution:
// "it" / "this" / "that" point to the card under discussion (the focus), and a
// question we cannot resolve leads to a clarification request.
import type { FollowUpIntent } from "./llm.ts";
import { findCardInText, type Card, type DrawnCard } from "./tarot.ts";

/** A card being talked about. index = position in the reading, or -1 if it was not drawn. */
export interface Subject {
  drawn: DrawnCard;
  index: number;
}

export type Route =
  | "AnswerDrawnCard"
  | "DescribeCard"
  | "GoodOrBad"
  | "AskWhichCard"
  | "Repeat"
  | "AnotherReading"
  | "Goodbye"
  | "OutOfScope";

export interface Plan {
  route: Route;
  subject?: Subject;
  query?: string;
  /** True after "Which card do you mean?" was asked for a good/bad question. */
  pendingGoodOrBad: boolean;
}

interface State {
  deck: Card[];
  drawn: DrawnCard[];
  focus: Subject | null;
  pendingGoodOrBad: boolean;
}

export function planFollowUp(intent: FollowUpIntent, s: State): Plan {
  const atPosition = (i: number): Subject | undefined => (s.drawn[i] ? { drawn: s.drawn[i], index: i } : undefined);
  const byName = (name: string): Subject | undefined => {
    const lower = name.toLowerCase();
    const i = s.drawn.findIndex((d) => d.card.name.toLowerCase() === lower || d.card.spokenName.toLowerCase() === lower);
    if (i >= 0) return atPosition(i);
    const card = s.deck.find((c) => c.name.toLowerCase() === lower) ?? findCardInText(name, s.deck);
    return card ? { drawn: { card, reversed: false, number: 0 }, index: -1 } : undefined;
  };

  switch (intent.intent) {
    case "ask_drawn_card": {
      const subject = atPosition(intent.position);
      if (!subject) return { route: "OutOfScope", pendingGoodOrBad: false };
      // Answer to "Which card do you mean?" after "is it good?"
      return { route: s.pendingGoodOrBad ? "GoodOrBad" : "AnswerDrawnCard", subject, pendingGoodOrBad: false };
    }
    case "ask_card_meaning":
      return { route: "DescribeCard", query: intent.card, pendingGoodOrBad: false };
    case "good_or_bad": {
      const subject =
        intent.position !== undefined ? atPosition(intent.position) : intent.card ? byName(intent.card) : (s.focus ?? undefined);
      return subject
        ? { route: "GoodOrBad", subject, pendingGoodOrBad: false }
        : { route: "AskWhichCard", pendingGoodOrBad: true };
    }
    case "ask_it": {
      const f = s.focus;
      if (!f) return { route: "AskWhichCard", pendingGoodOrBad: false };
      return f.index >= 0
        ? { route: "AnswerDrawnCard", subject: f, pendingGoodOrBad: false }
        : { route: "DescribeCard", query: f.drawn.card.name, pendingGoodOrBad: false };
    }
    case "repeat":
      return { route: "Repeat", pendingGoodOrBad: s.pendingGoodOrBad };
    case "another_reading":
      return { route: "AnotherReading", pendingGoodOrBad: false };
    case "goodbye":
      return { route: "Goodbye", pendingGoodOrBad: false };
    default:
      return { route: "OutOfScope", pendingGoodOrBad: false };
  }
}
