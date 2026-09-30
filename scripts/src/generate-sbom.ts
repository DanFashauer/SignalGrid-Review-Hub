/**
 * CycloneDX SBOM generator (dependency-free, deterministic).
 *
 * Produces a CycloneDX 1.5 software bill-of-materials for the whole workspace —
 * EVERY ecosystem, not just npm — and a licence entry per component:
 *
 *   - npm        from pnpm's resolved tree (`pnpm ls`), licence read from each
 *                resolved package's own package.json
 *   - cargo      parsed from the three committed Cargo.lock files
 *   - maven      parsed from the two committed build.gradle.kts files — direct
 *                declarations only (dependencies + plugins {} markers), every
 *                statement accounted for or the run fails
 *   - swift      both Package.swift surfaces are READ and currently declare
 *                zero external packages (local targets only) — recorded as a
 *                metadata property so absence is a stated fact, not a gap
 *
 * The non-npm lockfiles are parsed directly rather than invoking
 * cargo/swift/gradle, so the generator runs on every lane including CI with no
 * extra toolchain — the same reason docs/LAUNCH_PROFILE.md:116-120 records for
 * widening the launch-profile derivation to read `native/*` and `firmware/*`.
 *
 * Licence sources, in precedence order: the resolved package's own
 * package.json (npm), then the committed registry
 * scripts/data/third-party-licences.json (cargo/maven always — their lockfiles
 * carry no licence metadata — and npm platform binaries that are not installed
 * on the generating machine). A component neither source can resolve is
 * emitted WITHOUT a licence entry and scripts/check-licence-policy.mjs routes
 * it to REVIEW: a named unknown, never a silent omission. No network at
 * generation time.
 *
 * It adds no npm dependencies (respecting the workspace supply-chain rules)
 * and emits a deterministic, sorted document with no embedded timestamp, so
 * re-running it yields byte-identical output unless the dependency set — or a
 * recorded licence — actually changes.
 *
 * Public-safe: it lists only package coordinates and licence identifiers,
 * never any source, secret, or environment value.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface PnpmDep {
  version?: string;
  from?: string;
  path?: string;
  dependencies?: Record<string, PnpmDep>;
  devDependencies?: Record<string, PnpmDep>;
}

interface PnpmProject {
  name?: string;
  version?: string;
  dependencies?: Record<string, PnpmDep>;
  devDependencies?: Record<string, PnpmDep>;
}

interface Component {
  name: string;
  version: string;
  purl: string;
  licence?: string;
  properties?: { name: string; value: string }[];
}

interface LicenceRegistry {
  recordedOn?: string;
  entries?: Record<
    string,
    { licence?: string | null; basis?: string; resolvedVersionByBom?: string }
  >;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputPath = join(repoRoot, "artifacts/sbom/cyclonedx.json");
const registryPath = join(repoRoot, "scripts/data/third-party-licences.json");

const CARGO_LOCKS = [
  "native/desktop/app/Cargo.lock",
  "native/desktop/core/Cargo.lock",
  "firmware/dock/core/Cargo.lock",
];
const GRADLE_FILES = [
  "native/android/app/build.gradle.kts",
  "native/android/core/build.gradle.kts",
];
const SWIFT_MANIFESTS = [
  "native/ios/Package.swift",
  "native/ios/SignalGridMobile/SignalGridMobileCore/Package.swift",
];

/**
 * ABSENT AND CORRUPT ARE DIFFERENT ANSWERS. This used to be one `try/catch` returning
 * `{ entries: {} }`, so an unreadable or malformed `scripts/data/third-party-licences.json`
 * was indistinguishable from an empty one — and cargo and maven carry no licence metadata
 * in their lockfiles at all, so EVERY component from those two ecosystems would emit
 * unresolved while the generator printed its normal success line. The damage was bounded
 * (`check-licence-policy.mjs` routes unresolved components to REVIEW, so the SBOM never
 * silently claimed compliance) but the failure presented as a policy backlog rather than
 * as a corrupt file. A missing registry is a legitimate genesis state; a present one that
 * does not parse is a measurement failure and exits 1, the way a failing `pnpm ls` already
 * does below.
 */
