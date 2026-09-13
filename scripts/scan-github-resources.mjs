#!/usr/bin/env node
// GitHub resource scanner — owner-directed 2026-09-12 ("build a scanner that searches GitHub
// for resources this project can use for the RESOURCE_INTAKE header").
//
// WHAT IT DOES: searches GitHub for resources aligned to docs/agent/RESOURCE_INTAKE.md's bar
// (DR-039: adopt if any part can aid building the company; the only exclusions are licence,
// auto-execution, egress without consent, directory collision) and writes a RANKED CANDIDATE
// QUEUE to artifacts/resource-scan/ (gitignored). Each candidate is tagged with a lane fit
// (mac / cloud / both, and an `mcp` flag) and a disposition.
//
// WHAT IT DOES NOT DO — by construction, not by convention:
//   * It NEVER adopts, installs, clones or vendors anything. Adoption stays eval-by-use, one
//     tool at a time, per .claude/skills/tool-evaluation-by-use — a human/eval reads the real
//     LICENSE file before any RESOURCE_INTAKE row says "licence verified".
//   * It REFUSES to write into docs/agent/RESOURCE_INTAKE.md or .claude/skills/VENDORED.md.
//   * It is MANUAL-ONLY. No hook, no schedule. A recurring external-API job is a different
//     authorization question and is not what was asked for.
//
// LICENCE HANDLING (needle/VENDORED.md lesson): the search API's license.spdx_id is GitHub's
// heuristic guess and is null for many real repos. It is used only as a FILTER here, never as a
// finding — SPDX in the allowlist => CANDIDATE; null or copyleft/NC => NEEDS-OWNER-APPROVAL or
// REJECTED. A package's licence can also differ from an artifact it downloads at runtime; no
// metadata scan sees that, so the eval-by-use step still reads the source.
//
// MECHANISM: GitHub REST search API. Unauthenticated = 10 search req/min (probed 2026-09-12);
// set GITHUB_TOKEN to raise to 30/min. On rate-limit exhaustion it FAILS LOUDLY with a named
// blocker rather than returning a partial list silently (the LightRAG "index green over its own
// failure" class of defect). Needs network egress — run with the sandbox off.
//
// USAGE: node scripts/scan-github-resources.mjs [--per-query N] [--star-floor N] [--dry-run]
//   --dry-run prints the query plan and the already-absorbed skip-list without calling GitHub.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(REPO, "artifacts", "resource-scan");
const INTAKE = join(REPO, "docs", "agent", "RESOURCE_INTAKE.md");
const VENDORED = join(REPO, ".claude", "skills", "VENDORED.md");

// ── config ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const argVal = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const DRY_RUN = argv.includes("--dry-run");
const PER_QUERY = Number(argVal("--per-query", "12"));
const STAR_FLOOR = Number(argVal("--star-floor", "500")); // >= => auto-candidate; below-but-clean => owner-approval
const STALE_MONTHS = 18; // pushed older than this => unmaintained => rejected

// Permissive SPDX ids that grant use in a public tree. Anything else is not auto-adoptable.
const LICENSE_ALLOW = new Set([
  "mit", "apache-2.0", "bsd-2-clause", "bsd-3-clause", "isc",
  "mpl-2.0", "unlicense", "0bsd", "cc0-1.0", "bsl-1.0", "zlib",
]);
// Explicitly refused: copyleft-into-a-public-tree and non-commercial/no-derivatives.
const LICENSE_BLOCK = new Set([
  "gpl-2.0", "gpl-3.0", "agpl-3.0", "lgpl-2.1", "lgpl-3.0",
  "cc-by-sa-4.0", "cc-by-nc-4.0", "cc-by-nc-sa-4.0", "cc-by-nd-4.0", "sspl-1.0",
]);

