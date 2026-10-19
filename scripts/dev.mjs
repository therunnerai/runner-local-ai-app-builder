import { spawn } from "node:child_process";

/**
 * Run the orchestrator and the Vite dev server for the builder UI together.
 * Dependency-free so `npm run dev` works on a fresh checkout.
 */
const targets = [
  { name: "server", cmd: "npm", args: ["-w", "@runner-builder/server", "run", "dev"] },
  { name: "web", cmd: "npm", args: ["-w", "@runner-builder/web", "run", "dev"] },
];

const children = targets.map(({ name, cmd, args }) => {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
  const prefix = `[${name}] `;
  const forward = (stream, out) => {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) out.write(prefix + line + "\n");
    });
  };
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);
  child.on("exit", (code) => {
    process.stdout.write(`${prefix}exited (${code})\n`);
  });
  return child;
});

const shutdown = () => {
  for (const c of children) c.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
