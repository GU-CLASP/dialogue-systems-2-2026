import "./style.css";
import { setupButton } from "./dm.ts";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    <h1>Dog Breed Explorer</h1>
    <p>Explore dog breeds through conversation.</p>

    <div class="card">
      <button id="start" type="button">Start conversation</button>
    </div>
  </div>
`;

setupButton(
  document.querySelector<HTMLButtonElement>("#start")!
);