function loadRegistry(): LicenceRegistry {
  if (!existsSync(registryPath)) return { entries: {} };
  const raw = readFileSync(registryPath, "utf8");
  try {
    return JSON.parse(raw) as LicenceRegistry;
  } catch (err) {
    console.error(
      `generate-sbom: ${registryPath} exists but does not parse — refusing to emit an SBOM whose ` +
      `unresolved licences would look like a policy backlog instead of a corrupt file.\n` +
      `  ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}

/**
 * Normalise a licence string into CycloneDX shape: an SPDX expression
 * (contains an operator or parentheses) becomes `expression`; a single
 * identifier becomes `license: { id }`.
 */
function licenceEntry(licence: string): object {
  const isExpression = /\s(AND|OR|WITH)\s|\(/.test(licence);
  return isExpression
    ? { expression: licence }
    : { license: { id: licence } };
}

function npmPurl(name: string, version: string): string {
  // Encode every "@" in the package name (scoped names begin with "@").
  return `pkg:npm/${name.replaceAll("@", "%40")}@${version}`;
}

/** Legacy `licenses` (array or object) → a single normalised string. */
function legacyLicence(licenses: unknown): string | undefined {
  if (Array.isArray(licenses)) {
    const types = licenses
      .map((l) => (typeof l === "string" ? l : (l as { type?: string })?.type))
      .filter((t): t is string => typeof t === "string" && t.length > 0);
    if (types.length === 1) return types[0];
    if (types.length > 1) return types.join(" OR ");
    return undefined;
  }
  if (licenses && typeof licenses === "object") {
    const t = (licenses as { type?: string }).type;
    return typeof t === "string" && t.length > 0 ? t : undefined;
  }
  return undefined;
}

function collectNpm(registry: LicenceRegistry): Map<string, Component> {
  let raw: string;
  try {
    raw = execFileSync("pnpm", ["ls", "-r", "--depth", "Infinity", "--json"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    console.error("Failed to run `pnpm ls`:", err);
    // Known state, diagnosed by the Mac lane 2026-08-21: after a harness has
    // installed foreign-platform binaries into node_modules and then restored
    // the manifests, `pnpm ls` crashes with "Cannot read properties of
    // undefined (reading 'resolution')" — the store no longer matches the
    // lockfile it is being read against. That is a corrupted WORKING STATE,
    // not a platform property, and the recovery is one command. Refusing with
    // the recovery named beats an opaque stack for whoever hits it next.
    console.error(
      "\nIf the error mentions 'resolution': node_modules has drifted from the " +
        "lockfile (typically after a platform-binary install/restore dance). " +
        "Run `pnpm install --frozen-lockfile` and re-run this generator.",
    );
    process.exit(1);
  }

  const projects = JSON.parse(raw) as PnpmProject[];
  const components = new Map<string, Component>();

  const walk = (deps: Record<string, PnpmDep> | undefined): void => {
    if (!deps) return;
    for (const [name, node] of Object.entries(deps)) {
      const version = node.version ?? "unknown";
      // Skip workspace-internal packages (they are the subjects, not components).
      if (version.startsWith("link:") || name.startsWith("@workspace/")) {
        walk(node.dependencies);
        walk(node.devDependencies);
        continue;
      }
      const purl = npmPurl(name, version);
      if (!components.has(purl)) {
        const component: Component = { name, version, purl };
        // Precedence: a committed registry entry wins UNCONDITIONALLY — its
        // basis included — and only purls the registry does not carry read
        // their installed manifest. It used to be the other way around, and
        // the licence-basis property then encoded WHICH MACHINE generated the
        // file: a platform binary is installed on one OS and absent on the
        // other, so the same purl got the property on one platform and not
        // the other (5 linux-x64 components one way, 2 fsevents the mirror
        // way — the Mac lane measured all 7), and the byte-for-byte sync gate
        // could never pass on both. The registry entry is also the more
        // auditable source: its basis says where the fact came from and when.
        let licence: string | undefined;
        const registryEntry = registry.entries?.[purl];
        if (registryEntry?.licence) {
          component.licence = registryEntry.licence;
          component.properties = [
            {
              name: "signalgrid:licence-basis",
              value: registryEntry.basis ?? "committed registry",
            },
          ];
          components.set(purl, component);
          walk(node.dependencies);
          walk(node.devDependencies);
          continue;
        }
        if (node.path) {
          try {
            const meta = JSON.parse(
              readFileSync(join(node.path, "package.json"), "utf8"),
            ) as { license?: unknown; licenses?: unknown };
            if (typeof meta.license === "string" && meta.license.length > 0) {
              licence = meta.license;
            } else if (
              meta.license &&
              typeof meta.license === "object" &&
              typeof (meta.license as { type?: string }).type === "string"
            ) {
              licence = (meta.license as { type: string }).type;
            } else {
              licence = legacyLicence(meta.licenses);
            }
          } catch {
            // Not installed on this machine — fall through to the registry.
          }
        }
        component.licence = licence;
        components.set(purl, component);
      }
      walk(node.dependencies);
      walk(node.devDependencies);
    }
  };

  for (const project of projects) {
    walk(project.dependencies);
    walk(project.devDependencies);
  }
  return components;
}

function collectCargo(registry: LicenceRegistry): Map<string, Component> {
  const components = new Map<string, Component>();
  for (const lock of CARGO_LOCKS) {
    const text = readFileSync(join(repoRoot, lock), "utf8");
    for (const block of text.split("[[package]]").slice(1)) {
      const name = /name = "([^"]+)"/.exec(block)?.[1];
      const version = /version = "([^"]+)"/.exec(block)?.[1];
      if (!name || !version) continue;
      // A package with no `source` line is a workspace-local crate — a
      // subject, not a component (same rule as @workspace/ above).
      if (!/source = "/.test(block)) continue;
      const purl = `pkg:cargo/${name}@${version}`;
      if (components.has(purl)) continue;
      const component: Component = { name, version, purl };
      const entry = registry.entries?.[purl];
      if (entry?.licence) {
        component.licence = entry.licence;
        component.properties = [
          { name: "signalgrid:licence-basis", value: entry.basis ?? "committed registry" },
        ];
      }
      components.set(purl, component);
    }
  }
  return components;
}

/**
 * A Gradle build file, read as the set of DIRECT declarations it makes. Every
 * non-blank statement inside every `plugins {}` and `dependencies {}` block must
 * match one of the forms below, or the whole generation fails: the collector used
 * to be one regex over `implementation|api|runtimeOnly` calls, so a `plugins {}`
 * entry, a `kotlin("test")` shorthand, a `compileOnly`/`ksp`/`classpath` line or a
 * version-catalog reference was silently absent from the SBOM while it passed its
 * own staleness gate byte-for-byte (plan row 146). A form this parser does not
 * know is now a named failure, never a smaller bill of materials.
 *
 * Transitives are NOT resolved — no Gradle lockfile is committed — and the
 * ecosystems-covered property says so.
 */
interface GradleDecl {
  group: string;
  artifact: string;
  version?: string;
  pluginId?: string;
}

// Anchored: the configuration name is the WHOLE identifier, optionally prefixed by a
// source set / variant (`test`, `androidTest`, `debug`, …) — never a substring match.
const GRADLE_CONFIG =
  "(?:[a-z][A-Za-z0-9]*?)?(?:[Ii]mplementation|[Aa]pi|[Cc]ompileOnly|[Rr]untimeOnly|" +
  "[Kk]sp|[Kk]apt|[Aa]nnotationProcessor|classpath|coreLibraryDesugaring|lintChecks)";
// group:artifact[:version] with no interpolation (`$v`, `${v}`), no `@ext` and no
// fourth `:classifier` segment: each of those would otherwise land in a purl verbatim,
// so they are left unmatched and the statement fails as unparsed.
const GRADLE_COORD = '([^":@$\\s]+):([^":@$\\s]+)(?::([^":@$\\s]+))?';
const GRADLE_FORMS = {
  // `config("g:a[:v]")` and `config(platform("g:a:v"))`.
  quoted: new RegExp(`^${GRADLE_CONFIG}\\(()"${GRADLE_COORD}"\\)$`),
  platform: new RegExp(`^${GRADLE_CONFIG}\\((platform)\\("${GRADLE_COORD}"\\)\\)$`),
  kotlinDep: new RegExp(`^${GRADLE_CONFIG}\\(kotlin\\("([\\w.-]+)"(?:\\s*,\\s*"([^"\\s]+)")?\\)\\)$`),
  pluginId: /^id\("([\w.-]+)"\)\s+version\s+"([^"\s]+)"$/,
  pluginKotlin: /^kotlin\("([\w.-]+)"\)\s+version\s+"([^"\s]+)"$/,
};

