import type { CapacitorConfig } from "@capacitor/cli";

// Capacitor wrapper that ships the existing React/TS admin portal as a native
// iPad app. The web build (Vite → dist) is bundled into the app; the portal talks
// to the SAME production backend (https://pathway.nuruplace.org/v1) — set via
// VITE_API_BASE at build time. CapacitorHttp routes the portal's axios/fetch calls
// through the native HTTP stack, so cross-origin requests are NOT subject to
// browser CORS (no backend change required).
const config: CapacitorConfig = {
  appId: "org.nuruplace.portal",
  appName: "Nuru Portal",
  webDir: "dist",
  ios: {
    contentInset: "always",
    backgroundColor: "#0B1F33",
  },
  plugins: {
    CapacitorHttp: { enabled: true },
  },
};

export default config;
