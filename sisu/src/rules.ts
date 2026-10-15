import {
  Question,
  TotalInformationState,
  InformationState,
  Move,
  Action,
} from "./types";
import { relevant, resolves, combine } from "./semantics";
import { objectsEqual } from "./utils";

const CONFIDENCE_THRESHOLD = 0.7;

type Rules = {
  [index: string]: (
    context: TotalInformationState
  ) => ((x: void) => InformationState) | undefined;
};

export const rules: Rules = {
  clear_agenda: ({ is }) => {
    return () => ({
      ...is,
      private: { ...is.private, agenda: [] },
    });
  },

  /**
   * Grounding
   */
  get_latest_move: (context) => {
    return () => ({
      ...context.is,
      shared: {
        ...context.is.shared,
        lu: {
          moves: context.latest_moves!,
          speaker: context.latest_speaker!,
          score: context.latest_score, // vg 1, for carrying the score
        },
      },
    });
  },

  /**
   * Integrate
   */
  /** rule 5.1 */
  integrate_usr_request: ({ is }) => {
    if (is.shared.lu!.speaker === "usr") {
      for (const move of is.shared.lu!.moves) {
        if (move.type === "request") {
          let action = move.content;
          for (const planInfo of is.domain.plans) {
            if (planInfo.type == "action" && planInfo.content == action) {
              return () => ({
                ...is,
                private: {
                  ...is.private,
                  agenda: planInfo.plan.concat(is.private.agenda),
                },
              });
            }
          }
        }
      }
    }
  },

  /** rule 2.2 */
  integrate_sys_ask: ({ is }) => {
    if (is.shared.lu!.speaker === "sys") {
      for (const move of is.shared.lu!.moves) {
        if (move.type === "ask") {
          const q = move.content;

          // Do not add the question again if it is already on QUD
          const alreadyInQUD = is.shared.qud.some((existingQ) =>
            objectsEqual(existingQ, q)
          );

          if (alreadyInQUD) {
            return () => ({
              ...is,
            });
          }

          return () => ({
            ...is,
            shared: {
              ...is.shared,
              qud: [q, ...is.shared.qud],
            },
          });
        }
      }
    }
  },

  /** rule 2.3 */
  integrate_usr_ask: ({ is }) => {
    if (is.shared.lu!.speaker === "usr") {
      for (const move of is.shared.lu!.moves) {
        if (move.type === "ask") {
          const question = move.content;
          const respondAction: { type: "respond"; content: Question } = {
            type: "respond",
            content: question,
          };
          return () => ({
            ...is,
            shared: {
              ...is.shared,
              qud: [question, ...is.shared.qud],
            },
            private: {
              ...is.private,
              agenda: [respondAction, ...is.private.agenda],
            },
          });
        }
      }
    }
  },

  /** rule 2.4 */
  integrate_answer: ({ is }) => {
    const topQUD = is.shared.qud[0];
    if (topQUD) { // continues only when some questioin is being discussed
      for (const move of is.shared.lu!.moves) {
        if (move.type === "answer") {
          const a = move.content;
          if (relevant(is.domain, a, topQUD)) { // does this answer fit the current question
            let proposition = combine(is.domain, topQUD, a);
            return () => ({
              ...is,
              shared: {
                ...is.shared,
                com: [proposition, ...is.shared.com],
              },
            });
          }
        }
      }
    }
  },

  /** rule 2.6 */
  integrate_greet: ({ is }) => {
    for (const move of is.shared.lu!.moves) {
      if (move.type === "greet") {
        return () => ({
          ...is,
        });
      }
    }
  },

  /** TODO rule 2.7 integrate_usr_quit */

  /** TODO rule 2.8 integrate_sys_quit */

  // check whether the latest user utterance was not understood
  integrate_negative_understanding: ({ is }) => {
    if (
      is.shared.lu!.speaker === "usr" && // last utterance was from user
      Array.isArray(is.shared.lu!.moves) && //the moves field exists and is an array
      is.shared.lu!.moves.length === 0 // no dialogue moves were recognized from the user's utterance
    ) {
      return () => ({ 
        ...is, // copy all the properties from is
        next_moves: [
          ...is.next_moves, // adding a new dialogue move
          { type: "icm:neg:understanding", content: null },
        ],
      });
    }
  },

  // vg 1

  // for checking if the nlu recognize sth but with low confidence
  integrate_low_confidence: ({ is }) => {
    if ( 
      is.shared.lu!.speaker === "usr" && // if the latest utterance came from the user
      Array.isArray(is.shared.lu!.moves) && // so moves exist and is an array
      is.shared.lu!.moves.length > 0 && // checks that the nlu recognizes at least one move
      is.shared.lu!.score !== undefined && // we check if confidence score exists
      is.shared.lu!.score < CONFIDENCE_THRESHOLD && // check if confidence is below the threshold
      !is.private.pending_confirmation // check that we are not already waiting for confirmation
    ) { // and if all of these were true
      const move = is.shared.lu!.moves[0]; // first recognized move
      if (move.type !== "confirm") { //cuz we dont ask for confirmation of a confirmation
        return () => ({
          ...is,
          private: { ...is.private, pending_confirmation: move }, // we store the uncertain move
          next_moves: [
            ...is.next_moves,
            { type: "icm:usr:confirm", content: move }, // we add a confirmation request
          ],
        });
      }
    }
  },


  // to process the user's reply to the confirmation request
  integrate_confirm: ({ is }) => {
    if (is.shared.lu!.speaker === "usr" && is.private.pending_confirmation) { // again if it was user speaking and there is sth waiting for confirmation
      for (const move of is.shared.lu!.moves) { // we loop through the moves
        if (move.type === "confirm") { // and if the move was a confirmation move
          const pending = is.private.pending_confirmation; // save the pending move
          if (move.content === "yes" && pending.type === "answer") { // if the user said yes
            const topQUD = is.shared.qud[0]; // current question
            if (topQUD && relevant(is.domain, pending.content, topQUD)) { // we check relevance
              const proposition = combine(is.domain, topQUD, pending.content); // making the preposition
              return () => ({
                ...is,
                private: { ...is.private, pending_confirmation: undefined },
                shared: { ...is.shared, com: [proposition, ...is.shared.com] },
              });
            }
          }
          // if the user says no
          return () => ({ // only clear the pending confirmation
            ...is,
            private: { ...is.private, pending_confirmation: undefined },
          });
        }
      }
    }
  },


  /**
   * DowndateQUD
   */
  /** rule 2.5 */
  downdate_qud: ({ is }) => {
    const q = is.shared.qud[0];
    for (const p of is.shared.com) {
      if (resolves(p, q)) {
        return () => ({
          ...is,
          shared: {
            ...is.shared,
            qud: [...is.shared.qud.slice(1)],
          },
        });
      }
    }
  },

  /**
   * ExecPlan
   */
  /** rule 2.9 */
  find_plan: ({ is }) => {
    if (is.private.agenda.length > 0) {
      const action = is.private.agenda[0];
      if (action.type === "respond") {
        const question = action.content;
        for (const planInfo of is.domain.plans) {
          if (
            planInfo.type == "issue" &&
            objectsEqual(planInfo.content, question)
          ) {
            return () => ({
              ...is,
              private: {
                ...is.private,
                agenda: is.private.agenda.slice(1),
                plan: planInfo.plan,
              },
            });
          }
        }
      }
    }
  },

  /** rule 2.10 */
  remove_findout: ({ is }) => {
    if (is.private.plan.length > 0) {
      const action = is.private.plan[0];
      if (action.type === "findout") {
        const question = action.content as Question;
        for (let proposition of is.shared.com) {
          if (resolves(proposition, question)) {
            return () => ({
              ...is,
              private: {
                ...is.private,
                plan: is.private.plan.slice(1),
              },
            });
          }
        }
      }
    }
  },

  /** rule 2.11 */
  exec_consultDB: ({ is }) => {
    if (is.private.plan.length > 0) {
      const action = is.private.plan[0];
      if (action.type === "consultDB") {
        const question = action.content as Question;
        const propositionFromDB = is.database.consultDB(
          question,
          is.shared.com
        );
        if (propositionFromDB) {
          return () => ({
            ...is,
            private: {
              ...is.private,
              plan: [...is.private.plan.slice(1)],
              bel: [...is.private.bel, propositionFromDB],
            },
          });
        }
      }
    }
  },

  /**
   * Select
   */
  /** rule 2.12 */
  select_from_plan: ({ is }) => {
    if (is.private.agenda.length === 0 && 
      !!is.private.plan[0] &&
      !is.private.pending_confirmation // for vg 1
    ) {
      const action = is.private.plan[0];
      return () => ({
        ...is,
        private: {
          ...is.private,
          agenda: [action, ...is.private.agenda],
        },
      });
    }
  },

  /** rule 2.13 */
  select_ask: ({ is }) => {
    let newIS = is;
    if (
      is.private.agenda[0] &&
      ["findout", "raise"].includes(is.private.agenda[0].type)
    ) {
      const q = is.private.agenda[0].content as Question;
      if (is.private.plan[0] && is.private.plan[0].type === "raise") {
        newIS = {
          ...is,
          next_moves: [...is.next_moves, { type: "ask", content: q }],
          private: { ...is.private, plan: [...is.private.plan.slice(1)] },
        };
      } else {
        newIS = {
          ...is,
          next_moves: [...is.next_moves, { type: "ask", content: q }],
        };
      }
      return () => newIS;
    }
  },

  /** rule 2.14 */
  select_respond: ({ is }) => {
    if (
      is.private.agenda.length === 0 &&
      is.private.plan.length === 0 &&
      is.shared.qud[0]
    ) {
      const topQUD = is.shared.qud[0];
      for (const bel of is.private.bel) {
        if (
          !is.shared.com.some((x) => objectsEqual(x, bel)) &&
          relevant(is.domain, bel, topQUD)
        ) {
          const respondAction: Action = { type: "respond", content: topQUD };
          return () => ({
            ...is,
            private: {
              ...is.private,
              agenda: [respondAction, ...is.private.agenda],
            },
          });
        }
      }
    }
  },

  select_answer: ({ is }) => {
    if (is.private.agenda[0] && is.private.agenda[0].type === "respond") {
      const question = is.private.agenda[0].content as Question;
      for (const bel of is.private.bel) {
        if (
          !is.shared.com.some((x) => objectsEqual(x, bel)) &&
          relevant(is.domain, bel, question)
        ) {
          const answerMove: Move = { type: "answer", content: bel };
          return () => ({
            ...is,
            next_moves: [...is.next_moves, answerMove],
          });
        }
      }
    }
  },

  /** only for greet for now */
  select_other: ({ is }) => {
    if (is.private.agenda[0] && is.private.agenda[0].type === "greet") {
      return () => ({
        ...is,
        next_moves: [...is.next_moves, is.private.agenda[0] as Move],
      });
    }
  },
};
