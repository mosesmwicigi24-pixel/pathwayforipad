// Axios client that injects the JWT (spec §1.3). Base URL is the versioned API
// surface (§3.1). The offline mutation queue (src/store/offlineSlice) — not this
// client — is the system of record for in-flight writes.
import axios from "axios";

export const api = axios.create({
  baseURL: "https://api.nuruplace.org/v1",
  timeout: 15_000,
});
