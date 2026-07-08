#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const {
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
} = require("node:fs");
const path = require("node:path");

const artifactDir = path.join("artifacts", "signalgrid-autopilot-evidence");
mkdirSync(artifactDir, { recursive: true });

const commands = [
  { id: "typecheck", command: "pnpm run typecheck" },
  { id: "build", command: "PORT=3000 BASE_PATH=/ pnpm run build" },
  {
    id: "proof-intune-entra-posture",
    command: "pnpm run proof:intune-entra-posture",
  },
  {
    id: "proof-signalgrid-simulator",
    command: "pnpm run proof:signalgrid-simulator",
  },
  { id: "proof-signalgrid-grid", command: "pnpm run proof:signalgrid-grid" },
  {
    id: "proof-microsoft-graph-sandbox",
    command: "pnpm run proof:microsoft-graph-sandbox",
  },
  {
    id: "proof-connector-emulator",
    command: "pnpm run proof:connector-emulator",
  },
  { id: "phase-gate", command: "pnpm run phase:gate" },
  { id: "phase-summary-check", command: "pnpm run phase:summary-check" },
  { id: "phase-pr-report", command: "pnpm run phase:pr-report" },
  {
    id: "autopilot-backlog-check",
    command: "pnpm run autopilot:backlog-check",
  },
  { id: "level10-audit", command: "pnpm run level10:audit" },
  {
    id: "unsafe-claim-scan-self-test",
    command:
      "node scripts/signalgrid-autopilot-evidence.cjs --unsafe-claim-scan-self-test",
  },
  {
    id: "unsafe-claim-scan",
    command:
      "node scripts/signalgrid-autopilot-evidence.cjs --unsafe-claim-scan-only",
  },
  { id: "diff-check", command: "autopilot:diff-check" },
];

