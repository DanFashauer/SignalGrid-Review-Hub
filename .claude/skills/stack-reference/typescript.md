# TypeScript, Node, pnpm, regex, YAML/TOML/JSON

`packageManager: pnpm@10.28.1`, Node ≥ 22 (CI pins 22; this Mac runs 24.18, so syntax can
pass here and fail there). `tsconfig.base.json` is NOT `strict: true` — it enables
`noImplicitAny`, `strictNullChecks`, `useUnknownInCatchVariables`,
`noFallthroughCasesInSwitch` individually. Roughly 35 gates under `scripts/` are Node
`RegExp`, not PCRE. `scripts/review-invariants.mjs` check 1 requires a tightening `default:`
in every `PURE_LIBS` switch. Verified 2026-09-04.

## Packages

1. **SAYS** `npm install` / `npm i` / `npm ci`.
   **BREAKS** pnpm-only; CI runs `pnpm install --frozen-lockfile` and fails hard on lockfile
   drift; `.githooks/pre-push` enforces it locally in ~0.5 s.
   **DO** `pnpm install --frozen-lockfile`. If it refuses, the lockfile is stale: `pnpm
   install --lockfile-only`, commit `pnpm-lock.yaml`. Never bypass the hook.
2. **SAYS** `npm install <pkg>`, `--save-dev`, `-g`.
   **BREAKS** workspace packages are `@workspace/*`; every dep change needs the lockfile
   regenerated and committed; the darwin-binary build dance re-diverges it afterwards.
   **DO** `pnpm add <pkg> --filter @workspace/<pkg>` (root: `pnpm add -w`; dev: `-D`), then
   `pnpm install --lockfile-only`, commit. If you restored manifests after a local build,
   restore FIRST, regenerate SECOND.
3. **SAYS** `npm update` (all), `npm audit fix --force`.
   **BREAKS** pins are hand-curated in `pnpm-workspace.yaml` `overrides` (the platform-binary
   strips, `esbuild`, the esm-loader → tsx alias); a blanket update or a forced major bump
   silently undoes them.
   **DO** `pnpm audit` to REPORT; then a targeted `overrides` entry or `pnpm update
   <pkg>@<version> --filter …`; `pnpm install --lockfile-only`; commit; let
   `supply-chain.yml` confirm.
4. **SAYS** `npm build`, `npm tsc`, `npm install typescript --save-dev`.
   **BREAKS** `npm build` and `npm tsc` are not commands (npm 7 removed `npm build`), and
   `pnpm run build` (vite/rolldown) runs ONLY on linux-x64 / CI — the overrides strip the
   darwin bundler binaries on purpose.
   **DO** locally: `pnpm run typecheck`, `pnpm run review:invariants`, the `proof:*` scripts,
   `./validate-sim-macos.sh`, `node scripts/preflight.mjs`. Leave `build` to CI; do not "fix"
   a web-build failure on the Mac.
   Translation table: `npm install`/`npm ci` → `pnpm install --frozen-lockfile`; `npm run
   typecheck` → `pnpm run typecheck` (the `run` verb is the same for every script); `npx tsx
   file.ts` → `pnpm exec tsx file.ts` (`pnpm dlx` for a package not installed); `npm i -D
   <pkg>` → `pnpm add -D <pkg>`.

## Language

5. **SAYS** `import json from './package.json' assert { type: 'json' }`.
   **BREAKS** Node 22 removed the `assert` keyword for import attributes — on this Mac's Node
   24: `SyntaxError: Unexpected identifier 'assert'`.
   **DO** `with { type: 'json' }`, or the gate idiom: `const real: unknown =
   JSON.parse(readFileSync(p, "utf8"))` followed by validation.
6. **SAYS** `switch (color) { case "red": … default: console.log("Go"); }` — a permissive
   default.
   **BREAKS** fail-closed: an unknown value TIGHTENS. `review-invariants` check 1 requires
   the `default:` arm AND it must be the restrictive branch; an object-literal lookup with a
   missing key returns `undefined`, which is a loosening.
   **DO** `default: { const _exhaustive: never = outcome; return <deny|restrict>; }` — the
   `lib/signalgrid-core/src/policy.ts` idiom. Lookup tables: `Map`, `Object.create(null)`, or
   an `Object.hasOwn` check; a miss returns the tightest outcome.
