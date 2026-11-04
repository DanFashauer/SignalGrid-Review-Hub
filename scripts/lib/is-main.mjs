// Is this module the script node was started with? Shared by every gate that exports
// its machinery AND runs a CLI body, so it has to tell "run" from "imported".
//
// Compared by REAL path on both sides. `import.meta.url` is already the real path, but
// `process.argv[1]` is not resolved: `node <symlinked dir>/scripts/<gate>.mjs` used to
// import the module, match nothing and exit 0 having checked nothing (a fail-open).
// Fail-closed the other way: an undefined argv1, or anything that throws (a path that
// does not exist), is "not main", never "main".
//
//   if (isMainModule(process.argv[1], import.meta.url)) { ...CLI body... }
//
// `node scripts/check-entry-guards.mjs` refuses the raw spellings in a tracked script.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isMainModule(argv1, moduleUrl) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
