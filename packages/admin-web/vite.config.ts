import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The portal calls the API at "/v1"; in dev, Vite proxies that to the backend on
// :8080 (same-origin from the browser's view, so no CORS needed). In production
// the portal is served behind the same gateway as the API.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/v1": { target: "http://localhost:8080", changeOrigin: true },
    },
  },
});