// Search queries tied to what SignalGrid needs, both lanes. `lane` is the DEFAULT fit; the
// per-repo heuristic can override. Extend freely — each entry is one search request.
const QUERIES = [
  { topic: "mcp-device-security", lane: "mac", q: "mcp server security posture OR device trust OR endpoint", why: "MCP tools the Mac can call for device/security posture signals" },
  { topic: "mcp-identity", lane: "mac", q: "mcp server identity OR okta OR entra OR ldap OR scim", why: "MCP identity/IdP connectors for the source-agnostic orchestration layer" },
  { topic: "policy-engine", lane: "both", q: "policy engine authorization deterministic OR rego OR cedar language:go OR language:rust", why: "deterministic authorization/policy engines to compare against the fail-closed core (research only, never the core)" },
  { topic: "abac-rbac", lane: "both", q: "abac OR rbac authorization library fine-grained", why: "access-model libraries — patterns for the decision core's contract, not its implementation" },
  { topic: "audit-provenance", lane: "both", q: "audit log tamper-evident OR provenance OR attestation transparency", why: "tamper-evident audit / attestation tooling for the query-audit and verdict-attestation surfaces" },
  { topic: "webauthn-fido", lane: "both", q: "webauthn passkey fido2 server library", why: "WebAuthn/passkey libraries adjacent to the step-up ceremony (research; the core stays fixture-backed)" },
  { topic: "on-device-inference", lane: "mac", q: "on-device llm inference structured extraction OR tool calling apple silicon OR gguf", why: "on-device inference/extraction the Mac can run locally (needle-class, research lane only)" },
  { topic: "agent-skills", lane: "both", q: "claude code agent skills collection", why: "agent-skill collections under the agentskills.io standard (DR-030), overlap recorded not refused" },
  { topic: "ci-proof-testing", lane: "cloud", q: "property based testing OR fuzzing OR contract testing framework typescript", why: "property/fuzz/contract testing to widen the proof suite (cloud verifies green)" },
  { topic: "zero-trust-posture", lane: "both", q: "zero trust device posture OR compliance osquery OR fleet", why: "device-posture / compliance tooling adjacent to the Fleet MDM plane" },
  { topic: "mcp-frameworks", lane: "both", q: "model context protocol server framework OR sdk", why: "MCP server frameworks/SDKs for building first-party connectors" },
  { topic: "ts-monorepo-devex", lane: "cloud", q: "typescript monorepo developer experience OR gate OR lint framework", why: "monorepo devex/gate tooling that could strengthen the validation harness" },
];

// ── helpers ─────────────────────────────────────────────────────────────────
// Fail CLOSED: an unparseable timestamp reads as ancient (Infinity), so it is treated as
// unmaintained and rejected — never as fresh. NaN would compare false against everything and
// let an unknown date pass the staleness filter (golden rule 2: unknown tightens, never loosens).
const monthsAgo = (iso) => {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? (Date.now() - t) / (1000 * 60 * 60 * 24 * 30.44) : Infinity;
};

// Parse already-absorbed repos (owner/name) from the intake log and VENDORED.md so we never
// re-surface Ponytail, OmniRoute, Graphify, needle, LightRAG or the vendored skills as "new".
function loadKnown() {
  const seen = new Set();
  for (const f of [INTAKE, VENDORED]) {
    if (!existsSync(f)) continue;
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g)) {
      seen.add(`${m[1].toLowerCase()}/${m[2].toLowerCase().replace(/\.git$/, "")}`);
    }
  }
  return seen;
}

function laneFit(repo) {
  const hay = `${repo.full_name} ${repo.description || ""} ${(repo.topics || []).join(" ")}`.toLowerCase();
  const mcp = /\bmcp\b|model context protocol|model-context-protocol/.test(hay);
  const macish = mcp || /on-device|on device|apple silicon|coreml|core ml|metal|gguf|llama\.cpp|local(?:ly)? run|offline/.test(hay);
  const cloudish = /github action|ci\/cd|\bci\b|linux|kubernetes|docker|pipeline/.test(hay);
  let lane = "both";
  if (macish && !cloudish) lane = "mac";
  else if (cloudish && !macish) lane = "cloud";
  return { lane, mcp };
}

