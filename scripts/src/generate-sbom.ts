/**
 * CycloneDX SBOM generator (dependency-free, deterministic).
 *
 * Produces a CycloneDX 1.5 software bill-of-materials for the whole workspace by
 * reading pnpm's resolved dependency tree (`pnpm ls`). It adds no npm
 * dependencies (respecting the workspace supply-chain rules) and emits a
 * deterministic, sorted document with no embedded timestamp, so re-running it
 * yields byte-identical output unless the dependency set actually changes.
 *
 * Public-safe: it lists only package coordinates (name + version), never any
 * source, secret, or environment value.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface PnpmDep {
  version?: string;
  from?: string;
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
}

const outputPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../artifacts/sbom/cyclonedx.json",
);

function collect(
  deps: Record<string, PnpmDep> | undefined,
  into: Map<string, Component>,
): void {
  if (!deps) {
    return;
  }
  for (const [name, node] of Object.entries(deps)) {
    const version = node.version ?? "unknown";
    // Skip workspace-internal packages (they are the subjects, not components).
    if (version.startsWith("link:") || name.startsWith("@workspace/")) {
      collect(node.dependencies, into);
      collect(node.devDependencies, into);
      continue;
    }
    into.set(`${name}@${version}`, { name, version });
    collect(node.dependencies, into);
    collect(node.devDependencies, into);
  }
}

function bomRef(component: Component): string {
  return `pkg:npm/${component.name.replace("@", "%40")}@${component.version}`;
}

function main(): void {
  let raw: string;
  try {
    raw = execFileSync(
      "pnpm",
      ["ls", "-r", "--depth", "Infinity", "--json"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (err) {
    console.error("Failed to run `pnpm ls`:", err);
    process.exit(1);
    return;
  }

  const projects = JSON.parse(raw) as PnpmProject[];
  const components = new Map<string, Component>();
  for (const project of projects) {
    collect(project.dependencies, components);
    collect(project.devDependencies, components);
  }

  const sorted = [...components.values()].sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
  );

  const bom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      // No timestamp: keep the document deterministic and reviewable in git.
      tools: [
        { vendor: "SignalGrid", name: "signalgrid-sbom", version: "1.0.0" },
      ],
      component: {
        type: "application",
        name: "signalgrid-review-hub",
        version: "0.0.0",
      },
    },
    components: sorted.map((component) => ({
      type: "library",
      name: component.name,
      version: component.version,
      "bom-ref": bomRef(component),
      purl: bomRef(component),
    })),
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(bom, null, 2)}\n`, "utf8");
  console.log(
    `Wrote CycloneDX SBOM with ${sorted.length} components to ${outputPath}`,
  );
}

main();
