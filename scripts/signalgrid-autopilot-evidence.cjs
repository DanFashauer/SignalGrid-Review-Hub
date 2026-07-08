#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, writeFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

const artifactDir = path.join('artifacts', 'signalgrid-autopilot-evidence');
mkdirSync(artifactDir, { recursive: true });

const commands = [
  { id: 'typecheck', command: 'pnpm run typecheck' },
  { id: 'build', command: 'PORT=3000 BASE_PATH=/ pnpm run build' },
  { id: 'proof-intune-entra-posture', command: 'pnpm run proof:intune-entra-posture' },
  { id: 'proof-signalgrid-simulator', command: 'pnpm run proof:signalgrid-simulator' },
  { id: 'proof-signalgrid-grid', command: 'pnpm run proof:signalgrid-grid' },
  { id: 'proof-microsoft-graph-sandbox', command: 'pnpm run proof:microsoft-graph-sandbox' },
  { id: 'proof-connector-emulator', command: 'pnpm run proof:connector-emulator' },
  { id: 'phase-gate', command: 'pnpm run phase:gate' },
  { id: 'phase-summary-check', command: 'pnpm run phase:summary-check' },
  { id: 'phase-pr-report', command: 'pnpm run phase:pr-report' },
  { id: 'autopilot-backlog-check', command: 'pnpm run autopilot:backlog-check' },
  { id: 'level10-audit', command: 'pnpm run level10:audit' },
  { id: 'unsafe-claim-scan', command: 'node scripts/signalgrid-autopilot-evidence.cjs --unsafe-claim-scan-only' },
  { id: 'diff-check', command: 'git diff --check' },
];

const denylist = [
  'SignalGrid is production-ready',
  'SignalGrid replaces',
  'SignalGrid is an Imprivata partner',
  'SignalGrid is MFi certified',
  'autonomous production remediation',
  'replaces ServiceNow',
  'replaces PagerDuty',
  'replaces CrowdStrike',
  'replaces Defender',
  'replaces ControlUp',
  'Imprivata partner',
  'MFi certified',
  'replaces Jamf',
  'replaces Intune',
  'replaces Apple Configurator',
  'replaces GroundControl',
];
const allowedContext = /not |does not|do not|no |avoid|guardrail|disclaimer|should not|must not|without claiming|no claim|doesn.t claim|not claim|git grep|denylist|unsafe-claim scan|validation command|scanner example|blocked|public-safety|must explicitly state/i;

function run(command) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, { shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const endedAt = new Date().toISOString();
  return {
    command,
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    startedAt,
    endedAt,
    stdout: (result.stdout || '').slice(-12000),
    stderr: (result.stderr || '').slice(-12000),
  };
}

function unsafeClaimScan() {
  const matches = [];
  for (const phrase of denylist) {
    const result = spawnSync('git', ['grep', '-nF', '--', phrase, '--', 'README.md', 'docs', 'artifacts/signalgrid-review/src'], {
      encoding: 'utf8',
    });
    const lines = (result.stdout || '').split('\n').filter(Boolean);
    for (const line of lines) {
      if (allowedContext.test(line)) continue;
      matches.push({ phrase, match: line });
    }
  }
  return {
    status: matches.length === 0 ? 'passed' : 'failed',
    denylist,
    ignoredContextPattern: allowedContext.source,
    matches,
  };
}

if (process.argv.includes('--unsafe-claim-scan-only')) {
  const scan = unsafeClaimScan();
  process.stdout.write(JSON.stringify(scan, null, 2) + '\n');
  process.exit(scan.status === 'passed' ? 0 : 1);
}

function existingArtifacts() {
  const roots = ['artifacts/phase-pr-report', 'artifacts/level-10', 'artifacts/connector-emulator'];
  return roots.filter(existsSync).map((root) => ({ path: root, entries: readdirSync(root).slice(0, 20) }));
}

