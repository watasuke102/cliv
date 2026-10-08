import { defineConfig } from "vite";

export default defineConfig({
  // ffmpeg.wasm spawns its worker via `new URL(..., import.meta.url)`,
  // which breaks when Vite pre-bundles it
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
  },
});
