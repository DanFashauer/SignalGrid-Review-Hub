#!/usr/bin/env node
/**
 * render-preview-assets.mjs — render the preview HTML sources to their PNGs.
 *
 * WHY THIS EXISTS
 * ---------------
 * `docs/preview/assets/*.png` are rendered from HTML sources that live in the
 * same tree. Nothing connected the two: commit ab72355 (2026-09-01) deleted the
 * retired "OPERATIONAL TRUST ORCHESTRATION" eyebrow from BOTH HTML sources and
 * touched neither PNG, so for five days the shipped social card carried a label
 * the sources had retired. This script is the "re-render" half of the fix;
 * `scripts/check-rendered-assets.mjs` is the gate that notices when a source
 * moves and the PNG does not.
 *
 * SCOPE IS DERIVED, NEVER HAND-LISTED
 * -----------------------------------
 * The source set is every git-TRACKED HTML file under docs/, at any depth, that
 * declares BOTH
 * render directives in its own markup:
 *
 *     <!-- render-viewport: 1200x630 -->
 *     <!-- render-output: signalgrid-og.png -->    (relative to the source file)
 *
 * A page that wants to be rendered says so in itself. Add one and it joins this
 * script and the gate at the same moment, because both import discoverSources()
 * from this file.
 *
 * DETERMINISM
 * -----------
 * A re-render of an unchanged source must reproduce the same pixels, otherwise
 * the gate below it is measuring noise.
 *   - deviceScaleFactor is fixed (DEVICE_SCALE_FACTOR, 2× like the shipped files) and fullPage is
 *     false, so the PNG is exactly the declared CSS viewport × the scale factor in pixels.
 *   - `prefers-reduced-motion: reduce` is emulated. This is what makes the
 *     teaser deterministic: `signalgrid-teaser.html` seeds its canvas nodes with
 *     Math.random() (`phase`, `speed`) and animates on requestAnimationFrame
 *     timestamps, but BOTH random values are read only in the non-reduced
 *     branch (`prog = reduce ? 0.62 : Math.sin(t * ... + phase)`), and under
 *     reduce the page calls draw(0) exactly once. So with reduced motion on,
 *     no random value and no clock reaches a pixel — nothing had to be patched
 *     or seeded, and the file renders as authored. `signalgrid-og.html`'s canvas
 *     script uses neither Math.random() nor a clock at all.
 *   - Every page is rendered TWICE and the two PNG buffers are compared. A
 *     mismatch is fatal: this script refuses to write a render it cannot
 *     reproduce in the same process.
 *
 * Playwright + Chromium must already be installed; this script never installs
 * browsers.
 *
 * Usage:  node scripts/render-preview-assets.mjs [--check] [--only <substr>]
 *   --check  render and compare against the PNGs on disk; write nothing, exit 1
 *            if any differ. (Byte-identity across machines is NOT guaranteed —
 *            see check-rendered-assets.mjs for why this is not the gate.)
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');

/** Fixed by design: the PNG is exactly the declared CSS viewport in pixels. */
const DEVICE_SCALE_FACTOR = 2; // 2× raster (the shipped files were 2×); the CSS viewport in the manifest stays 1×

/** Where the renderer records what it rendered, and from which source bytes. */
export const MANIFEST_REL = 'docs/preview/assets/renders.json';

/** Floor on the derivation. Not a scope list — see discoverSources(). */
export const MIN_RENDERABLE_SOURCES = 2;

const VIEWPORT_RE = /<!--\s*render-viewport:\s*(\d+)x(\d+)\s*-->/;
const OUTPUT_RE = /<!--\s*render-output:\s*([^\s>]+?)\s*-->/;

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function sha256File(abs) {
  return sha256(fs.readFileSync(abs));
}

