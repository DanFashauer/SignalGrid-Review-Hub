import { createRoot } from "react-dom/client";
import App from "./App";
// Self-hosted brand fonts (bundled by Vite) — no third-party font CDN call, so a
// visitor never hands their IP/metadata to a vendor. Matches the families in
// index.css (Inter, IBM Plex Mono).
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
