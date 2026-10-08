import { defineConfig } from "vite";

export default defineConfig({
  // relative paths so the build works under /<repo>/ on GitHub Pages
  base: "./",
  // ffmpeg.wasm spawns its worker via `new URL(..., import.meta.url)`,
  // which breaks when Vite pre-bundles it
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
  },
});
