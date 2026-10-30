// Two ways to "embody" the dialogue manager:
// - FurhatRobot talks to the Furhat Remote API (virtual or physical robot)
// - ConsoleRobot prints to the terminal and reads typed input, for development
//   and testing without the SDK running (`npm run text`).
import { readFileSync } from "node:fs";
import * as readline from "node:readline/promises";

export type Gesture =
  | "BigSmile"
  | "Smile"
  | "BrowFrown"
  | "BrowRaise"
  | "Nod"
  | "Shake"
  | "Surprise"
  | "Thoughtful"
  | "GazeAway"
  | "Wink"
  | "CloseEyes"
  | "OpenEyes";

export interface Robot {
  say(text: string): Promise<void>;
  /** Resolves with what the user said, or "" on silence / no match. */
  listen(): Promise<string>;
  gesture(name: Gesture): Promise<void>;
  setVoice(name: string): Promise<void>;
  /** Names as shown in the web interface (case-sensitive). The API reports success even for unknown names. */
  setFace(mask: string, character: string): Promise<void>;
  attendUser(): Promise<void>;
  close(): void;
}

// Signals turn-taking with the LED, as in Lab 3.
const LED = {
  speaking: { red: 120, green: 40, blue: 160 }, // purple: Furhat is talking
  listening: { red: 0, green: 60, blue: 255 }, // blue: your turn
  off: { red: 0, green: 0, blue: 0 },
};

const NO_INPUT = new Set(["", "SILENCE", "NOMATCH", "INTERRUPTED", "FAILED"]);

export class FurhatRobot implements Robot {
  constructor(private readonly host = process.env.FURHAT_HOST ?? "127.0.0.1:54321") {}

  private post(path: string, body = "") {
    return fetch(`http://${this.host}/furhat/${path}`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body,
    });
  }

  private led(color: { red: number; green: number; blue: number }) {
    return this.post(`led?red=${color.red}&green=${color.green}&blue=${color.blue}`);
  }

  async say(text: string) {
    await this.led(LED.speaking);
    await this.post(`say?text=${encodeURIComponent(text)}&blocking=true`);
  }

  async listen() {
    await this.led(LED.listening);
    const res = await fetch(`http://${this.host}/furhat/listen`, {
      headers: { accept: "application/json" },
    });
    await this.led(LED.off);
    const raw = await res.text();
    let message = "";
    try {
      message = String(JSON.parse(raw).message ?? "");
    } catch {
      message = raw;
    }
    return NO_INPUT.has(message.trim()) ? "" : message.trim();
  }

  async gesture(name: Gesture) {
    await this.post(`gesture?name=${name}&blocking=false`);
  }

  async setVoice(name: string) {
    await this.post(`voice?name=${encodeURIComponent(name)}`);
  }

  async setFace(mask: string, character: string) {
    await this.post(`face?mask=${encodeURIComponent(mask)}&character=${encodeURIComponent(character)}`);
  }

  async attendUser() {
    await this.post("attend?user=CLOSEST");
  }

  close() {
    void this.led(LED.off);
  }
}

export class ConsoleRobot implements Robot {
  private rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  async say(text: string) {
    console.log(`\x1b[35mFurhat:\x1b[0m ${text}`);
  }

  async listen() {
    // An empty line simulates silence.
    return (await this.rl.question("\x1b[34mYou:\x1b[0m ")).trim();
  }

  async gesture(name: Gesture) {
    console.log(`\x1b[2m        [${name}]\x1b[0m`);
  }

  async setVoice() {}
  async setFace() {}
  async attendUser() {}

  close() {
    this.rl.close();
  }
}

/** Plays the user's turns from a file (one per line, empty line = silence). Used for test scenarios. */
export class ScriptedRobot extends ConsoleRobot {
  private turns: string[];
  constructor(path: string) {
    super();
    this.turns = readFileSync(path, "utf8").replace(/\n$/, "").split("\n");
  }
  private extraSilences = 0;
  async listen() {
    // Guard against dialogue loops in tests: fail loudly once the script has long run out.
    if (this.turns.length === 0 && ++this.extraSilences > 5) throw new Error("Script exhausted: the dialogue did not end");
    const turn = this.turns.shift() ?? "";
    console.log(`\x1b[34mYou:\x1b[0m ${turn || "(silence)"}`);
    return turn.trim();
  }
}

export function createRobot(): Robot {
  if (process.env.SCRIPT) return new ScriptedRobot(process.env.SCRIPT);
  return process.env.ROBOT === "console" ? new ConsoleRobot() : new FurhatRobot();
}
