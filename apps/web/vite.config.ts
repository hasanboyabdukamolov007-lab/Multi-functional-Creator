import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: process.env.API_URL ?? "http://localhost:8787", changeOrigin: false } },
  },
  preview: {
    port: 4173,
    proxy: { "/api": { target: process.env.API_URL ?? "http://localhost:8787", changeOrigin: false } },
  },
  build: {
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three", "@react-three/fiber", "@react-three/drei"],
          monaco: ["monaco-editor", "@monaco-editor/react"],
        },
      },
    },
  },
  worker: { format: "es" },
});