function classify(repo, known) {
  const reasons = [];
  const spdx = (repo.license?.spdx_id || "").toLowerCase();
  const nameKey = repo.full_name.toLowerCase();
  const stale = monthsAgo(repo.pushed_at) > STALE_MONTHS;

  if (known.has(nameKey)) return { disposition: "SKIP-ALREADY-ABSORBED", reasons: ["already in RESOURCE_INTAKE.md or VENDORED.md"] };
  if (repo.archived) reasons.push("archived");
  if (repo.fork) reasons.push("fork");
  if (stale) reasons.push(`unmaintained (last push ${monthsAgo(repo.pushed_at).toFixed(0)}mo ago)`);
  if (LICENSE_BLOCK.has(spdx)) reasons.push(`copyleft/NC licence (${spdx})`);

  if (repo.archived || repo.fork || stale || LICENSE_BLOCK.has(spdx)) {
    return { disposition: "REJECTED", reasons };
  }
  // Licence is a FILTER, not a finding. Null/unknown never auto-passes.
  if (!spdx || spdx === "noassertion") {
    return { disposition: "NEEDS-OWNER-APPROVAL", reasons: ["licence unverified (API reports none) — read the LICENSE file before adopting"] };
  }
  if (!LICENSE_ALLOW.has(spdx)) {
    return { disposition: "NEEDS-OWNER-APPROVAL", reasons: [`licence ${spdx} is outside the permissive allowlist — needs a human licence read`] };
  }
  // Permissive licence + maintained + not archived/fork from here.
  if (repo.stargazers_count >= STAR_FLOOR) {
    return { disposition: "CANDIDATE", reasons: [`permissive (${spdx})`, `${repo.stargazers_count.toLocaleString()} stars`, "maintained"] };
  }
  return { disposition: "NEEDS-OWNER-APPROVAL", reasons: [`permissive (${spdx}) but ${repo.stargazers_count} stars < ${STAR_FLOOR} floor — low-star-but-maybe-worthy, your call`] };
}