const denylist = [
  "SignalGrid is production-ready",
  "SignalGrid replaces",
  "SignalGrid is an Imprivata partner",
  "SignalGrid is MFi certified",
  "autonomous production remediation",
  "replaces ServiceNow",
  "replaces PagerDuty",
  "replaces CrowdStrike",
  "replaces Defender",
  "replaces ControlUp",
  "Imprivata partner",
  "MFi certified",
  "replaces Jamf",
  "replaces Intune",
  "replaces Apple Configurator",
  "replaces GroundControl",
];
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compact(value) {
  return value.toLowerCase().replace(/["'`]/g, "").replace(/\s+/g, " ").trim();
}

function phraseHints(phrase) {
  const normalized = compact(phrase);
  const hints = new Set([normalized]);
  if (normalized.includes("production-ready")) hints.add("production-ready");
  if (normalized.includes("imprivata partner")) hints.add("imprivata partner");
  if (normalized.includes("mfi certified")) hints.add("mfi certified");
  if (normalized.includes("autonomous production remediation"))
    hints.add("autonomous production remediation");
  if (normalized.startsWith("replaces ")) hints.add(normalized);
  if (normalized === "signalgrid replaces") hints.add("signalgrid replaces");
  return [...hints];
}

function hasPhraseHint(line, phrase) {
  const normalizedLine = compact(line);
  return phraseHints(phrase).some((hint) => normalizedLine.includes(hint));
}

function isExplicitAllowedContext(line, phrase) {
  const normalizedLine = compact(line);
  if (!hasPhraseHint(line, phrase)) return false;
  if (normalizedLine.includes("docs/public_messaging_guardrails.md:"))
    return true;

  const phraseAlternatives = phraseHints(phrase).map(escapeRegExp).join("|");
  const explicitPatterns = [
    /git grep/i,
    new RegExp(
      `\\b(do not|dont|must not|should not|never)\\b.{0,40}\\b(claim|say|describe|state|perform)\\b.{0,260}(${phraseAlternatives})`,
      "i",
    ),
    new RegExp(
      `\\b(does not|do not|must not|should not|never|must not import)\\b.{0,80}\\b(claim|replace|demonstrate|perform|modify|deploy|disable|revoke)?\\b.{0,320}(${phraseAlternatives})`,
      "i",
    ),
    new RegExp(
      `\\b(avoid|block|flag|forbid|prohibit|keep all work public-safe)\\b.{0,80}\\b(claim|claiming|claims|language)?\\b.{0,320}(${phraseAlternatives})`,
      "i",
    ),
    new RegExp(
      `\\b(no|without)\\b.{0,80}(${phraseAlternatives}).{0,60}\\bclaim(s|ing)?\\b`,
      "i",
    ),
    new RegExp(
      `\\b(no|without)\\b.{0,60}\\bclaim(s|ing)?\\b.{0,100}(${phraseAlternatives})`,
      "i",
    ),
    new RegExp(
      `(^|[:|;,\\-]\\s*)\\b(no|not)\\b.{0,40}(${phraseAlternatives}).{0,100}\\b(is|are|introduced|present|allowed|system)?\\b`,
      "i",
    ),
    new RegExp(
      `\\bnot\\b.{0,80}\\b(proof|evidence|system|claim)\\b.{0,120}(${phraseAlternatives})`,
      "i",
    ),
    new RegExp(
      `\\b(forbidden|prohibited|unsafe|unsupported)\\s+claim\\b.{0,120}(${phraseAlternatives})`,
      "i",
    ),
    new RegExp(
      `(${phraseAlternatives}).{0,100}\\b(claim|claims|phrase|wording|language)\\b.{0,40}\\b(denylisted|forbidden|prohibited|unsafe|unsupported|blocked|not allowed)\\b`,
      "i",
    ),
    new RegExp(
      `\\bdenylist(ed)?( phrase)?\\b.{0,260}(${phraseAlternatives})`,
      "i",
    ),
    new RegExp(
      `(${phraseAlternatives}).{0,160}\\bdenylist(ed)?( phrase)?\\b`,
      "i",
    ),
    new RegExp(
      `\\bunsafe-claim scanner fixture\\b.{0,140}(${phraseAlternatives})`,
      "i",
    ),
    new RegExp(
      `\\bvalidation (instruction|command|example)\\b.{0,140}(${phraseAlternatives})`,
      "i",
    ),
  ];

  return explicitPatterns.some((pattern) => pattern.test(normalizedLine));
}

const unsafeClaimScannerSelfTests = [
  {
    line: "SignalGrid replaces ServiceNow with no handoff.",
    phrase: "SignalGrid replaces",
    expectedAllowed: false,
  },
  {
    line: "SignalGrid replaces Intune while remaining public-safety focused.",
    phrase: "SignalGrid replaces",
    expectedAllowed: false,
  },
  {
    line: "SignalGrid is production-ready with no customer secrets.",
    phrase: "SignalGrid is production-ready",
    expectedAllowed: false,
  },
  {
    line: "SignalGrid is an Imprivata partner with no live credentials.",
    phrase: "SignalGrid is an Imprivata partner",
    expectedAllowed: false,
  },
  {
    line: "Do not claim SignalGrid replaces ServiceNow.",
    phrase: "SignalGrid replaces",
    expectedAllowed: true,
  },
  {
    line: "SignalGrid must not claim it is production-ready.",
    phrase: "SignalGrid is production-ready",
    expectedAllowed: true,
  },
  {
    line: "No production-ready claim is allowed.",
    phrase: "SignalGrid is production-ready",
    expectedAllowed: true,
  },
  {
    line: "The phrase 'SignalGrid replaces' is denylisted.",
    phrase: "SignalGrid replaces",
    expectedAllowed: true,
  },
];

function unsafeClaimScannerSelfTest() {
  const cases = unsafeClaimScannerSelfTests.map((testCase) => {
    const actualAllowed = isExplicitAllowedContext(
      testCase.line,
      testCase.phrase,
    );
    return {
      ...testCase,
      actualAllowed,
      status: actualAllowed === testCase.expectedAllowed ? "passed" : "failed",
    };
  });
  return {
    status: cases.every((testCase) => testCase.status === "passed")
      ? "passed"
      : "failed",
    cases,
  };
}

function run(command) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, {
    shell: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const endedAt = new Date().toISOString();
  return {
    command,
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status,
    startedAt,
    endedAt,
    stdout: (result.stdout || "").slice(-12000),
    stderr: (result.stderr || "").slice(-12000),
  };
}

function isAllZeroSha(value) {
  return typeof value === "string" && /^0+$/.test(value);
}

function gitOutput(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function resolveDiffCheckCommand() {
  const envBase = (process.env.BASE_SHA || "").trim();
  const envHead = (process.env.HEAD_SHA || "").trim();
  if (envBase && envHead && !isAllZeroSha(envBase) && !isAllZeroSha(envHead)) {
    return {
      command: `git diff --check ${envBase}...${envHead}`,
      diffRange: `${envBase}...${envHead}`,
      fallbackReason: null,
    };
  }

  const head =
    envHead && !isAllZeroSha(envHead)
      ? envHead
      : gitOutput(["rev-parse", "HEAD"]);
  const previous = gitOutput(["rev-parse", "HEAD~1"]);
  if (previous && head) {
    return {
      command: `git diff --check ${previous}...${head}`,
      diffRange: `${previous}...${head}`,
      fallbackReason:
        envBase && isAllZeroSha(envBase)
          ? "BASE_SHA was all zeroes; checked previous commit to HEAD."
          : "BASE_SHA was missing; checked previous commit to HEAD.",
    };
  }

  return {
    command: "git diff --check",
    diffRange: "working-tree",
    fallbackReason:
      "BASE_SHA was missing and no previous commit was available; only the working tree was checked.",
  };
}

function runDiffCheck() {
  const resolved = resolveDiffCheckCommand();
  return {
    ...run(resolved.command),
    diffRange: resolved.diffRange,
    fallbackReason: resolved.fallbackReason,
  };
}

function unsafeClaimScan() {
  const matches = [];
  for (const phrase of denylist) {
    const result = spawnSync(
      "git",
      [
        "grep",
        "-nF",
        "--",
        phrase,
        "--",
        "README.md",
        "docs",
        "artifacts/signalgrid-review/src",
      ],
      {
        encoding: "utf8",
      },
    );
    const lines = (result.stdout || "").split("\n").filter(Boolean);
    for (const line of lines) {
      if (isExplicitAllowedContext(line, phrase)) continue;
      matches.push({ phrase, match: line });
    }
  }
  return {
    status: matches.length === 0 ? "passed" : "failed",
    denylist,
    allowedContext:
      "explicit guardrail/disclaimer/denylist/scanner-fixture/validation-instruction contexts only",
    matches,
  };
}

if (process.argv.includes("--unsafe-claim-scan-self-test")) {
  const selfTest = unsafeClaimScannerSelfTest();
  process.stdout.write(JSON.stringify(selfTest, null, 2) + "\n");
  process.exit(selfTest.status === "passed" ? 0 : 1);
}

if (process.argv.includes("--unsafe-claim-scan-only")) {
  const scan = unsafeClaimScan();
  process.stdout.write(JSON.stringify(scan, null, 2) + "\n");
  process.exit(scan.status === "passed" ? 0 : 1);
}

function existingArtifacts() {
  const roots = [
    "artifacts/phase-pr-report",
    "artifacts/level-10",
    "artifacts/connector-emulator",
  ];
  return roots
    .filter(existsSync)
    .map((root) => ({ path: root, entries: readdirSync(root).slice(0, 20) }));
}

const results = [];
for (const item of commands) {
  console.log(`\n[autopilot-evidence] running: ${item.command}`);
  const result = item.id === "diff-check" ? runDiffCheck() : run(item.command);
  results.push({ id: item.id, ...result });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

const failed = results.filter((item) => item.status === "failed");
const publicSafety = {
  status: failed.some((item) => item.id === "unsafe-claim-scan")
    ? "failed"
    : "passed",
  guardrails: [
    "no live Microsoft Graph calls",
    "no live ForwardPass/FUYL calls",
    "no live vendor API calls",
    "no OAuth secrets",
    "no customer tenant IDs",
    "no customer data",
    "no PHI/PII",
    "no production device actions",
    "no autonomous remediation",
    "no production-ready claim",
    "no compliance/certification claim",
    "no partnership/endorsement claim",
    "no acquisition/valuation/legal claims",
    "no blind auto-merge",
  ],
  unsafeClaimScan: unsafeClaimScan(),
  unsafeClaimScannerSelfTest: unsafeClaimScannerSelfTest(),
};
const nextPhase = {
  nextRecommendedPr: "Add production-shaped tenant/auth scaffold",
  sequence: [
    "Production-shaped tenant/auth scaffold",
    "Tenant-scope all DB-backed routes",
    "Security middleware baseline",
    "Normalized signal model",
    "Decision engine v1",
    "Policy versioning",
    "Durable audit ledger",
    "Microsoft connector sandbox scaffold",
    "Smart-locker / physical custody scaffold",
    "Operator UX completion",
    "Working concept demo",
    "Deployment/staging readiness",
  ],
  workingConcept:
    "Frontline Smart Locker Trust Decision remains fixture-backed until explicitly moved into a private safe-test environment.",
};
const summary = {
  repository: process.env.GITHUB_REPOSITORY || path.basename(process.cwd()),
  branch:
    process.env.GITHUB_REF_NAME ||
    run("git branch --show-current").stdout.trim(),
  commitSha: process.env.GITHUB_SHA || run("git rev-parse HEAD").stdout.trim(),
  eventType: process.env.GITHUB_EVENT_NAME || "local",
  prNumber:
    process.env.PR_NUMBER ||
    process.env.GITHUB_REF?.match(/refs\/pull\/(\d+)\//)?.[1] ||
    null,
  runId: process.env.GITHUB_RUN_ID || null,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  riskLane: "YELLOW",
  status: failed.length === 0 ? "passed" : "failed",
  validationCommands: results.map(
    ({ id, command, status, exitCode, diffRange, fallbackReason }) => ({
      id,
      command,
      status,
      exitCode,
      ...(diffRange ? { diffRange } : {}),
      ...(fallbackReason ? { fallbackReason } : {}),
    }),
  ),
  publicSafetyStatus: publicSafety.status,
  artifactDirectory: artifactDir,
  existingGeneratedArtifacts: existingArtifacts(),
  nextRecommendedPr: nextPhase.nextRecommendedPr,
  remainingRisks: [
    "Workflow and script behavior require owner review before merge.",
    "Node 22 is used for this workflow while an existing phase workflow uses Node 24; standardization remains a follow-up.",
    "Evidence Bot does not create live integrations, secrets, production auth, or autonomous remediation.",
  ],
  ownerActionRequired:
    "Review the YELLOW-lane automation PR and approve or request changes; do not blind auto-merge.",
};

const markdown = `# SignalGrid Autopilot Evidence Summary\n\n- **Status:** ${summary.status}\n- **Risk lane:** ${summary.riskLane}\n- **Repository:** ${summary.repository}\n- **Branch:** ${summary.branch}\n- **Commit:** ${summary.commitSha}\n- **Event:** ${summary.eventType}\n- **PR:** ${summary.prNumber || "n/a"}\n- **Run:** ${summary.runId || "local"} attempt ${summary.runAttempt || "n/a"}\n- **Public safety:** ${summary.publicSafetyStatus}\n- **Artifact directory:** ${artifactDir}\n\n## Validation commands\n\n${summary.validationCommands.map((item) => `- ${item.status === "passed" ? "PASS" : "FAIL"} \`${item.command}\``).join("\n")}\n\n## Public-safety note\n\nThis evidence run is deterministic and sanitized. It blocks live Microsoft Graph calls, live ForwardPass/FUYL calls, live vendor API calls, OAuth secrets, customer tenant IDs, customer data, PHI/PII, production device actions, autonomous remediation, production-ready claims, compliance/certification claims, partnership/endorsement claims, acquisition/valuation/legal claims, and blind auto-merge.\n\n## Next recommended phase\n\n${nextPhase.nextRecommendedPr}\n\n## Owner action required\n\n${summary.ownerActionRequired}\n`;

writeFileSync(
  path.join(artifactDir, "commands.json"),
  JSON.stringify(results, null, 2),
);
writeFileSync(
  path.join(artifactDir, "public-safety.json"),
  JSON.stringify(publicSafety, null, 2),
);
writeFileSync(
  path.join(artifactDir, "next-phase.json"),
  JSON.stringify(nextPhase, null, 2),
);
writeFileSync(
  path.join(artifactDir, "summary.json"),
  JSON.stringify(summary, null, 2),
);
writeFileSync(path.join(artifactDir, "summary.md"), markdown);

console.log(`\n[autopilot-evidence] wrote ${artifactDir}`);
process.exit(failed.length === 0 ? 0 : 1);
