// Free localhost ports for the browser E2E step, so two preflights on one machine never share servers.
//
// scripts/playwright.config.ts defaults to fixed ports 4611-4616 and, off CI, sets
// reuseExistingServer. When a second preflight starts while the first one's servers are
// still up, Playwright reuses them: the second run tests the FIRST tree's build and can
// report green for code it never served. Picking free ports for every E2E_*_PORT the caller
// did not set gives each run its own servers. An explicit E2E_*_PORT is always respected.
import net from "node:net";
import { pathToFileURL } from "node:url";

export const E2E_PORT_VARS = ["E2E_REVIEW_PORT", "E2E_WEB_PORT", "E2E_API_PORT", "E2E_ADMIN_PORT", "E2E_DESKTOP_PORT", "E2E_PWA_PORT"];

function listenOnFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

/** Returns { VAR: "port" } for each E2E port variable not set in env. All picked ports are distinct. */
export async function freeE2ePorts(env = process.env) {
  const missing = E2E_PORT_VARS.filter((v) => !env[v]);
  // Hold every socket open until all are picked, so the kernel cannot hand out one port twice.
  const servers = [];
  try {
    for (let i = 0; i < missing.length; i += 1) servers.push(await listenOnFreePort());
    return Object.fromEntries(missing.map((v, i) => [v, String(servers[i].address().port)]));
  } finally {
    await Promise.all(servers.map((s) => new Promise((done) => s.close(() => done()))));
  }
}

async function selfTest() {
  let failed = 0;
  const check = (ok, what) => { console.log(`${ok ? "PASS" : "FAIL"} ${what}`); if (!ok) failed += 1; };
  const all = await freeE2ePorts({});
  const ports = Object.values(all).map(Number);
  check(Object.keys(all).length === E2E_PORT_VARS.length, "every E2E port variable gets a port when none is set");
  check(new Set(ports).size === ports.length, "the picked ports are distinct");
  check(ports.every((p) => Number.isInteger(p) && p > 0 && p < 65536), "every picked port is a valid port number");
  // Hold one picked port busy: a fresh allocation must not hand it out again while it is in use.
  const squat = await new Promise((resolve) => { const s = net.createServer(); s.listen(ports[0], "127.0.0.1", () => resolve(s)); });
  const avoid = Object.values(await freeE2ePorts({})).map(Number);
  await new Promise((done) => squat.close(() => done()));
  check(!avoid.includes(ports[0]), "a port already in use is never handed out");
  const partial = await freeE2ePorts({ E2E_API_PORT: "4613" });
  check(!("E2E_API_PORT" in partial) && Object.keys(partial).length === E2E_PORT_VARS.length - 1, "an explicitly set port is respected, never replaced");
  const second = await freeE2ePorts({});
  check(Object.keys(second).length === E2E_PORT_VARS.length, "a second allocation also succeeds");
  if (failed) { console.error(`e2e-ports self-test: ${failed} failed`); process.exit(1); }
  console.log("e2e-ports self-test passed");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href && process.argv.includes("--self-test")) await selfTest();
