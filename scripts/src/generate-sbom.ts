/**
 * CycloneDX SBOM generator (dependency-free, deterministic).
 *
 * Produces a CycloneDX 1.5 software bill-of-materials for the whole workspace —
 * EVERY ecosystem, not just npm — and a licence entry per component:
 *
 *   - npm        from pnpm's resolved tree (`pnpm ls`), licence read from each
 *                resolved package's own package.json
 *   - cargo      parsed from the three committed Cargo.lock files
 *   - maven      parsed from the two committed build.gradle.kts files
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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

function loadRegistry(): LicenceRegistry {
  try {
    return JSON.parse(readFileSync(registryPath, "utf8")) as LicenceRegistry;
  } catch {
    return { entries: {} };
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
        // Primary source: the resolved package's own package.json. A platform
        // binary the workspace overrides strip is listed by `pnpm ls` but not
        // installed, so its manifest is unreadable here — the committed
        // registry is the deterministic fallback for exactly those.
        let licence: string | undefined;
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
        if (!licence) {
          const entry = registry.entries?.[purl];
          if (entry?.licence) {
            licence = entry.licence;
            component.properties = [
              { name: "signalgrid:licence-basis", value: entry.basis ?? "committed registry" },
            ];
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

function collectMaven(registry: LicenceRegistry): Map<string, Component> {
  const components = new Map<string, Component>();
  const coordRe =
    /(?:implementation|api|runtimeOnly)\((?:platform\()?"([^":]+):([^":]+)(?::([^"]+))?"\)?\)/g;
  for (const file of GRADLE_FILES) {
    const text = readFileSync(join(repoRoot, file), "utf8");
    for (const m of text.matchAll(coordRe)) {
      const [, group, artifact, version] = m;
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

  const all = new Map<string, Component>([
    ...collectNpm(registry),
    ...collectCargo(registry),
    ...collectMaven(registry),
  ]);

  const sorted = [...all.values()].sort((a, b) => a.purl.localeCompare(b.purl));
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
            "maven (2 committed build.gradle.kts files); swift (both " +
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