7. **SAYS** `let notSure: any`, `function isString(value: any): value is string`, `(someValue
   as string).length`.
   **BREAKS** `noImplicitAny` is on and boundaries are `unknown`-then-validate ("PARSEABLE IS
   NOT VALID", `artifacts/api-server/src/routes/control-plane.ts`; `lib/api-zod`). An `as` on
   `unknown` is the fail-open.
   **DO** `(value: unknown): value is T` guards; zod `safeParse` for bodies; narrow with
   `instanceof` / `typeof`. The sheet's `catch (e: unknown) { if (e instanceof Error) … }` is
   the correct form and matches `useUnknownInCatchVariables`.
8. **SAYS** `arr.reduce((a, c) => a + c)` with no seed.
   **BREAKS** THROWS on an empty array: `Reduce of empty array with no initial value` — in a
   gate a throw is a crash, not a verdict.
   **DO** always seed: `reduce((a, c) => a + c, 0)`.
9. Resolve the repo root from the module, never from `process.cwd()`:
   `resolve(dirname(fileURLToPath(import.meta.url)), "..")` — a gate run from a worktree or
   a subdirectory otherwise reads the wrong tree.

## Regex — the gates are Node RegExp, not PCRE

10. **SAYS** possessive `a*+`, atomic `(?>…)`, `\A \Z \z \G`, `\K`, `\Q…\E`, `\h \R \X`, inline
    `(?i)…(?-i)` — presented as "regex".
    **BREAKS** Node: `/a*+/` → `Nothing to repeat`; `/(?>a)/`, `/(?i)abc/` → `Invalid group`
    (the gate dies at load). Worse, WITHOUT the `u` flag an unknown escape like `\h` silently
    matches the letter `h` — a gate that "passes".
    **DO** JS flags only (`d g i m s u v y`); `^`/`$` with `m` for line anchors, or scan per
    line; `(?:…)` non-capturing; `\p{…}` needs `u`. Compile EVERY gate regex with `u` so a
    stray PCRE escape throws at load instead of matching a letter.
11. **SAYS** substitution `\1`, `${foo}`, `\U`/`\L`/`\E` case transforms.
    **BREAKS** JS `String.replace` uses `$1`, `$<name>`, `$&`, `$$` and has no case transforms:
    `"ab".replace(/(a)/, "\\1x")` → `"\1xb"` (literal), `"${foo}x"` stays literal.
    **DO** `$1` / `$<name>`, or a replacer function `(m, g1) => …` for anything conditional.
    After ANY regex-driven rewrite of Swift, re-run `node scripts/check-ios-dynamic-type.mjs`.
12. Never call `.test()` on a `/g` regex: `lastIndex` carries between calls and a line
    scanner then misses every other hit — a silent fail-open. Drop `g` for tests; use
    `matchAll` for enumeration.
13. `re.exec(text)[0]` and `text.match(re).length` THROW when there is no match (`Cannot read
    properties of null`). Check for null first; in a gate, no match is a verdict, not a crash.
14. Match the SPELLING at the call site, not the type: `UIFont.systemFont` matched ZERO of the
    18 `.systemFont(ofSize:` sites in the Assist-gate view controllers — Swift's implicit-
    member form. Use `\bring` / `ring\b` word edges and `(?<!…)` lookbehind, and test the
    pattern against a real hit AND a real non-hit.

## YAML, TOML, JSON

15. In workflow YAML, a value starting with an indicator — `*` (alias), `&` (anchor), `!`
    (tag), `{`/`[` (flow), `#`, `|`, `>` — must be quoted; `cron: 17 7 * * *` is fine, a value
    beginning with `*` is not.
16. YAML 1.1 resolution turns bare `yes/no/on/off/Y/n` into booleans and `1.10` into the float
    `1.1`. xcodegen's parser (Yams) does this to `native/ios/project.yml` — quote version
    strings and any bare `on:`-like scalar.
17. `Cargo.toml`: `[[bin]]` / `[[test]]` are arrays of tables (the sheet's `[[comments]]`); a
    dependency with features is an inline table `{ version = "…", features = […] }`.
18. JSON objects are "unordered" per the sheet, but `JSON.stringify` emits INSERTION order
    (integer-like keys first) and `JSON.parse` preserves it — sort keys before writing any
    provenance artifact so two runs of the same input produce the same bytes.
