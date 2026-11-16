import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // React in its own long-lived chunk; the views split per tab via
        // React.lazy in App.jsx.
        manualChunks: { vendor: ["react", "react-dom"] },
      },
    },
  },
});
