import { defineConfig } from "vite";

export default defineConfig({
  // Relative assets make the generated /dist portable, including for GitHub Pages subpaths.
  base: "./",
  server: {
    host: true,
    port: 5173
  },
  preview: {
    host: true,
    port: 4173
  }
});