/** git-tracked paths under a prefix, repo-relative, posix separators. */
export function trackedFiles(repoRoot, prefix) {
  const out = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z', '--', prefix], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

/**
 * DERIVED source set: tracked docs HTML that declares both render directives.
 * Returns [{ source, output, viewport:{width,height} }] with repo-relative
 * posix paths, sorted by output.
 *
 * Throws if a source declares one directive but not the other — a half-declared
 * page is a drift signal, never something to silently skip.
 */
export function discoverSources(repoRoot = REPO_ROOT) {
  const found = [];
  for (const rel of trackedFiles(repoRoot, 'docs')) {
    if (!rel.endsWith('.html')) continue;
    const abs = path.join(repoRoot, rel);
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') continue; // tracked but deleted in the worktree
      throw err;
    }
    const vp = text.match(VIEWPORT_RE);
    const outDirective = text.match(OUTPUT_RE);
    if (!vp && !outDirective) continue;
    if (!vp || !outDirective) {
      throw new Error(
        `${rel}: declares ${vp ? 'render-viewport' : 'render-output'} but not ` +
          `${vp ? 'render-output' : 'render-viewport'} — a half-declared render source is drift, not a skip.`,
      );
    }
    const width = Number(vp[1]);
    const height = Number(vp[2]);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new Error(`${rel}: render-viewport must be positive integers, got ${vp[1]}x${vp[2]}`);
    }
    const output = path
      .normalize(path.join(path.dirname(rel), outDirective[1]))
      .split(path.sep)
      .join('/');
    if (output.startsWith('..')) {
      throw new Error(`${rel}: render-output escapes the repo: ${outDirective[1]}`);
    }
    found.push({ source: rel, output, viewport: { width, height } });
  }
  found.sort((a, b) => a.output.localeCompare(b.output));

  const dupes = found.map((f) => f.output).filter((o, i, a) => a.indexOf(o) !== i);
  if (dupes.length) {
    throw new Error(`two sources claim the same render-output: ${[...new Set(dupes)].join(', ')}`);
  }
  return found;
}

/** Resolve a Playwright whose Chromium is actually installed. Never installs. */
async function resolveChromium() {
  const candidates = [
    // repo-pinned first
    path.join(REPO_ROOT, 'scripts/node_modules/@playwright/test/index.js'),
    path.join(REPO_ROOT, 'node_modules/playwright/index.js'),
    // then whatever the machine has
    '/opt/node22/lib/node_modules/playwright/index.js',
    'playwright',
  ];
  const problems = [];
  for (const cand of candidates) {
    let mod;
    try {
      mod = await import(cand.startsWith('/') ? pathToFileURL(cand).href : cand);
    } catch (err) {
      problems.push(`${cand}: not importable (${err.code || err.message})`);
      continue;
    }
    const chromium = mod.chromium ?? mod.default?.chromium;
    if (!chromium) {
      problems.push(`${cand}: no chromium export`);
      continue;
    }
    try {
      const browser = await chromium.launch();
      const version = browser.version();
      return { chromium, browser, version, from: cand };
    } catch (err) {
      problems.push(`${cand}: launch failed (${String(err.message).split('\n')[0]})`);
    }
  }
  throw new Error(
    'no Playwright with an installed Chromium could be launched:\n  ' + problems.join('\n  '),
  );
}

