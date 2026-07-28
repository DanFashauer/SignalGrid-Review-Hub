import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

// Point the generated API client at the SignalGrid api-server.
//
// - Local dev / same-origin: leave VITE_API_BASE_URL unset. Requests stay
//   relative (`/api/*`); Vite proxies them to the api-server in dev, and a
//   same-origin deployment serves both from one host, so no base URL is needed.
// - Hosted static build against a remote api-server: set VITE_API_BASE_URL to
//   that origin at build time. The api-server must allow this app's origin via
//   CORS_ALLOWED_ORIGINS.
// PUBLIC-BUILD BOUNDARY (review finding): an arbitrary VITE_API_BASE_URL would
// turn this public Review-Hub bundle into an unrestricted live API client. The
// base URL is therefore constrained to LOOPBACK — the documented local api-server
// demo — and anything else is ignored (the bundle stays same-origin/fixture).
const rawBase = import.meta.env.VITE_API_BASE_URL?.trim();
const apiBaseUrl = (() => {
  if (!rawBase) return undefined;
  try {
    const host = new URL(rawBase).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]"
      ? rawBase
      : undefined;
  } catch {
    return undefined;
  }
})();
if (apiBaseUrl) {
  setBaseUrl(apiBaseUrl);
}

createRoot(document.getElementById("root")!).render(<App />);
