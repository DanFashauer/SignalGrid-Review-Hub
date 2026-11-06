#!/usr/bin/env node
/**
 * The `signalgrid` executable a pnpm install or link puts on PATH. The CLI ships as
 * TypeScript and is never built, so this launcher registers tsx's loader and imports
 * the source entry — the same thing `pnpm run start` does with the tsx CLI (review
 * round 12 on PR #1321: a bin pointing at src/bin.ts ran as a shell script).
 */
import { register } from "tsx/esm/api";

register();
await import("../src/bin.ts");
