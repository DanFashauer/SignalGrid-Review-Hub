// Fonts are self-hosted (@fontsource), the same seven faces signalgrid-app bundles,
// so a page load hands no visitor's IP to a third-party font host. The hostnames
// are deliberately not written out: review-invariants matches the literal string.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
