import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// En développement, l'API et Socket.IO sont servis par le serveur Node (port 8080).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": "http://localhost:8080",
      "/socket.io": { target: "http://localhost:8080", ws: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Bibliothèques séparées : meilleur cache navigateur lors des mises à jour.
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
          realtime: ["socket.io-client"],
        },
      },
    },
  },
});
