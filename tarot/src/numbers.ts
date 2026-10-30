// Understanding the user's card numbers. The ASR may return digits ("23"),
// words ("twenty three"), or homophones ("for", "to") for short answers.

export const DECK_SIZE = 78;

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
// Only read as numbers when they sit in a list of numbers ("seven for nine").
const HOMOPHONES: Record<string, number> = { won: 1, to: 2, too: 2, for: 4, fore: 4, ate: 8 };
const LIST_GLUE = new Set(["and", "then", "um", "uh", "number", "numbers", "card"]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/(\d)\s*,\s*(?=\d)/g, "$1 ") // "7,23" -> "7 23"
    .replace(/-/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

type Atom = number | "hundred" | "thousand" | "minus" | "and" | "a";
const MULTIPLY = { hundred: 100, thousand: 1000 };
const isMultiplier = (a: Atom | undefined): a is "hundred" | "thousand" => a === "hundred" || a === "thousand";

/** Extracts every number the user said, in order. Values outside 1–78 are kept (for feedback). */
export function parseNumbers(text: string): number[] {
  const tokens = tokenize(text);
  const isNumberish = (t?: string) =>
    t !== undefined && (/^\d+$/.test(t) || t in UNITS || t in TENS || t in HOMOPHONES || t in MULTIPLY);
  const onlyNumbers = tokens.every((x) => isNumberish(x) || LIST_GLUE.has(x));

  // Pass 1: words -> atoms ("twenty three" -> 23, "hundred" stays a marker).
  const atoms: Atom[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^\d+$/.test(t)) atoms.push(Number(t));
    else if (t in TENS) {
      const next = tokens[i + 1];
      if (next !== undefined && next in UNITS && UNITS[next] > 0 && UNITS[next] < 10) {
        atoms.push(TENS[t] + UNITS[next]);
        i++;
      } else atoms.push(TENS[t]);
    } else if (t in UNITS) atoms.push(UNITS[t]);
    else if (t === "hundred" || t === "thousand" || t === "and" || t === "a") atoms.push(t);
    else if (t === "minus" || t === "negative") atoms.push("minus");
    else if (t in HOMOPHONES) {
      // "seven for nine" -> 4, but not "I'd like to choose" or "numbers for me".
      const neighbourIsNumber = isNumberish(tokens[i - 1]) || isNumberish(tokens[i + 1]);
      if ((neighbourIsNumber && onlyNumbers) || tokens.length === 1) atoms.push(HOMOPHONES[t]);
    }
  }

  // Pass 2: combine ("two hundred and five" -> 205, "a hundred" -> 100, "minus five" -> -5).
  const out: number[] = [];
  let negate = false;
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    if (a === "minus") {
      negate = true;
      continue;
    }
    let value: number;
    if (typeof a === "number") value = a;
    else if (isMultiplier(a)) value = 1; // "hundred" on its own
    else if (a === "a" && isMultiplier(atoms[i + 1])) value = 1;
    else continue; // a stray "and" or "a"

    const mult = isMultiplier(a) ? a : atoms[i + 1];
    if (isMultiplier(mult)) {
      value *= MULTIPLY[mult];
      if (!isMultiplier(a)) i++;
      const rest = atoms[i + 2];
      if (atoms[i + 1] === "and" && typeof rest === "number" && rest < 100) {
        value += rest;
        i += 2;
      }
    }
    out.push(negate ? -value : value);
    negate = false;
  }
  return out;
}

export interface NumberCheck {
  accepted: number[]; // new valid numbers, in order
  outOfRange: number[];
  repeated: number[];
}

/** Adds newly heard numbers to the ones already chosen, collecting anything that needs repair. */
export function checkNumbers(heard: number[], alreadyChosen: number[], needed = 3): NumberCheck {
  const accepted: number[] = [];
  const outOfRange: number[] = [];
  const repeated: number[] = [];
  for (const n of heard) {
    if (alreadyChosen.length + accepted.length >= needed) break;
    if (n < 1 || n > DECK_SIZE) outOfRange.push(n);
    else if (alreadyChosen.includes(n) || accepted.includes(n)) repeated.push(n);
    else accepted.push(n);
  }
  return { accepted, outOfRange, repeated };
}

export function randomNumbers(count: number, exclude: number[] = [], rand = Math.random): number[] {
  const picked: number[] = [];
  while (picked.length < count) {
    const n = 1 + Math.floor(rand() * DECK_SIZE);
    if (!exclude.includes(n) && !picked.includes(n)) picked.push(n);
  }
  return picked;
}

/** "7, 23 and 61" — joins a list the way people say it. */
export function spokenList(items: (string | number)[]): string {
  const s = items.map(String);
  if (s.length <= 1) return s.join("");
  return `${s.slice(0, -1).join(", ")} and ${s[s.length - 1]}`;
}

export const ordinalWord = (i: number) => ["first", "second", "third"][i] ?? `${i + 1}th`;
