import "./style.css";
import { setupButton } from "./dm.ts";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div class="card">
    <div class="paw">🐾</div>
    <h1>Dog Breed Explorer</h1>
    <p class="subtitle">Explore dog breeds through conversation.</p>

    <button id="start" type="button">Start conversation</button>

    <p class="hint">Try: "I want a small, calm dog" or "Tell me about Beagles"</p>
  </div>
`;

setupButton(
  document.querySelector<HTMLButtonElement>("#start")!
);
