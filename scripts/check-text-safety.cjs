#!/usr/bin/env node
const { readFileSync } = require("node:fs");

const targets = [
  {
    path: ".github/workflows/signalgrid-autopilot-evidence.yml",
    minLines: 80,
  },
  {
    path: "scripts/signalgrid-autopilot-evidence.cjs",
    minLines: 300,
    shebang: "#!/usr/bin/env node",
  },
  {
    path: ".gitattributes",
    minLines: 3,
  },
  {
    path: "docs/SIGNALGRID_AUTOPILOT_EVIDENCE_BOT.md",
    minLines: 40,
  },
  {
    path: "docs/ONE_STEP_CODEX_AUTOPILOT_RUNBOOK.md",
    minLines: 40,
  },
];

const forbiddenCodePoints = [
  0xfeff,
  0x202a,
  0x202b,
  0x202c,
  0x202d,
  0x202e,
  0x2066,
  0x2067,
  0x2068,
  0x2069,
];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

for (const target of targets) {
  const data = readFileSync(target.path);
  const text = data.toString("utf8");
  const lines = text.split("\n");
  const lineCount = text.endsWith("\n") ? lines.length - 1 : lines.length;

  if (data.includes(0x0d)) {
    fail(`${target.path}: contains CR line endings or CR bytes`);
  }

  if (!data.includes(0x0a)) {
    fail(`${target.path}: appears to contain no LF newlines`);
  }

  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    fail(`${target.path}: contains UTF-8 BOM`);
  }

  for (const codePoint of forbiddenCodePoints) {
    if (text.includes(String.fromCodePoint(codePoint))) {
      fail(`${target.path}: contains hidden/bidirectional Unicode U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`);
    }
  }

  if (lineCount < target.minLines) {
    fail(`${target.path}: expected at least ${target.minLines} lines, found ${lineCount}`);
  }

  if (target.shebang) {
    const firstLine = lines[0];
    const secondLine = lines[1] || "";
    if (firstLine !== target.shebang) {
      fail(`${target.path}: first line must be exactly ${JSON.stringify(target.shebang)}`);
    }
    if (!secondLine.startsWith("const ") && !secondLine.startsWith("require") && !secondLine.startsWith("import ")) {
      fail(`${target.path}: second line must start with JavaScript, found ${JSON.stringify(secondLine)}`);
    }
  }

  console.log(`${target.path}: ${lineCount} LF lines, text safety passed`);
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("text safety check passed");
