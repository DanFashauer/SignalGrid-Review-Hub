const { spawn } = require("node:child_process");

const isWindows = process.platform === "win32";
const pnpm = isWindows ? "pnpm.cmd" : "pnpm";

const processes = [
  {
    name: "api",
    command: pnpm,
    args: ["--filter", "@workspace/api-server", "run", "dev"],
    env: { PORT: process.env.PORT_API || "5174" },
  },
  {
    name: "review",
    command: pnpm,
    args: ["--filter", "@workspace/signalgrid-review", "run", "dev"],
    env: { PORT: process.env.PORT_REVIEW || "5173", BASE_PATH: process.env.BASE_PATH || "/" },
  },
];

const children = processes.map((proc) => {
  const child = spawn(proc.command, proc.args, {
    env: { ...process.env, ...proc.env },
    stdio: "inherit",
    shell: false,
  });

  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[${proc.name}] exited with code ${code}`);
      shutdown(code);
    }
  });

  return child;
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function shutdown(code) {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
  process.exit(code);
}
