// TEMPORARY diagnostic (throwaway branch, never merged): does bash rewrite PATH when stdin is a socket?
import { spawnSync } from "node:child_process";
const env = { PATH: "/nonexistent-first:/usr/bin:/bin", HOME: process.env.HOME };
for (const [label, opts] of [["stdin pipe (default)", {}], ["stdin ignore", { stdio: ["ignore", "pipe", "pipe"] }], ["stdin pipe, HOME=/var/empty", { env: { ...env, HOME: "/var/empty" } }]])
  console.log(label, JSON.stringify(spawnSync("/bin/bash", ["-c", 'echo "$PATH"; command -v git'], { encoding: "utf8", env, ...opts }).stdout));
console.log("bashrc:", JSON.stringify(spawnSync("/bin/sh", ["-c", "ls -la ~/.bashrc ~/.bash_profile 2>&1; grep -c PATH ~/.bashrc 2>&1"], { encoding: "utf8" }).stdout));
