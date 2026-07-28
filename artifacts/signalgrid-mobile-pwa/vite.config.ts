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

// Where the app's `/api/*` calls are proxied in local dev + `vite preview`.
// LOOPBACK-ONLY (review finding): an arbitrary API_PROXY_TARGET would forward all
// generated /api/* traffic to a live service, preserving an unrestricted live-API
// path in the public Review Hub even with the browser-side base-URL check. The
// proxy exists for the LOCAL api-server; any non-loopback target is refused.
const rawProxyTarget = process.env.API_PROXY_TARGET ?? "http://localhost:8080";
const proxyHost = (() => { try { return new URL(rawProxyTarget).hostname.toLowerCase(); } catch { return ""; } })();
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(proxyHost)) {
  throw new Error(`API_PROXY_TARGET must be loopback (got "${rawProxyTarget}") — the public Review Hub proxies only a locally running api-server.`);
}
const apiProxyTarget = rawProxyTarget;
const apiProxy = {
  "/api": { target: apiProxyTarget, changeOrigin: true },
};

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
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
        // Split heavy, stable vendor code into cacheable chunks so the app
        // shell is small and a code change does not bust the vendor cache.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) return "react-vendor";
          if (id.includes("recharts") || id.includes("/d3-") || id.includes("/victory-")) return "charts";
          if (id.includes("@radix-ui")) return "radix";
          if (id.includes("framer-motion")) return "motion";
          if (id.includes("@tanstack")) return "query";
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: apiProxy,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: apiProxy,
  },
});
