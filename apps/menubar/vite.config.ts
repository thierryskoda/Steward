import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  clearScreen: false,
  plugins: [tailwindcss()],
  server: {
    port: 1420,
    strictPort: true,
  },
});
