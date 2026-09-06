#!/usr/bin/env node
/**
 * check-rendered-assets.mjs — a committed render must be a render of the
 * committed source.
 *
 * THE DEFECT THIS EXISTS FOR
 * --------------------------
 * `docs/preview/assets/*.png` are rendered from HTML sources sitting beside
 * them, and nothing tied the two together. Commit ab72355 (2026-09-01) edited
 * BOTH HTML sources to delete a category label DR-004/DR-019/DR-020 retired, and
 * touched NEITHER PNG. Every gate in this repository reads text; none reads image
 * content. So the social card kept publishing the retired eyebrow for five days
 * while `check-launch-claims.mjs` reported the surface clean — correctly, because
 * the source WAS clean. The image had simply stopped being a render of it.
 *
 * WHAT IS GATED (fatal)
 * ---------------------
 *   1. The manifest `docs/preview/assets/renders.json` exists, parses, and pins
 *      at least MIN_PINNED renders. An empty manifest FAILS — a gate scanning
 *      nothing is green about nothing.
 *   2. Every source the tree DERIVES as renderable (a tracked HTML file under
 *      docs/ that declares `<!-- render-viewport -->` + `<!-- render-output -->`;
 *      the same discoverSources() the renderer uses) is pinned, with the same
 *      source path and the same viewport the directive declares.
 *   3. For every manifest entry: the source exists and is git-tracked; the PNG
 *      exists and is git-tracked; and sha256(source on disk) equals the
 *      sourceSha256 recorded at render time. A mismatch is the ab72355 defect and
 *      says so by name.
 *   4. Entry shape: viewport is positive integers, renderedOn is YYYY-MM-DD.
 *
 * WHAT IS REPORTED (printed, never fatal on its own)
 * --------------------------------------------------
 *   - Every git-tracked `docs/**` PNG with no manifest entry: "unpinned (no
 *     declared source)". Printed every run, never silently skipped. It is not
 *     fatal because a hand-made or third-party image is a legitimate thing to
 *     commit; what is not legitimate is nobody knowing which are which.
 *   - A manifest that is not yet git-tracked (it must be committed to protect
 *     anything in CI).
 *
 * WHAT IS NOT COVERED — say it plainly
 * ------------------------------------
 *   - VISUAL CORRECTNESS. This gate cannot see the picture. It never asserts the
 *     image looks right, is legible, is on-brand, or says anything in particular.
 *   - That the PNG's PIXELS came from that source. The hash is written by
 *     `scripts/render-preview-assets.mjs` at render time and trusted afterwards;
 *     a hand-edited PNG committed alongside an untouched source passes. Proving
 *     the pixels would mean re-rendering in CI and demanding byte-identity across
 *     machines, which font stacks and GPU rasterisation do not give you — a gate
 *     that flaky gets switched off, so it is deliberately not attempted. What IS
 *     closed is the failure that actually happened: source moves, PNG does not.
 *   - Anything outside docs/. Other trees have no rendered-asset convention yet.
 *
 * Usage:
 *   node scripts/check-rendered-assets.mjs
 *   node scripts/check-rendered-assets.mjs --self-test
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  MANIFEST_REL,
  REPO_ROOT,
  discoverSources,
  sha256,
  trackedFiles,
} from './render-preview-assets.mjs';

/**
 * Floor on the derivation, not a scope list. The tree currently derives exactly
 * two renderable sources; if this check ever finds fewer pinned renders than
 * this, the manifest or the directive scan has rotted and the run must not be
 * green. Raise it when a third render lands.
 */
