// Which container engine are we actually talking to?
//
//   import { resolveContainerEngine } from "./lib/container-engine.mjs";
//   const engine = resolveContainerEngine();
//
// WHY THIS EXISTS. Every container-touching script in this repo spelled the engine
// as the literal string "docker". That is not a preference, it is a hard dependency
// on one specific implementation of an open standard, and it cost us reach: Docker
// needs a running daemon, and there are real environments — this repo's own cloud
// sandbox among them — where `docker` is installed but `dockerd` is not running, so
// every container lane is simply unavailable. Podman is daemonless and runs the same
// OCI images from the same Dockerfiles.
//
// WHAT WAS ACTUALLY VERIFIED, and what was not:
//
//   VERIFIED (podman 4.9.3, linux/amd64, in this repo's cloud sandbox):
//     · `podman build --platform linux/amd64 -f Dockerfile.api .` completes BOTH
//       stages and commits an image. No Dockerfile change was needed — they are
//       ordinary OCI Dockerfiles.
//     · That image runs and serves `/api/healthz` → 200
//       {"status":"ok","tier":"dev","liveIntegrations":false}
//     · `podman version --format '{{.Server.Version}}'` returns a version, so the
//       format string the docker lane already used needs no special-casing.
//     · `podman compose` resolves to the Compose plugin, so compose files work.
//
//   NOT VERIFIED — do not let anyone read this file as a claim that it was:
//     · Anything on macOS. Podman on a Mac runs a VM (`podman machine`), which is a
//       different execution model to test on a Mac, not here.
//     · The full docker-verify lane (Postgres + Redis + the durable proofs) under
//       podman end-to-end.
//     · Rootless podman. The sandbox run was rootful (`rootless=false`); rootless
//       changes port binding below 1024 and volume ownership.
//
// DEFAULTING. Auto-detection prefers PODMAN (see KNOWN below). A machine with only
// docker still works untouched — docker is tried next and selected automatically.
//
// CONTAINER_ENGINE IS AUTHORITATIVE. If it is set and that engine does not work, this
// FAILS rather than quietly falling back to the other one. Same discipline as
// SIGNALGRID_MCP_PATH in verify-all.mjs, for the same reason: a caller who named an
// engine is making a claim about what they are testing, and silently testing the
// other one launders that claim.

import { spawnSync } from "node:child_process";

// PODMAN FIRST. The owner chose podman as the target runtime, and it is the better
// default on the merits: daemonless (so it works where no daemon is running — this
// repo's own cloud sandbox, where docker cannot start at all), rootless-capable, and
// no Docker Desktop licence on a Mac. Docker remains fully supported and is selected
// automatically when podman is absent, or explicitly with CONTAINER_ENGINE=docker.
//
// The order is the whole of the "conversion": nothing else had to change, because
// these were always OCI images built from ordinary Dockerfiles.
const KNOWN = ["podman", "docker"];

/** Ask an engine for its server version. Returns null when it is absent or unusable. */
function probe(engine) {
  let res;
  try {
    res = spawnSync(engine, ["version", "--format", "{{.Server.Version}}"], {
      encoding: "utf8",
      timeout: 60_000,
    });
  } catch {
    return null;
  }
  if (!res || res.status !== 0) return null;
  const version = (res.stdout ?? "").trim();
  return version.length > 0 ? version : null;
}

/**
 * Resolve the container engine to use.
 *
 * @returns {{ok: true, engine: string, version: string, source: string, daemonless: boolean}
 *          | {ok: false, engine: string|null, source: string, detail: string}}
 */
export function resolveContainerEngine() {
  const requested = process.env.CONTAINER_ENGINE?.trim();

  if (requested) {
    // Named explicitly — honour it exactly, including the failure.
    const version = probe(requested);
    if (version) {
      return {
        ok: true,
        engine: requested,
        version,
        source: "CONTAINER_ENGINE",
        daemonless: requested === "podman",
      };
    }
    return {
      ok: false,
      engine: requested,
      source: "CONTAINER_ENGINE",
      detail:
        `CONTAINER_ENGINE=${requested} was set, but that engine did not answer a version query. ` +
        "Refusing to fall back to another engine — you asked to test a specific one, and " +
        "silently testing a different one would make the result mean something else. " +
        (requested === "docker"
          ? "Is the Docker daemon running? (macOS: start Docker Desktop.)"
          : requested === "podman"
            ? "Is podman installed and initialised? (macOS: `podman machine init && podman machine start`.)"
            : `'${requested}' is not one of the engines this repo knows about (${KNOWN.join(", ")}).`),
    };
  }

  // Auto-detect. Docker first so an existing machine behaves exactly as before.
  for (const engine of KNOWN) {
    const version = probe(engine);
    if (version) {
      return {
        ok: true,
        engine,
        version,
        source: "auto-detected",
        daemonless: engine === "podman",
      };
    }
  }

  return {
    ok: false,
    engine: null,
    source: "auto-detected",
    detail:
      `No usable container engine found. Tried: ${KNOWN.join(", ")}.\n` +
      "  Docker needs its daemon running — an installed `docker` binary is not enough.\n" +
      "  Podman is daemonless and is a drop-in alternative: set CONTAINER_ENGINE=podman.",
  };
}

/** One line naming the engine AND how it was chosen — never just "ok". */
export function describeEngine(resolved) {
  if (!resolved.ok) return `no container engine (${resolved.detail.split("\n")[0]})`;
  return `${resolved.engine} ${resolved.version} (${resolved.source}${resolved.daemonless ? ", daemonless" : ""})`;
}
