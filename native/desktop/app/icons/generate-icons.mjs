#!/usr/bin/env node
// Generate the desktop app icons, deterministically, from the description below.
//
// WHY GENERATE RATHER THAN COMMIT A BLOB. `.github/workflows/android.yml` explains
// why this repo has no Gradle wrapper jar: "this repo would rather pin the version
// here in plain text than carry an opaque blob that no reviewer reads and no gate
// inspects." An icon is a smaller version of the same problem — a binary nobody
// diffs, which is exactly where something unwanted can sit unnoticed in a public
// repository. So the ICON IS SOURCE: a grid of colours in this file, encoded to PNG
// and ICO by hand.
//
// The output is byte-identical on every run (no timestamps, fixed deflate level), so
// `--check` can assert the committed files still match this description. The desktop
// workflow runs that, which makes the committed PNGs reviewable by reading this file.
//
//   node generate-icons.mjs           # write the icons
//   node generate-icons.mjs --check   # fail if the committed icons have drifted
//
// This is decoration, and nothing depends on it being pretty. It exists because Tauri
// requires an icon to bundle, not because the mark is designed.

import { deflateSync } from "node:zlib";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// The mark: a 8x8 grid — a lit cell on a dark field, reading as a "signal on a grid".
// `#` is the accent, `.` is the background, `+` is a dimmed grid line.
const GRID = [
  "..+..+..",
  ".+####+.",
  "+#....#+",
  ".#.##.#.",
  ".#.##.#.",
  "+#....#+",
  ".+####+.",
  "..+..+..",
];
const PALETTE = {
  ".": [11, 15, 25, 255], // near-black field
  "+": [30, 41, 66, 255], // grid line
  "#": [56, 189, 248, 255], // accent
};

/** RGBA pixel rows for a square icon of `size` px, nearest-neighbour scaled from GRID. */
function pixels(size) {
  const cells = GRID.length;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const cell = GRID[Math.floor((y * cells) / size)][Math.floor((x * cells) / size)];
      row.push(...PALETTE[cell]);
    }
    rows.push(row);
  }
  return rows;
}

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A minimal, deterministic 8-bit RGBA PNG. */
function png(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  const raw = Buffer.concat(
    pixels(size).map((row) => Buffer.concat([Buffer.from([0]), Buffer.from(row)])),
  );
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    // level 9 fixed: the same input must always produce the same bytes, or --check
    // fails on a zlib upgrade and reports drift that is not drift.
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** An ICO wrapping PNG frames — supported since Windows Vista, and far simpler than BMP. */
function ico(sizes) {
  const frames = sizes.map((s) => ({ size: s, data: png(s) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(frames.length, 4);

  let offset = 6 + frames.length * 16;
  const entries = [];
  for (const f of frames) {
    const e = Buffer.alloc(16);
    e[0] = f.size >= 256 ? 0 : f.size; // 0 means 256
    e[1] = f.size >= 256 ? 0 : f.size;
    e[2] = 0; // palette
    e[3] = 0; // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32BE(0, 8);
    e.writeUInt32LE(f.data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += f.data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...frames.map((f) => f.data)]);
}

const OUTPUTS = [
  ["32x32.png", () => png(32)],
  ["128x128.png", () => png(128)],
  ["128x128@2x.png", () => png(256)],
  ["icon.png", () => png(512)],
  ["icon.ico", () => ico([16, 32, 48, 256])],
];

const check = process.argv.includes("--check");
let drifted = 0;
for (const [name, make] of OUTPUTS) {
  const path = join(HERE, name);
  const bytes = make();
  if (check) {
    if (!existsSync(path)) {
      console.error(`  MISSING ${name}`);
      drifted += 1;
    } else if (!readFileSync(path).equals(bytes)) {
      console.error(`  DRIFTED ${name} — the committed file is not what this script produces`);
      drifted += 1;
    } else {
      console.log(`  ok ${name} (${bytes.length} bytes)`);
    }
  } else {
    writeFileSync(path, bytes);
    console.log(`  wrote ${name} (${bytes.length} bytes)`);
  }
}

if (check && drifted > 0) {
  console.error(
    `\nFAIL: ${drifted} icon(s) differ from this script's output. Either re-run\n` +
      `\`node native/desktop/app/icons/generate-icons.mjs\` and commit, or — if a file was\n` +
      `hand-edited — put the change in the GRID/PALETTE above so it stays reviewable as text.`,
  );
  process.exit(1);
}
if (check) console.log("\nIcons match their generator.");