const MIN_PINNED = 2;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isTracked(repoRoot, rel) {
  try {
    const out = execFileSync('git', ['-C', repoRoot, 'ls-files', '--error-unmatch', '--', rel], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * The whole check as a pure-ish function so --self-test can drive it against
 * throwaway repositories instead of against prose about what it would do.
 */
export function runCheck({ repoRoot, minPinned = MIN_PINNED, manifestRel = MANIFEST_REL }) {
  const problems = [];
  const reports = [];
  const manifestAbs = path.join(repoRoot, manifestRel);

  if (!fs.existsSync(manifestAbs)) {
    problems.push(`${manifestRel}: missing — run: node scripts/render-preview-assets.mjs`);
    return { problems, reports, pinned: 0, derived: 0 };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestAbs, 'utf8'));
  } catch (err) {
    problems.push(`${manifestRel}: not valid JSON (${err.message})`);
    return { problems, reports, pinned: 0, derived: 0 };
  }

  const renders =
    manifest && typeof manifest.renders === 'object' && manifest.renders ? manifest.renders : null;
  if (!renders) {
    problems.push(`${manifestRel}: no "renders" object`);
    return { problems, reports, pinned: 0, derived: 0 };
  }

  const keys = Object.keys(renders).sort();
  if (keys.length < minPinned) {
    problems.push(
      `${manifestRel}: pins ${keys.length} render(s), floor is ${minPinned} — an empty or ` +
        'shrunken manifest is not a pass; the derivation has drifted or a render was dropped.',
    );
  }

  if (!isTracked(repoRoot, manifestRel)) {
    reports.push(`${manifestRel} is not git-tracked yet — commit it, or CI has nothing to check.`);
  }

  // ── GATED 2: every derived renderable source must be pinned ────────────────
  let derived = [];
  try {
    derived = discoverSources(repoRoot);
  } catch (err) {
    problems.push(`render-directive scan failed: ${err.message}`);
  }
  for (const src of derived) {
    const entry = renders[src.output];
    if (!entry) {
      problems.push(
        `${src.source}: declares a render-output (${src.output}) but ${manifestRel} does not pin ` +
          'it — re-run scripts/render-preview-assets.mjs',
      );
      continue;
    }
    if (entry.source !== src.source) {
      problems.push(
        `${src.output}: manifest says it was rendered from ${entry.source}, but ${src.source} ` +
          'claims that output — two sources cannot own one PNG',
      );
    }
    const vp = entry.viewport || {};
    if (vp.width !== src.viewport.width || vp.height !== src.viewport.height) {
      problems.push(
        `${src.output}: manifest viewport ${vp.width}x${vp.height} disagrees with the ` +
          `<!-- render-viewport: ${src.viewport.width}x${src.viewport.height} --> in ${src.source} ` +
          '— re-run scripts/render-preview-assets.mjs',
      );
    }
  }

  // ── GATED 3+4: each pinned entry ───────────────────────────────────────────
  for (const pngRel of keys) {
    const entry = renders[pngRel] || {};
    const srcRel = entry.source;

    if (typeof srcRel !== 'string' || !srcRel) {
      problems.push(`${pngRel}: entry has no "source"`);
      continue;
    }

    const srcAbs = path.join(repoRoot, srcRel);
    if (!fs.existsSync(srcAbs)) {
      problems.push(`${pngRel}: source ${srcRel} does not exist`);
    } else if (!isTracked(repoRoot, srcRel)) {
      problems.push(`${pngRel}: source ${srcRel} is not git-tracked`);
    } else if (typeof entry.sourceSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sourceSha256)) {
      problems.push(`${pngRel}: entry has no valid sourceSha256`);
    } else {
      const now = sha256(fs.readFileSync(srcAbs));
      if (now !== entry.sourceSha256) {
        problems.push(
          `${pngRel}: source moved since the render — re-run scripts/render-preview-assets.mjs ` +
            `(${srcRel} is now sha256 ${now.slice(0, 12)}…, the render recorded ` +
            `${entry.sourceSha256.slice(0, 12)}…)`,
        );
      }
    }

    const pngAbs = path.join(repoRoot, pngRel);
    if (!fs.existsSync(pngAbs)) {
      problems.push(`${pngRel}: pinned render is missing from the tree`);
    } else if (!isTracked(repoRoot, pngRel)) {
      problems.push(`${pngRel}: pinned render is not git-tracked`);
    }

    const vp = entry.viewport || {};
    if (
      !Number.isInteger(vp.width) ||
      !Number.isInteger(vp.height) ||
      vp.width <= 0 ||
      vp.height <= 0
    ) {
      problems.push(`${pngRel}: viewport must be positive integers, got ${JSON.stringify(vp)}`);
    }
    if (typeof entry.renderedOn !== 'string' || !DATE_RE.test(entry.renderedOn)) {
      problems.push(`${pngRel}: renderedOn must be YYYY-MM-DD, got ${JSON.stringify(entry.renderedOn)}`);
    }
  }

  // ── REPORTED: tracked docs PNGs nobody declared a source for ───────────────
  const trackedPngs = trackedFiles(repoRoot, 'docs').filter((f) => f.toLowerCase().endsWith('.png'));
  for (const png of trackedPngs) {
    if (!renders[png]) reports.push(`${png}: unpinned (no declared source)`);
  }

  return { problems, reports, pinned: keys.length, derived: derived.length, trackedPngs };
}

