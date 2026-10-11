import { InformationState } from "./types";
import {
  objectsEqual,
  WHQ,
  findout,
  consultDB,
  getFactArgument,
} from "./utils";

export const initialIS = (): InformationState => {
  const predicates: { [index: string]: string } = {
    // Mapping from predicate to sort
    favorite_food: "food",
    booking_day: "day",
    booking_course: "course",
    booking_room: "room",
  };
  const individuals: { [index: string]: string } = {
    // Mapping from individual to sort
    pizza: "food",
    LT2319: "course",
    Tuesday: "day",
    Thursday: "day",
    Friday: "day",
    J440: "room",
    G212: "room"
  };
  return {
    domain: {
      predicates: predicates,
      individuals: individuals,
      plans: [
        {
          type: "issue",
          content: WHQ("booking_room"),
          plan: [
            findout(WHQ("booking_day")),
            findout(WHQ("booking_course")),
            consultDB(WHQ("booking_room")),
          ],
        },
      ],
    },
    database: {
      consultDB: (question, facts) => {
        if (objectsEqual(question, WHQ("booking_room"))) {
          const course = getFactArgument(facts, "booking_course");
          const day = getFactArgument(facts, "booking_day");
          
          if (day == "Tuesday" && course == "LT2319")
            return { predicate: "booking_room", argument: "J440"};
          if (day == "Thursday" && course == "LT2319")
            return { predicate: "booking_room", argument: "J440"}
          if (day == "Friday" && course == "LT2319") {
            return { predicate: "booking_room", argument: "G212" };
          }
        }
        return null;
      },
    },
    next_moves: [],
    private: {
      plan: [],
      agenda: [
        {
          type: "greet",
          content: null,
        },
      ],
      bel: [{ predicate: "favorite_food", argument: "pizza" }],
    },
    shared: { lu: undefined, qud: [], com: [] },
  };
};
