// Self-hosted fonts. These were three remote <link> tags to Google's font CDN plus a
// matching @import in index.css, which handed every visitor's IP to that third party
// on a surface Dockerfile.web:58 actually SHIPS at /app/. review-invariants forbids
// exactly this and could not see it: the gate scanned artifacts/signalgrid-web/ only,
// so its "no third-party vendor host in any published web artifact" ran green over six
// offending files. Same faces, same weights, served from our own origin.
//
// The hostnames are deliberately NOT written out here. That gate matches the literal
// string and does not parse comments — which is the correct fail-closed behaviour for
// a security check, and it caught this very comment on the first run after the scope
// was widened.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
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