function printRun(result, { repoRoot }) {
  console.log('check-rendered-assets — a committed render must be a render of the committed source');
  console.log('  GATED    : manifest pinned + non-empty; every DERIVED renderable source pinned;');
  console.log('             each entry\'s source and PNG exist, are tracked, and the source still');
  console.log('             hashes to what it hashed at render time.');
  console.log('  REPORTED : tracked docs PNGs with no declared source ("unpinned"), printed every');
  console.log('             run, never fatal by itself.');
  console.log('  NOT COVERED: visual correctness, and whether the PNG pixels truly came from that');
  console.log('             source (the hash is recorded by the renderer and trusted).');
  console.log('');
  console.log(
    `  repo ${repoRoot}: ${result.derived} derived renderable source(s), ${result.pinned} pinned ` +
      `render(s), ${(result.trackedPngs || []).length} tracked docs PNG(s)`,
  );
  console.log('');
  for (const r of result.reports) console.log(`  · REPORTED ${r}`);
  if (result.reports.length) console.log('');
  for (const p of result.problems) console.error(`  ✗ ${p}`);
}

// ── SELF-TEST ────────────────────────────────────────────────────────────────
// Fixture repositories, not prose. Each case plants one defect and demands the
// check name it; the control case demands silence. A gate that has never failed
// proves nothing.

