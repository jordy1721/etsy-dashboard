// Builds the phone app (src/client) into ./dist, which the Worker serves.
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  root: "src/client",
  publicDir: "../../public",
  plugins: [preact()],
  build: { outDir: "../../dist", emptyOutDir: true, target: "es2020" },
});
