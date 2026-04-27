import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const SERVER_URL = process.env.VITE_SERVER_URL ?? "http://localhost:3001";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "DungeonMaster",
        short_name: "DM",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: SERVER_URL,
        rewrite: (path) => path.replace(/^\/api/, ""),
        changeOrigin: true,
      },
    },
  },
});
