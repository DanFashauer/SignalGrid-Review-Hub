#!/usr/bin/env node
// dev-dispatch — recommend LOCAL vs CLOUD for a task, per docs/DEV_DISPATCH.md.
//
// Deterministic keyword router: no network, no state. It is a nudge, not a law —
// the rule of thumb is LOCAL for anything you'll look at, CLOUD for anything
// you'll walk away from.
//
//   pnpm run dispatch "run the desktop demo and screenshot the Windows chrome"
//   pnpm run dispatch "keep building the backlog while I'm out, open PRs"

const LOCAL_SIGNALS = [
  { re: /\b(run|serve|start|launch|preview|screenshot|screen[- ]?grab)\b/, why: "runs / opens the app" },
  { re: /\bopen (the |a )?(app|site|page|demo|browser|dashboard|console|url|localhost)\b/, why: "opens the app in a browser" },
  { re: /\b(demo|demos|walkthrough|investor|partner|pitch)\b/, why: "a demo you'll show or watch" },
  { re: /\b(see|watch|look at|visual|ui|screen|browser|render)\b/, why: "you need to see it live" },
  { re: /\b(iterate|tweak|fiddle|fast loop|quick edit|tight loop)\b/, why: "fast local iteration" },
  { re: /\b(secret|credential|\.env|local env|private key)\b/, why: "touches local secrets" },
];

const CLOUD_SIGNALS = [
  { re: /\b(keep building|while i'?m (out|away|gone)|overnight|walk away|autonomous|unattended)\b/, why: "long autonomous build; runs while you're away" },
  { re: /\b(pr|pull request|review|codex|ci|babysit|monitor|triage|merge)\b/, why: "PR / CI / review work" },
  { re: /\b(from my phone|on my phone|no laptop|browser only|on the go)\b/, why: "started without a laptop" },
  { re: /\b(clean|disposable|fresh|ephemeral|sandbox)\b/, why: "wants a clean, disposable environment" },
];

function score(task, signals) {
  const hits = [];
  for (const s of signals) if (s.re.test(task)) hits.push(s.why);
  return hits;
}

const task = process.argv.slice(2).join(" ").trim().toLowerCase();
if (!task) {
  console.log('Usage: pnpm run dispatch "<what you want to do>"');
  console.log("Routes a task to LOCAL or CLOUD per docs/DEV_DISPATCH.md.");
  process.exit(2);
}

const local = score(task, LOCAL_SIGNALS);
const cloud = score(task, CLOUD_SIGNALS);

let verdict;
let reasons;
if (local.length > cloud.length) {
  verdict = "LOCAL";
  reasons = local;
} else if (cloud.length > local.length) {
  verdict = "CLOUD";
  reasons = cloud;
} else if (local.length === 0 && cloud.length === 0) {
  // No signal either way — fall back to the rule of thumb.
  verdict = "LOCAL";
  reasons = ["no strong signal — default to LOCAL for anything you'll look at (see docs/DEV_DISPATCH.md)"];
} else {
  // A genuine tie with signals on both sides — the task spans both; split it.
  verdict = "EITHER (split it)";
  reasons = [
    `LOCAL for: ${local.join("; ")}`,
    `CLOUD for: ${cloud.join("; ")}`,
  ];
}

console.log(`→ ${verdict}`);
for (const r of reasons) console.log(`  · ${r}`);