function makeFixture(name, { manifestMutator, extraPng = false, sourceSuffix = '' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rendered-assets-${name}-`));
  const assets = path.join(dir, 'docs/preview/assets');
  fs.mkdirSync(assets, { recursive: true });

  const srcRel = 'docs/preview/assets/fixture.html';
  const pngRel = 'docs/preview/assets/fixture.png';
  const html =
    '<!-- render-viewport: 100x50 -->\n<!-- render-output: fixture.png -->\n<div>x</div>\n' +
    sourceSuffix;
  fs.writeFileSync(path.join(dir, srcRel), html);
  // a 1x1 PNG is enough: this gate never decodes pixels
  fs.writeFileSync(
    path.join(dir, pngRel),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  if (extraPng) fs.writeFileSync(path.join(assets, 'handmade.png'), fs.readFileSync(path.join(dir, pngRel)));

  const manifest = {
    $comment: 'fixture',
    renders: {
      [pngRel]: {
        source: srcRel,
        sourceSha256: sha256(fs.readFileSync(path.join(dir, srcRel))),
        renderedOn: '2026-09-06',
        viewport: { width: 100, height: 50 },
      },
    },
  };
  if (manifestMutator) manifestMutator(manifest, { dir, srcRel, pngRel });
  fs.writeFileSync(path.join(assets, 'renders.json'), JSON.stringify(manifest, null, 2) + '\n');

  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'add', '-A']);
  return { dir, srcRel, pngRel };
}

function selfTest() {
  const manifestRel = 'docs/preview/assets/renders.json';
  const cases = [];
  const record = (label, expectFail, result, mustMention) => {
    const failed = result.problems.length > 0;
    let ok = failed === expectFail;
    if (ok && mustMention) {
      ok = result.problems.some((p) => p.includes(mustMention));
    }
    cases.push({ label, ok, expectFail, result, mustMention });
  };

  // 1. control: manifest matches the source → PASS
  {
    const { dir } = makeFixture('match', {});
    record('matching manifest passes', false, runCheck({ repoRoot: dir, minPinned: 1, manifestRel }));
  }

  // 2. source moved after the render → FAIL, by name
  {
    const { dir, srcRel } = makeFixture('drift', {});
    fs.appendFileSync(path.join(dir, srcRel), '<p>edited after the render</p>\n');
    record(
      'source edited after the render fails',
      true,
      runCheck({ repoRoot: dir, minPinned: 1, manifestRel }),
      'source moved since the render — re-run scripts/render-preview-assets.mjs',
    );
  }

  // 3. an unpinned tracked PNG → REPORTED, not fatal
  {
    const { dir } = makeFixture('unpinned', { extraPng: true });
    const result = runCheck({ repoRoot: dir, minPinned: 1, manifestRel });
    const reported = result.reports.some(
      (r) => r.includes('handmade.png') && r.includes('unpinned (no declared source)'),
    );
    cases.push({
      label: 'unpinned PNG is reported, not fatal',
      ok: result.problems.length === 0 && reported,
      expectFail: false,
      result,
    });
  }

  // 4. manifest names a PNG that is not there → FAIL
  {
    const { dir, pngRel } = makeFixture('missing-png', {});
    fs.rmSync(path.join(dir, pngRel));
    record(
      'manifest naming a missing PNG fails',
      true,
      runCheck({ repoRoot: dir, minPinned: 1, manifestRel }),
      'pinned render is missing from the tree',
    );
  }

  // 5. empty manifest → FAIL on the floor
  {
    const { dir } = makeFixture('empty', {
      manifestMutator: (m) => {
        m.renders = {};
      },
    });
    record(
      'empty manifest fails the floor',
      true,
      runCheck({ repoRoot: dir, minPinned: 1, manifestRel }),
      'floor is 1',
    );
  }

  // 6. fewer pinned renders than the floor → FAIL (the floor is not decorative)
  {
    const { dir } = makeFixture('floor', {});
    record(
      'one pinned render under a floor of two fails',
      true,
      runCheck({ repoRoot: dir, minPinned: 2, manifestRel }),
      'floor is 2',
    );
  }

  // 7. a source that declares a render nobody pinned → FAIL
  {
    const { dir } = makeFixture('unpinned-source', {
      manifestMutator: (m, { pngRel }) => {
        m.renders['docs/preview/assets/other.png'] = m.renders[pngRel];
        delete m.renders[pngRel];
      },
    });
    record(
      'a declared renderable source with no pin fails',
      true,
      runCheck({ repoRoot: dir, minPinned: 1, manifestRel }),
      'does not pin it',
    );
  }

  console.log('check-rendered-assets --self-test');
  let bad = 0;
  for (const c of cases) {
    const verdict = c.ok ? 'ok' : 'SELF-TEST FAILED';
    if (!c.ok) bad += 1;
    console.log(
      `  ${c.ok ? '✓' : '✗'} ${c.label} — ${verdict}` +
        (c.ok ? '' : `\n      problems: ${JSON.stringify(c.result.problems, null, 2)}`),
    );
  }
  console.log('');
  if (bad) {
    console.error(`SELF-TEST FAILED: ${bad}/${cases.length} case(s) did not behave as declared.`);
    return 1;
  }
  console.log(`OK: ${cases.length}/${cases.length} self-test cases behaved as declared.`);
  return 0;
}

function main(argv) {
  if (argv.includes('--self-test')) return selfTest();

  const result = runCheck({ repoRoot: REPO_ROOT });
  printRun(result, { repoRoot: REPO_ROOT });
  if (result.problems.length) {
    console.error(`\nFAIL: ${result.problems.length} problem(s).`);
    return 1;
  }
  console.log(
    `OK: ${result.pinned} pinned render(s) still match their source; ` +
      `${result.reports.length} reported note(s).`,
  );
  return 0;
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error(`FAIL: ${err.stack || err.message}`);
    process.exit(1);
  }
}

export { MIN_PINNED };
