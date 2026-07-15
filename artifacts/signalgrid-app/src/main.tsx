import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

// Point the generated API client at the SignalGrid api-server.
//
// - Local dev / same-origin: leave VITE_API_BASE_URL unset. Requests stay
//   relative (`/api/*`); Vite proxies them to the api-server in dev
//   (see vite.config.ts), and a same-origin deployment serves both from one
//   host, so no base URL is needed.
// - Hosted static build against a remote api-server: set VITE_API_BASE_URL to
//   that origin at build time. The api-server must allow this app's origin via
//   CORS_ALLOWED_ORIGINS.
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
if (apiBaseUrl) {
  setBaseUrl(apiBaseUrl);
}

createRoot(document.getElementById("root")!).render(<App />);
