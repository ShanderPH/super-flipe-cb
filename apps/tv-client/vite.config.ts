import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { target: "chrome111", sourcemap: false },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8797",
      "/emulatorjs": "http://127.0.0.1:8797",
    },
  },
});
