// Axios client for the portal. Injects the gateway-issued JWT (§1.3). Base URL is
// the versioned API surface (§3.1). Interceptors/refresh are added as auth lands.
import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE ?? "https://api.nuruplace.org/v1",
  timeout: 15_000,
});