function stripGradleComments(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

const GRADLE_UNREAD_SHAPES: [RegExp, string][] = [
  [/[\w)\]]\s*\.\s*(?:dependencies|plugins)\s*\{/, "a qualified dependencies/plugins block (e.g. commonMain.dependencies {})"],
  [/\bapply\s*(?:\(\s*plugin\b|\s+plugin\b|\s*\(\s*from\b)/, "a plugin applied outside plugins {}"],
  [/\bdependencies\s*\.\s*\w+\s*\(/, "a dependency added through the dependencies API"],
  [/\bresolutionStrategy\b|\.force\s*\(|\bdependencySubstitution\b|\bconstraints\s*\{|\buseModule\s*\(|\buseVersion\s*\(/, "a resolution rule that changes what resolves"],
  [/\bbuildscript\s*\{/, "a buildscript {} block"],
];

/** The bodies of every `<name> {` block, brace-matched, comments stripped. */
function gradleBlocks(text: string, name: string): { body: string; line: number }[] {
  const clean = stripGradleComments(text);
  const out: { body: string; line: number }[] = [];
  const opener = new RegExp(`(^|[^\\w.])${name}\\s*\\{`, "g");
  for (const m of clean.matchAll(opener)) {
    const open = (m.index ?? 0) + m[0].length;
    let depth = 1;
    let i = open;
    for (; i < clean.length && depth > 0; i++) {
      if (clean[i] === "{") depth++;
      else if (clean[i] === "}") depth--;
    }
    if (depth !== 0) throw new Error(`unbalanced \`${name} {\` block`);
    out.push({ body: clean.slice(open, i - 1), line: clean.slice(0, open).split("\n").length });
  }
  return out;
}

/** Every line of `text` carrying a dependency-bearing shape no collector reads. */
function unreadGradleShapes(text: string): string[] {
  const found: string[] = [];
  stripGradleComments(text).split("\n").forEach((l, k) => {
    for (const [re, what] of GRADLE_UNREAD_SHAPES) {
      if (re.test(l)) found.push(`line ${k + 1}: ${what}: ${l.trim()}`);
    }
  });
  return found;
}

/**
 * A settings file is not parsed for components, so it may carry NO dependency-bearing
 * shape at all: no plugins/dependencies/versionCatalogs/buildscript block, and none of
 * GRADLE_UNREAD_SHAPES (a `pluginManagement { resolutionStrategy { eachPlugin {
 * useModule(...) } } }` swaps what a plugin id resolves to; `apply(from = ...)` pulls in
 * a script nobody reads). Only repository and include declarations remain.
 */
function settingsFileProblems(text: string): string[] {
  const blocks = ["plugins", "dependencies", "versionCatalogs", "buildscript"].filter(
    (b) => gradleBlocks(text, b).length > 0,
  );
  return [
    ...blocks.map((b) => `declares ${b} {}`),
    ...unreadGradleShapes(text),
  ];
}

export function parseGradleDeclarations(text: string): { decls: GradleDecl[]; unparsed: string[] } {
  const decls: GradleDecl[] = [];
  const unparsed: string[] = [];
  // Dependency-bearing shapes OUTSIDE the two block names read below. Only blocks literally
  // named `plugins`/`dependencies` are parsed, so each of these would contribute zero
  // declarations AND zero unparsed statements — a silent pass. Anywhere in the file, they fail.
  unparsed.push(...unreadGradleShapes(text));
  const kotlinDeps: { name: string; version?: string; at: string }[] = [];
  const pluginVersions = new Set<string>();
  const statements = (name: string) =>
    gradleBlocks(text, name).flatMap(({ body, line }) =>
      body.split("\n").map((s, k) => ({ s: s.trim(), at: `line ${line + k}` })).filter((x) => x.s !== ""),
    );
  for (const { s, at } of statements("plugins")) {
    let m = GRADLE_FORMS.pluginId.exec(s);
    const id = m ? m[1] : (m = GRADLE_FORMS.pluginKotlin.exec(s)) ? `org.jetbrains.kotlin.${m[1]}` : null;
    if (!m || !id) {
      unparsed.push(`${at}: plugins { ${s} }`);
      continue;
    }
    if (id.startsWith("org.jetbrains.kotlin.")) pluginVersions.add(m[2]);
    decls.push({ group: id, artifact: `${id}.gradle.plugin`, version: m[2], pluginId: id });
  }
  for (const { s, at } of statements("dependencies")) {
    const q = GRADLE_FORMS.quoted.exec(s) ?? GRADLE_FORMS.platform.exec(s);
    if (q) {
      decls.push({ group: q[2], artifact: q[3], version: q[4] });
      continue;
    }
    const k = GRADLE_FORMS.kotlinDep.exec(s);
    if (k) {
      kotlinDeps.push({ name: k[1], version: k[2], at });
      continue;
    }
    unparsed.push(`${at}: dependencies { ${s} }`);
  }
  // `kotlin("x")` with no version is aligned by the Kotlin Gradle plugin to ITS version,
  // so the version is read from this file's Kotlin plugin — and an ambiguous or absent
  // one is a failure, never a versionless guess.
  for (const d of kotlinDeps) {
    const version = d.version ?? (pluginVersions.size === 1 ? [...pluginVersions][0] : undefined);
    if (!version) {
      unparsed.push(`${d.at}: kotlin("${d.name}") has no version and the file declares ${pluginVersions.size} Kotlin plugin versions`);
      continue;
    }
    decls.push({ group: "org.jetbrains.kotlin", artifact: `kotlin-${d.name}`, version });
  }
  return { decls, unparsed };
}

/**
 * Every tracked Gradle/Maven build surface must be one this generator reads. A new
 * build file, a Groovy `.gradle`, a `pom.xml` or a version catalog would otherwise
 * be a whole module missing from the SBOM with nothing to say so.
 */
function assertGradleFullyParsed(): void {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
    .split("\0")
    .filter((f) => /(^|\/)(pom\.xml|[^/]*\.versions\.toml|[^/]*\.gradle(\.kts)?|gradle\.lockfile)$/.test(f));
  const problems: string[] = [];
  for (const f of tracked) {
    if (GRADLE_FILES.includes(f)) continue;
    if (/(^|\/)settings\.gradle\.kts$/.test(f)) {
      for (const p of settingsFileProblems(readFileSync(join(repoRoot, f), "utf8"))) {
        problems.push(`${f}: ${p} — not read by the SBOM generator`);
      }
      continue;
    }
    problems.push(`${f}: a Gradle/Maven build surface the SBOM generator does not read`);
  }
  for (const f of GRADLE_FILES) {
    for (const u of parseGradleDeclarations(readFileSync(join(repoRoot, f), "utf8")).unparsed) {
      problems.push(`${f} ${u}`);
    }
  }
  if (problems.length > 0) {
    console.error(
      "generate-sbom: the maven collector cannot account for every Gradle declaration — " +
        "refusing to emit a silently incomplete SBOM. Teach parseGradleDeclarations in " +
        "scripts/src/generate-sbom.ts the form, or list the file in GRADLE_FILES:\n" +
        problems.map((p) => `  ${p}`).join("\n"),
    );
    process.exit(1);
  }
}

/**
 * Runs on EVERY generation, before anything is collected: the parser must still
 * collect each declared form this repo uses and must still refuse the forms it
 * does not know. A regression back to the one-regex collector fails here.
 */
function selfTestGradleParser(): void {
  const fixture = [
    "plugins {",
    '    id("com.android.application") version "8.7.3"',
    '    kotlin("android") version "2.1.0" // trailing comment',
    "}",
    "dependencies {",
    '    implementation("a.b:c:1.0")',
    '    implementation(platform("a.b:bom:2"))',
    '    implementation("a.b:managed")',
    '    compileOnly("d.e:f:3")',
    '    androidTestImplementation("g.h:i:4")',
    "    testImplementation(kotlin(\"test\"))",
    "}",
  ].join("\n");
  const got = parseGradleDeclarations(fixture);
  const coords = got.decls.map((d) => `${d.group}:${d.artifact}${d.version ? `:${d.version}` : ""}`).sort();
  const want = [
    "a.b:bom:2",
    "a.b:c:1.0",
    "a.b:managed",
    "com.android.application:com.android.application.gradle.plugin:8.7.3",
    "d.e:f:3",
    "g.h:i:4",
    "org.jetbrains.kotlin.android:org.jetbrains.kotlin.android.gradle.plugin:2.1.0",
    "org.jetbrains.kotlin:kotlin-test:2.1.0",
  ];
  const refuse = [
    "dependencies {\n    implementation(libs.androidx.core)\n}",
    'dependencies {\n    implementation(project(":x"))\n}',
    'dependencies {\n    fooImplementationBar("a:b:1")\n}',
    'dependencies {\n    implementation(platform("a:b:1")\n}',
    'plugins {\n    id("x.y")\n}',
    "dependencies {\n    testImplementation(kotlin(\"test\"))\n}",
    'kotlin {\n    sourceSets {\n        commonMain.dependencies {\n            implementation("a:b:1")\n        }\n    }\n}',
    'apply(plugin = "x.y")',
    'dependencies.add("implementation", "a:b:1")',
    'configurations.all {\n    resolutionStrategy.force("a:b:2")\n}',
    'dependencies {\n    implementation("a:b:$v")\n}',
    'dependencies {\n    implementation("a:b:${v}")\n}',
    'dependencies {\n    implementation("a:b:1@aar")\n}',
    'dependencies {\n    implementation("a:b:1:sources")\n}',
  ];
  const failures: string[] = [];
  if (got.unparsed.length > 0) failures.push(`fixture left unparsed: ${got.unparsed.join("; ")}`);
  if (JSON.stringify(coords) !== JSON.stringify(want)) failures.push(`fixture collected ${JSON.stringify(coords)}`);
  for (const r of refuse) {
    if (parseGradleDeclarations(r).unparsed.length === 0) failures.push(`accepted an unknown form: ${JSON.stringify(r)}`);
  }
  // Settings files: the repo's own shape must pass, and each planted shape must not.
  const settingsOk = 'pluginManagement {\n    repositories {\n        mavenCentral()\n        gradlePluginPortal()\n    }\n}\nrootProject.name = "x"\nincludeBuild("../core")';
  if (settingsFileProblems(settingsOk).length > 0) failures.push("a repositories-only settings file was refused");
  for (const planted of [
    settingsOk + '\npluginManagement {\n    resolutionStrategy {\n        eachPlugin {\n            useModule("com.evil:plugin:6.6.6")\n        }\n    }\n}',
    settingsOk + '\napply(from = "extra.gradle.kts")',
    settingsOk + '\nplugins {\n    id("x.y") version "1"\n}',
  ]) {
    if (settingsFileProblems(planted).length === 0) failures.push(`accepted a settings shape: ${JSON.stringify(planted.slice(settingsOk.length))}`);
  }
  if (failures.length > 0) {
    console.error(`generate-sbom: Gradle parser self-test FAILED\n${failures.map((f) => `  ${f}`).join("\n")}`);
    process.exit(1);
  }
}

function collectMaven(registry: LicenceRegistry): Map<string, Component> {
  const components = new Map<string, Component>();
  for (const file of GRADLE_FILES) {
    const text = readFileSync(join(repoRoot, file), "utf8");
    for (const { group, artifact, version, pluginId } of parseGradleDeclarations(text).decls) {
      // Workspace-internal coordinates are subjects, not components.
      if (group.startsWith("com.signalgrid")) continue;
      const purl = version
        ? `pkg:maven/${group}/${artifact}@${version}`
        : `pkg:maven/${group}/${artifact}`;
      if (components.has(purl)) continue;
      const component: Component = {
        name: `${group}:${artifact}`,
        version: version ?? "bom-managed",
        purl,
      };
      const entry = registry.entries?.[purl];
      const properties: { name: string; value: string }[] = [];
      if (pluginId) {
        properties.push({ name: "signalgrid:gradle-plugin-id", value: pluginId });
      }
      if (entry?.licence) {
        component.licence = entry.licence;
        properties.push({
          name: "signalgrid:licence-basis",
          value: entry.basis ?? "committed registry",
        });
      }
      if (entry?.resolvedVersionByBom) {
        properties.push({
          name: "signalgrid:version-managed-by",
          value: entry.resolvedVersionByBom,
        });
      }
      if (properties.length > 0) component.properties = properties;
      components.set(purl, component);
    }
  }
  return components;
}

/**
 * The Swift manifests currently declare zero external packages (local targets
 * only). Fail closed if that ever changes without this generator being taught
 * to parse the new dependency — an unlisted ecosystem must never silently
 * shrink the bill of materials.
 */
function assertSwiftHasNoExternalPackages(): void {
  for (const manifest of SWIFT_MANIFESTS) {
    const text = readFileSync(join(repoRoot, manifest), "utf8");
    if (/\.package\s*\(\s*url\s*:/.test(text)) {
      console.error(
        `${manifest} now declares an external Swift package, but the SBOM generator ` +
          "does not parse Swift dependencies yet. Extend collect* in " +
          "scripts/src/generate-sbom.ts before regenerating, or the SBOM will be " +
          "silently incomplete.",
      );
      process.exit(1);
    }
  }
}

function main(): void {
  const registry = loadRegistry();
  assertSwiftHasNoExternalPackages();
  selfTestGradleParser();
  assertGradleFullyParsed();

  const all = new Map<string, Component>([
    ...collectNpm(registry),
    ...collectCargo(registry),
    ...collectMaven(registry),
  ]);

  const sorted = [...all.values()].sort((a, b) => (a.purl < b.purl ? -1 : a.purl > b.purl ? 1 : 0));
  const unresolved = sorted.filter((c) => !c.licence);

  const bom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      // No timestamp: keep the document deterministic and reviewable in git.
      tools: [
        { vendor: "SignalGrid", name: "signalgrid-sbom", version: "2.0.0" },
      ],
      component: {
        type: "application",
        name: "signalgrid-review-hub",
        version: "0.0.0",
      },
      properties: [
        {
          name: "signalgrid:ecosystems-covered",
          value:
            "npm (pnpm resolved tree); cargo (3 committed Cargo.lock files); " +
            "maven (2 committed build.gradle.kts files — DIRECT declarations only, " +
            "dependencies and plugins {} markers; transitives not resolved, no Gradle " +
            "lockfile is committed); swift (both " +
            "Package.swift surfaces read — zero external packages declared)",
        },
        {
          name: "signalgrid:licence-sources",
          value:
            "resolved package.json (npm), then scripts/data/third-party-licences.json " +
            "(recorded from public registries with per-entry provenance); a component " +
            "neither resolves carries no licence entry and is routed to REVIEW by " +
            "scripts/check-licence-policy.mjs",
        },
      ],
    },
    components: sorted.map((component) => ({
      type: "library",
      name: component.name,
      version: component.version,
      "bom-ref": component.purl,
      purl: component.purl,
      ...(component.licence
        ? { licenses: [licenceEntry(component.licence)] }
        : {}),
      ...(component.properties ? { properties: component.properties } : {}),
    })),
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(bom, null, 2)}\n`, "utf8");
  console.log(
    `Wrote CycloneDX SBOM with ${sorted.length} components ` +
      `(${unresolved.length} with unresolved licence) to ${outputPath}`,
  );
  for (const c of unresolved) {
    console.log(`  licence unresolved: ${c.purl}`);
  }
}

main();
