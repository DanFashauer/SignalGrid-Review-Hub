import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 5173;

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";

// Social-preview images must be ABSOLUTE URLs. Vite rewrites `src`/`href` in
// index.html to respect `base`, but it does not touch the `content` attribute of
// a <meta> tag — so a root-relative og:image survives the build unchanged and
// then resolves against the wrong origin wherever the site is not served from a
// domain apex. LinkedIn and Slack simply drop the card's image when that fetch
// 404s, which is the whole value of the link preview for outreach.
//
// SITE_URL is the ORIGIN ONLY (scheme + host, no path). Vite already rewrites the
// og:image path to respect `base`, so prepending an origin+base here would repeat
// the base segment — verified: it produced ".../SignalGrid-Review-Hub/SignalGrid-Review-Hub/".
// Trailing slashes are trimmed so the join cannot produce a double slash.
const siteOrigin = (process.env.SITE_URL ?? "https://signalgrid.app").replace(/\/+$/, "");

/**
 * Rewrite root-relative social-preview URLs to absolute ones at build time.
 *
 * Runs with `order: "post"` so Vite's own base-path rewriting has already turned
 * "/opengraph.jpg" into "<base>/opengraph.jpg"; this step only prepends the
 * origin. The leading-slash requirement in the pattern makes it idempotent — an
 * already-absolute "https://…" URL cannot match, so a re-run cannot double-prefix.
 */
function absoluteSocialUrls() {
  return {
    name: "absolute-social-urls",
    transformIndexHtml: {
      order: "post" as const,
      handler(html: string) {
        return html.replace(
          /(<meta\s+(?:property|name)="(?:og:image|twitter:image)"\s+content=")\/([^"]*)(")/g,
          `$1${siteOrigin}/$2$3`,
        );
      },
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    absoluteSocialUrls(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Split stable vendor code into long-term-cacheable chunks so an app
        // change does not bust React / animation library caches, and the
        // initial payload is not one monolithic bundle.
        //
        // FUNCTION form, not the object form. Vite 8 replaces Rollup with
        // Rolldown, which supports only the function — an object fails the build
        // outright with "TypeError: manualChunks is not a function". The function
        // works under both bundlers, so this is not a migration so much as a
        // correction: the other four artifacts in this repo already write it this
        // way, and signalgrid-web was the odd one out.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) return "react-vendor";
          if (id.includes("framer-motion")) return "motion";
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
