// Starts the app and turns on the service worker (fast loading, app-like feel).
import { render } from "preact";
import { App } from "./app";

const root = document.getElementById("app");
if (root) render(<App />, root);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // The app works fine without it.
    });
  });
}