async function ghSearch(q, state) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${PER_QUERY}`;
  const headers = { "Accept": "application/vnd.github+json", "User-Agent": "signalgrid-resource-scanner" };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // Respect the rolling search limit: if the last response left us at the wall, wait for reset
  // (short waits only) or fail loudly rather than truncating the scan.
  if (state.remaining !== null && state.remaining <= 1) {
    const waitMs = Math.max(0, state.reset * 1000 - Date.now()) + 2000;
    if (waitMs > 75000) {
      const e = new Error(`RATE LIMIT: ${state.done}/${state.total} queries run before the search limit reset (${Math.round(waitMs / 1000)}s away). Set GITHUB_TOKEN (30/min) and re-run — a partial scan is NOT reported as complete.`);
      e.partial = true;
      throw e;
    }
    await new Promise((r) => setTimeout(r, waitMs));
  }

  const res = await fetch(url, { headers });
  state.remaining = Number(res.headers.get("x-ratelimit-remaining") ?? state.remaining ?? 9);
  state.reset = Number(res.headers.get("x-ratelimit-reset") ?? state.reset ?? 0);
  if (res.status === 403 || res.status === 429) {
    const e = new Error(`RATE LIMIT / FORBIDDEN (HTTP ${res.status}) after ${state.done}/${state.total} queries. ${await res.text().catch(() => "")}. Set GITHUB_TOKEN and re-run; partial results are discarded, not reported as complete.`);
    e.partial = true;
    throw e;
  }
  if (!res.ok) throw new Error(`GitHub search failed: HTTP ${res.status} for q=${q}`);
  const body = await res.json();
  return body.items || [];
}

// ── main ──────────────────────────────────────────────────────────────────
async function main() {
  const known = loadKnown();

  if (DRY_RUN) {
    console.log(`[dry-run] ${QUERIES.length} queries, per-query ${PER_QUERY}, star-floor ${STAR_FLOOR}, stale > ${STALE_MONTHS}mo`);
    console.log(`[dry-run] ${known.size} repos already absorbed (skip-list): ${[...known].slice(0, 8).join(", ")}...`);
    for (const { topic, lane, q } of QUERIES) console.log(`  [${lane}] ${topic}: ${q}`);
    console.log("[dry-run] no GitHub calls made.");
    return;
  }

  const state = { remaining: null, reset: 0, done: 0, total: QUERIES.length };
  const byRepo = new Map(); // full_name -> {repo, matchedQueries[]}
  let rateLimited = null;

  for (const query of QUERIES) {
    try {
      const items = await ghSearch(query.q, state);
      state.done += 1;
      for (const repo of items) {
        const key = repo.full_name.toLowerCase();
        if (!byRepo.has(key)) byRepo.set(key, { repo, matched: [] });
        byRepo.get(key).matched.push({ topic: query.topic, why: query.why, lane: query.lane });
      }
      // Pace to stay under 10/min unauthenticated (search resets per minute).
      if (!process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) await new Promise((r) => setTimeout(r, 6500));
    } catch (e) {
      if (e.partial) { rateLimited = e.message; break; }
      console.error(`  query "${query.topic}" failed: ${e.message}`);
    }
  }

  const scored = [];
  for (const { repo, matched } of byRepo.values()) {
    const { disposition, reasons } = classify(repo, known);
    if (disposition === "SKIP-ALREADY-ABSORBED") continue;
    const fit = laneFit(repo);
    // A repo matched by a mac/cloud-specific query leans that way unless the heuristic says both.
    const queryLanes = new Set(matched.map((m) => m.lane));
    const lane = fit.lane !== "both" ? fit.lane : (queryLanes.size === 1 ? [...queryLanes][0] : "both");
    scored.push({
      full_name: repo.full_name,
      url: repo.html_url,
      description: (repo.description || "").slice(0, 200),
      stars: repo.stargazers_count,
      license: repo.license?.spdx_id || "none",
      pushed_at: repo.pushed_at,
      months_since_push: Number(monthsAgo(repo.pushed_at).toFixed(1)),
      topics: repo.topics || [],
      lane,
      mcp: fit.mcp,
      matched_queries: matched.map((m) => m.topic),
      why: [...new Set(matched.map((m) => m.why))],
      disposition,
      reasons,
    });
  }

  const order = { CANDIDATE: 0, "NEEDS-OWNER-APPROVAL": 1, REJECTED: 2 };
  scored.sort((a, b) => (order[a.disposition] - order[b.disposition]) || (b.stars - a.stars));

  const stamp = new Date().toISOString().slice(0, 10);
  mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = join(OUT_DIR, `candidates-${stamp}.json`);
  const mdPath = join(OUT_DIR, `candidates-${stamp}.md`);

  const summary = {
    generated: new Date().toISOString(),
    complete: !rateLimited,
    rate_limit_note: rateLimited,
    queries_run: `${state.done}/${state.total}`,
    counts: {
      candidate: scored.filter((s) => s.disposition === "CANDIDATE").length,
      needs_owner_approval: scored.filter((s) => s.disposition === "NEEDS-OWNER-APPROVAL").length,
      rejected: scored.filter((s) => s.disposition === "REJECTED").length,
    },
    star_floor: STAR_FLOOR,
    candidates: scored,
  };
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2));

  const md = [];
  md.push(`# GitHub resource scan — ${stamp}`, "");
  md.push(`Generated ${summary.generated}. Queries run: ${summary.queries_run}. Star floor: ${STAR_FLOOR}.`);
  if (rateLimited) md.push("", `> **INCOMPLETE — ${rateLimited}**`);
  md.push("", "> This is a CANDIDATE QUEUE. Nothing here is adopted. Adoption stays eval-by-use, one tool at a time, with a human licence read. Scanner never writes RESOURCE_INTAKE.md.", "");
  for (const group of ["CANDIDATE", "NEEDS-OWNER-APPROVAL", "REJECTED"]) {
    const rows = scored.filter((s) => s.disposition === group);
    md.push(`## ${group} (${rows.length})`, "");
    for (const s of rows) {
      md.push(`### ${s.full_name} — ${s.stars.toLocaleString()}★ [${s.license}] · lane:${s.lane}${s.mcp ? " · MCP" : ""}`);
      md.push(`${s.url}`);
      if (s.description) md.push(`> ${s.description}`);
      md.push(`- fit: ${s.why.join("; ")}`);
      md.push(`- why this disposition: ${s.reasons.join("; ")}`);
      md.push(`- matched: ${s.matched_queries.join(", ")} · last push ${s.months_since_push}mo ago`, "");
    }
  }
  writeFileSync(mdPath, md.join("\n"));

  console.log(`\nResource scan ${rateLimited ? "INCOMPLETE (rate limited)" : "complete"}: ${summary.queries_run} queries.`);
  console.log(`  CANDIDATE: ${summary.counts.candidate} | NEEDS-OWNER-APPROVAL: ${summary.counts.needs_owner_approval} | REJECTED: ${summary.counts.rejected}`);
  console.log(`  queue: ${mdPath}`);
  if (rateLimited) { console.error(`\n${rateLimited}`); process.exitCode = 2; }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
