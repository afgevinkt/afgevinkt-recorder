import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

// Main + preload draaien als CommonJS (Electron-default); de renderer is een
// gewone Vite+React-app. externalizeDepsPlugin houdt dependencies (o.a. het
// native onnxruntime-node + @huggingface/transformers) buiten de bundle: ze
// worden at-runtime uit node_modules geladen. Zie ADR's in afgevinkt-app/docs/adr.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
          // Geïsoleerd transcriptie-proces (utilityProcess).
          "transcribe-worker": resolve(__dirname, "src/main/transcribe-worker.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/preload/index.ts") },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    // Transcriptie draait in main (onnxruntime-node); de renderer bundelt geen
    // transformers/WASM meer. Alleen lokale assets + fix-webm-duration.
    build: {
      target: "esnext",
      rollupOptions: {
        input: { index: resolve(__dirname, "src/renderer/index.html") },
      },
    },
    plugins: [react()],
  },
});
