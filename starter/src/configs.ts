import { Settings } from "speechstate";

import { REGION } from "./constants";
import { KEY } from "./credentials";

const azureCredentials = {
  endpoint: `https://${REGION}.api.cognitive.microsoft.com/sts/v1.0/issuetoken`,
  key: KEY,
};

const settings: Settings = {
  azureCredentials: azureCredentials,
  azureRegion: REGION,
  asrDefaultCompleteTimeout: 0,
  asrDefaultNoInputTimeout: 5000,
  locale: "en-US",
  ttsDefaultVoice: "en-US-DavisNeural",
  bargeIn: false,
};

export { azureCredentials, settings };
