/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Optional api-server origin for hosted / static builds
   * (e.g. `https://signalgrid-api.example.com`). Leave unset in local dev —
   * Vite proxies `/api` to the api-server (see vite.config.ts). When set, the
   * generated API client calls this origin directly; the api-server must list
   * the app origin in `CORS_ALLOWED_ORIGINS`.
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
