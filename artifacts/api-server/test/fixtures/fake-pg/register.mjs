// Preload for ONE short-lived api-server in test/api.test.mjs: `node --import
// <this file> dist/index.mjs`. `pg` is EXTERNAL in the esbuild bundle
// (build.mjs), so a resolve hook can answer the bundle's `import("pg")` with
// fake-pg.mjs — the real PostgresAuditBackend, the real route and the real
// verifier then run against a seeded table, with no database in the loop.
// Test-only: nothing under src/ knows this file exists.
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