async function renderOnce(browser, entry) {
  const context = await browser.newContext({
    viewport: { width: entry.viewport.width, height: entry.viewport.height },
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const url = pathToFileURL(path.join(REPO_ROOT, entry.source)).href;
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  const buf = await page.screenshot({ type: 'png', fullPage: false });
  await context.close();
  return { buf, metrics };
}

function pngSize(buf) {
  // IHDR width/height live at bytes 16..24 of every PNG.
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function main(argv) {
  const checkOnly = argv.includes('--check');
  const onlyIdx = argv.indexOf('--only');
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : null;

  console.log('render-preview-assets — HTML preview sources -> committed PNGs');
  console.log(`  scope: DERIVED from tracked docs/**/*.html declaring <!-- render-viewport --> +`);
  console.log('         <!-- render-output -->; deviceScaleFactor=1, fullPage=false,');
  console.log('         prefers-reduced-motion=reduce, each page rendered twice and compared.');
  console.log('');

  let entries = discoverSources();
  if (entries.length < MIN_RENDERABLE_SOURCES) {
    console.error(
      `FAIL: derivation floor — found ${entries.length} renderable source(s), expected at least ` +
        `${MIN_RENDERABLE_SOURCES}. The directive scan has drifted; refusing to render nothing.`,
    );
    return 1;
  }
  if (only) entries = entries.filter((e) => e.source.includes(only) || e.output.includes(only));
  if (!entries.length) {
    console.error(`FAIL: --only ${only} matched no renderable source.`);
    return 1;
  }

  const { browser, version, from } = await resolveChromium();
  const fromLabel = from.startsWith(REPO_ROOT) ? path.relative(REPO_ROOT, from) : from;
  console.log(`  chromium ${version} via ${fromLabel}`);
  console.log('');

  const manifestAbs = path.join(REPO_ROOT, MANIFEST_REL);
  const renderedOn = new Date().toISOString().slice(0, 10);
  const renders = {};
  let failures = 0;

  try {
    for (const entry of entries) {
      const outAbs = path.join(REPO_ROOT, entry.output);
      let before = null;
      try {
        before = fs.readFileSync(outAbs); // absent on a first render — read, never exists-then-read
      } catch (err) {
        if (!err || err.code !== 'ENOENT') throw err;
      }

      const a = await renderOnce(browser, entry);
      const b = await renderOnce(browser, entry);
      const same = sha256(a.buf) === sha256(b.buf);
      const size = pngSize(a.buf);

      console.log(`${entry.source}`);
      console.log(
        `  viewport ${entry.viewport.width}x${entry.viewport.height} @${DEVICE_SCALE_FACTOR}x ` +
          `-> ${entry.output} (${size.width}x${size.height}, ${a.buf.length} bytes)`,
      );
      if (before) {
        const beforeSize = pngSize(before);
        console.log(
          `  on disk before: ${beforeSize.width}x${beforeSize.height}, ${before.length} bytes, ` +
            `sha256 ${sha256(before).slice(0, 16)}…`,
        );
      } else {
        console.log('  on disk before: (absent)');
      }
      console.log(`  determinism: two renders ${same ? 'IDENTICAL' : 'DIFFERED'} (sha256 compare)`);
      if (
        a.metrics.scrollHeight > entry.viewport.height ||
        a.metrics.scrollWidth > entry.viewport.width
      ) {
        console.log(
          `  REPORTED: content is larger than the frame ` +
            `(${a.metrics.scrollWidth}x${a.metrics.scrollHeight} vs ` +
            `${entry.viewport.width}x${entry.viewport.height}) — the render is CLIPPED at the viewport.`,
        );
      }

      if (!same) {
        console.log('  FAIL: refusing to write a render this process cannot reproduce.');
        failures += 1;
        continue;
      }

      const unchanged = before && before.equals(a.buf);
      if (checkOnly) {
        console.log(`  --check: ${unchanged ? 'matches disk' : 'DIFFERS from disk'}`);
        if (!unchanged) failures += 1;
      } else {
        fs.mkdirSync(path.dirname(outAbs), { recursive: true });
        fs.writeFileSync(outAbs, a.buf);
        console.log(`  wrote ${entry.output}${unchanged ? ' (unchanged)' : ''}`);
      }

      renders[entry.output] = {
        source: entry.source,
        sourceSha256: sha256File(path.join(REPO_ROOT, entry.source)),
        renderedOn,
        viewport: { width: entry.viewport.width, height: entry.viewport.height },
      };
      console.log('');
    }
  } finally {
    await browser.close();
  }

  if (!checkOnly && !failures) {
    // Only rewrite entries this run produced; keep any others already pinned.
    let existing = { renders: {} };
    try {
      existing = JSON.parse(fs.readFileSync(manifestAbs, 'utf8')); // absent or unparseable → start empty
    } catch {
      existing = { renders: {} };
    }
    const merged = { ...(existing.renders || {}), ...renders };
    const ordered = {};
    for (const key of Object.keys(merged).sort()) ordered[key] = merged[key];
    const manifest = {
      $comment:
        'Generated by scripts/render-preview-assets.mjs — do not hand-edit. Each key is a ' +
        'committed PNG; sourceSha256 is the sha256 of its HTML source AT RENDER TIME, so ' +
        'scripts/check-rendered-assets.mjs can fail when the source moves and the PNG does not. ' +
        `Rendered with Chromium ${version} at deviceScaleFactor ${DEVICE_SCALE_FACTOR}, ` +
        'fullPage:false, prefers-reduced-motion:reduce (which is what makes the teaser canvas ' +
        'deterministic — its Math.random() values are read only in the animated branch).',
      renders: ordered,
    };
    fs.writeFileSync(manifestAbs, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`wrote ${MANIFEST_REL} (${Object.keys(ordered).length} pinned render(s))`);
  }

  if (failures) {
    console.log(`\nFAIL: ${failures} problem(s).`);
    return 1;
  }
  console.log(`\nOK: ${entries.length} render(s) ${checkOnly ? 'match disk' : 'written'}.`);
  return 0;
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`FAIL: ${err.message}`);
      process.exit(1);
    });
}
