import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    environmentMatchGlobs: [["src/**", "jsdom"]],
    include: ["src/**/*.test.{js,jsx}", "server/**/*.test.js", "shared/**/*.test.js"],
    // node:sqlite is experimental in Node 22; the server tests open a temp DB.
    execArgv: ["--disable-warning=ExperimentalWarning"],
  },
});
