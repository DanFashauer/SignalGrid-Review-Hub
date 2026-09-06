import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Score = { area: string; current: number; target: number; riskLane: string };

const expectedAreas = [
  'Product definition',
  'Architecture clarity',
  'Demo flow',
  'Connector emulator proof',
  'Credential-reader / smart-locker proof',
  'Review Hub UI/demo readiness',
  'Automation / Autopilot',
  'Smoke evidence',
  'Pitch readiness',
  'Social/preannouncement readiness',
  'Buyer/partner readiness',
  'Founder strategy',
  'Real-world testing readiness',
  'Public-safety guardrails',
  'Documentation navigation',
  'Next-phase clarity',
];

// ANCHORED ON THIS FILE, not on where the process happened to start. This read
// `process.env.INIT_CWD ?? path.resolve(process.cwd(), '..')` — an npm/pnpm-lifecycle
// variable with a positional fallback — so run outside a package lifecycle it resolved
// relative to the caller's cwd, and the run either threw on the matrix read or wrote
// artifacts/level-10/ into the wrong tree. Two live proofs in this directory carry long
// comments about exactly this class of assumption (live-headwind-proof.ts,
// live-glpi-proof.ts): a capture written to scripts/artifacts/ that every consumer then
// read as ABSENT. Every sibling anchors on import.meta.url; so does this now.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const matrixPath = path.join(repoRoot, 'docs', 'LEVEL_10_COMPLETION_MATRIX.md');
const outDir = path.join(repoRoot, 'artifacts', 'level-10');

function parseScores(markdown: string): Score[] {
  return markdown
    .split('\n')
    .filter((line) => line.startsWith('|') && !line.includes('---') && !line.includes('Area |'))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 9)
    .map((cells) => ({
      area: cells[1],
      current: Number(cells[2]),
      target: Number(cells[3]),
      riskLane: cells[8],
    }))
    .filter((score) => score.area.length > 0 && Number.isFinite(score.current) && Number.isFinite(score.target));
}

const markdown = await readFile(matrixPath, 'utf8');
const scores = parseScores(markdown);

if (scores.length === 0) {
  throw new Error(`No Level 10 scores found in ${matrixPath}`);
}

const missingAreas = expectedAreas.filter((area) => !scores.some((score) => score.area === area));
if (missingAreas.length > 0) {
  throw new Error(`Level 10 matrix is missing required areas: ${missingAreas.join(', ')}`);
}

const sourceHash = createHash('sha256').update(markdown).digest('hex');

const currentAverage = Number((scores.reduce((sum, score) => sum + score.current, 0) / scores.length).toFixed(2));
const targetAverage = Number((scores.reduce((sum, score) => sum + score.target, 0) / scores.length).toFixed(2));
const gaps = scores
  .map((score) => ({ ...score, gap: Number((score.target - score.current).toFixed(2)) }))
  .sort((a, b) => b.gap - a.gap || (a.area < b.area ? -1 : a.area > b.area ? 1 : 0));

const scorecard = {
  generatedAt: 'deterministic-from-source',
  source: 'docs/LEVEL_10_COMPLETION_MATRIX.md',
  sourceHash,
  publicSafety: {
    liveIntegrations: false,
    liveApiCalls: false,
    secretsRequired: false,
    productionActions: false,
  },
  currentAverage,
  targetAverage,
  areaCount: scores.length,
  scores,
  largestGaps: gaps.slice(0, 5),
};

const text = [
  'SignalGrid Level 10 Scorecard',
  '=============================',
  `Source: ${scorecard.source}`,
  `Generated: ${scorecard.generatedAt}`,
  `Source hash: ${scorecard.sourceHash}`,
  `Areas scored: ${scorecard.areaCount}`,
  `Current average: ${currentAverage}/10`,
  `Target average: ${targetAverage}/10`,
  '',
  'Largest gaps:',
  ...scorecard.largestGaps.map((gap) => `- ${gap.area}: ${gap.current} -> ${gap.target} (gap ${gap.gap}, ${gap.riskLane})`),
  '',
  'Public-safety posture: fixture-backed audit only; no live integrations, live API calls, secrets, or production actions.',
  '',
].join('\n');

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'scorecard.json'), `${JSON.stringify(scorecard, null, 2)}\n`);
await writeFile(path.join(outDir, 'LEVEL_10_SCORECARD.txt'), text);
console.log(text);