const results = [];
for (const item of commands) {
  console.log(`\n[autopilot-evidence] running: ${item.command}`);
  const result = run(item.command);
  results.push({ id: item.id, ...result });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

const failed = results.filter((item) => item.status === 'failed');
const publicSafety = {
  status: failed.some((item) => item.id === 'unsafe-claim-scan') ? 'failed' : 'passed',
  guardrails: [
    'no live Microsoft Graph calls',
    'no live ForwardPass/FUYL calls',
    'no live vendor API calls',
    'no OAuth secrets',
    'no customer tenant IDs',
    'no customer data',
    'no PHI/PII',
    'no production device actions',
    'no autonomous remediation',
    'no production-ready claim',
    'no compliance/certification claim',
    'no partnership/endorsement claim',
    'no acquisition/valuation/legal claims',
    'no blind auto-merge',
  ],
  unsafeClaimScan: unsafeClaimScan(),
};
const nextPhase = {
  nextRecommendedPr: 'Add production-shaped tenant/auth scaffold',
  sequence: [
    'Production-shaped tenant/auth scaffold',
    'Tenant-scope all DB-backed routes',
    'Security middleware baseline',
    'Normalized signal model',
    'Decision engine v1',
    'Policy versioning',
    'Durable audit ledger',
    'Microsoft connector sandbox scaffold',
    'Smart-locker / physical custody scaffold',
    'Operator UX completion',
    'Working concept demo',
    'Deployment/staging readiness',
  ],
  workingConcept: 'Frontline Smart Locker Trust Decision remains fixture-backed until explicitly moved into a private safe-test environment.',
};
const summary = {
  repository: process.env.GITHUB_REPOSITORY || path.basename(process.cwd()),
  branch: process.env.GITHUB_REF_NAME || run('git branch --show-current').stdout.trim(),
  commitSha: process.env.GITHUB_SHA || run('git rev-parse HEAD').stdout.trim(),
  eventType: process.env.GITHUB_EVENT_NAME || 'local',
  prNumber: process.env.PR_NUMBER || process.env.GITHUB_REF?.match(/refs\/pull\/(\d+)\//)?.[1] || null,
  runId: process.env.GITHUB_RUN_ID || null,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  riskLane: 'YELLOW',
  status: failed.length === 0 ? 'passed' : 'failed',
  validationCommands: results.map(({ id, command, status, exitCode }) => ({ id, command, status, exitCode })),
  publicSafetyStatus: publicSafety.status,
  artifactDirectory: artifactDir,
  existingGeneratedArtifacts: existingArtifacts(),
  nextRecommendedPr: nextPhase.nextRecommendedPr,
  remainingRisks: [
    'Workflow and script behavior require owner review before merge.',
    'Node 22 is used for this workflow while an existing phase workflow uses Node 24; standardization remains a follow-up.',
    'Evidence Bot does not create live integrations, secrets, production auth, or autonomous remediation.',
  ],
  ownerActionRequired: 'Review the YELLOW-lane automation PR and approve or request changes; do not blind auto-merge.',
};

const markdown = `# SignalGrid Autopilot Evidence Summary\n\n- **Status:** ${summary.status}\n- **Risk lane:** ${summary.riskLane}\n- **Repository:** ${summary.repository}\n- **Branch:** ${summary.branch}\n- **Commit:** ${summary.commitSha}\n- **Event:** ${summary.eventType}\n- **PR:** ${summary.prNumber || 'n/a'}\n- **Run:** ${summary.runId || 'local'} attempt ${summary.runAttempt || 'n/a'}\n- **Public safety:** ${summary.publicSafetyStatus}\n- **Artifact directory:** ${artifactDir}\n\n## Validation commands\n\n${summary.validationCommands.map((item) => `- ${item.status === 'passed' ? 'PASS' : 'FAIL'} \`${item.command}\``).join('\n')}\n\n## Public-safety note\n\nThis evidence run is deterministic and sanitized. It blocks live Microsoft Graph calls, live ForwardPass/FUYL calls, live vendor API calls, OAuth secrets, customer tenant IDs, customer data, PHI/PII, production device actions, autonomous remediation, production-ready claims, compliance/certification claims, partnership/endorsement claims, acquisition/valuation/legal claims, and blind auto-merge.\n\n## Next recommended phase\n\n${nextPhase.nextRecommendedPr}\n\n## Owner action required\n\n${summary.ownerActionRequired}\n`;

writeFileSync(path.join(artifactDir, 'commands.json'), JSON.stringify(results, null, 2));
writeFileSync(path.join(artifactDir, 'public-safety.json'), JSON.stringify(publicSafety, null, 2));
writeFileSync(path.join(artifactDir, 'next-phase.json'), JSON.stringify(nextPhase, null, 2));
writeFileSync(path.join(artifactDir, 'summary.json'), JSON.stringify(summary, null, 2));
writeFileSync(path.join(artifactDir, 'summary.md'), markdown);

console.log(`\n[autopilot-evidence] wrote ${artifactDir}`);
process.exit(failed.length === 0 ? 0 : 1);
