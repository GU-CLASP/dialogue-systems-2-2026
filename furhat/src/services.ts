const FURHATURI = "http://127.0.0.1:54321";
let furhatBaseUrl = FURHATURI;

type Param = Record<string, string | number | boolean>;

type Config = {
  method: "POST" | "GET";
  body?: string | Record<string, unknown>;
};

const setFurhatBaseUrl = (url: string) => {
  furhatBaseUrl = url;
  return furhatBaseUrl;
};

const fhFetch = async (action: string, config: Config, param?: Param) => {
  const headers = new Headers();
  headers.append("accept", "application/json");

  if (config.method === "POST" && config.body)
    headers.append("content-type", "application/json");

  const url = new URL(`${furhatBaseUrl}/furhat/${action}`);

  if (param) {
    Object.entries(param).forEach(([key, value]) => {
      url.searchParams.append(key, value.toString());
    });
  }

  const body =
    typeof config.body === "object" ? JSON.stringify(config.body) : config.body;

  // console.log("url.href :>> ", url.href);

  const response = await fetch(url.href, {
    headers: headers,
    ...config,
    body,
  });

  const result = await response.json();
  console.log(`${action}, ${JSON.stringify(param)}, result :>> `, result);
  return result;
};

const fhVoice = (name: string) =>
  fhFetch("voice", { method: "POST" }, { name });

const fhSay = (text: string) =>
  fhFetch("say", { method: "POST" }, { text, blocking: true });

const fhAudio = (url: string, blocking: boolean) =>
  fhFetch("say", { method: "POST" }, { url, blocking });

const newGesture = () =>
  fhFetch(
    "gesture",
    {
      method: "POST",
      body: {
        name: "newGesture",
        frames: [
          {
            time: [0.35, 1], //ADD THE TIME FRAME OF YOUR LIKING
            persist: true,
            params: {
              BROW_UP_RIGHT: 1,
              BROW_DOWN_LEFT: 1,
              //ADD PARAMETERS HERE IN ORDER TO CREATE A GESTURE
            },
          },
          {
            time: [1.5], //ADD TIME FRAME IN WHICH YOUR GESTURE RESETS
            persist: true,
            params: {
              reset: true,
            },
          },
          //ADD MORE TIME FRAMES IF YOUR GESTURE REQUIRES THEM
        ],
        class: "furhatos.gestures.Gesture",
      },
    },
    { blocking: false },
  );

const fhGesture = (name: string, blocking: boolean) =>
  fhFetch("gesture", { method: "POST" }, { name, blocking });

const fhListen = () => fhFetch("listen", { method: "GET" });

const fhAttend = (user: "CLOSEST" | "OTHER" | "RANDOM") =>
  fhFetch("attend", { method: "POST" }, { user });

const fhLed = (red = 0, green = 0, blue = 0) =>
  fhFetch("led", { method: "POST" }, { red, green, blue });

export {
  fhAttend,
  fhAudio,
  fhGesture,
  fhLed,
  fhListen,
  fhSay,
  fhVoice,
  newGesture,
  setFurhatBaseUrl,
};
