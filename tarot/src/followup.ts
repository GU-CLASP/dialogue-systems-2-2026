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
  | "YesOrNo"
  | "When"
  | "Advice"
  | "IsItReal"
  | "Thanks"
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
      // Which card is the question about?
      let subject: Subject | undefined;
      if (intent.position !== undefined) {
        subject = atPosition(intent.position); // "is the second one bad?"
      } else if (intent.card) {
        subject = byName(intent.card); // "is the Tower bad?"
      } else if (s.focus) {
        subject = s.focus; // "is it good?" -> the card under discussion
      }

      if (subject) {
        return { route: "GoodOrBad", subject, pendingGoodOrBad: false };
      }
      // We don't know which card "it" is: ask, and remember the question.
      return { route: "AskWhichCard", pendingGoodOrBad: true };
    }
    case "ask_it": {
      const f = s.focus;
      if (!f) {
        return { route: "AskWhichCard", pendingGoodOrBad: false };
      }
      if (f.index >= 0) {
        return { route: "AnswerDrawnCard", subject: f, pendingGoodOrBad: false }; // one of the user's cards
      }
      return { route: "DescribeCard", query: f.drawn.card.name, pendingGoodOrBad: false }; // another card
    }
    case "yes_or_no":
      return { route: "YesOrNo", pendingGoodOrBad: false };
    case "when":
      return { route: "When", pendingGoodOrBad: false };
    case "advice":
      return { route: "Advice", pendingGoodOrBad: false };
    case "is_it_real":
      return { route: "IsItReal", pendingGoodOrBad: false };
    case "thanks":
      return { route: "Thanks", pendingGoodOrBad: false };
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
