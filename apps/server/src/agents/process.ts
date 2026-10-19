import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import type { TurnEvent } from "@runner-builder/shared";
import { PROJECT_LOG_DIR } from "../config.ts";
import type { RunResult } from "./types.ts";

/** What an adapter makes of one line the CLI printed. */
export type Parsed = {
  events: TurnEvent[];
  /** The agent's latest message, which becomes the commit subject. */
  summary?: string;
  /** The CLI reported the turn as failed even if it exits 0. */
  failed?: string;
};

/** Logs each unfamiliar line once, so a schema change shows up without flooding the log. */
export class UnknownEvents {
  private readonly seen = new Set<string>();

  constructor(private readonly cli: string) {}

  note(raw: string): void {
    if (this.seen.size >= 20 || this.seen.has(raw)) return;
    this.seen.add(raw);
    console.error(`[agent:${this.cli}] unrecognized event:`, raw.slice(0, 200));
  }
}

/** Relative to the project when inside it; a path outside stays absolute so it is not misread. */
export function relativeTo(dir: string, p: string): string {
  const r = path.relative(dir, p);
  return r.startsWith("..") ? p : r;
}

export function tokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/**
 * One CLI agent run: spawn, hand over the prompt on stdin, read the JSON
 * lines it prints, keep the raw stream for re-checking the parser, and stop
 * the process when the person presses Stop. The adapters differ only in the
 * command they run and the lines they understand.
 */
export class JsonlProcess {
  constructor(
    private readonly opts: {
      command: string;
      args: string[];
      cwd: string;
      env: NodeJS.ProcessEnv;
      prompt: string;
      /** Raw-stream file name under the project's .builder directory. */
      logName: string;
      /** What to tell the person when the CLI is not installed. */
      missing: string;
      parse: (line: string) => Parsed;
      onEvent: (e: TurnEvent) => void;
      signal?: AbortSignal;
    },
  ) {}

  run(): Promise<RunResult> {
    const { command, args, cwd, env, prompt, logName, missing, parse, onEvent, signal } = this.opts;

    return new Promise((resolve) => {
      const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });

      let logStream: ReturnType<typeof createWriteStream> | null = null;
      try {
        const logDir = path.join(cwd, PROJECT_LOG_DIR);
        mkdirSync(logDir, { recursive: true });
        logStream = createWriteStream(path.join(logDir, logName), { flags: "a" });
      } catch {
        /* logging is best-effort */
      }

      let buffer = "";
      let summary = "";
      let failed: string | undefined;

      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          logStream?.write(line + "\n");
          const out = parse(line);
          if (out.summary) summary = out.summary;
          if (out.failed) failed = out.failed;
          for (const ev of out.events) onEvent(ev);
        }
      });

      let stderr = "";
      child.stderr.on("data", (b: Buffer) => {
        stderr += b.toString();
      });

      // Stop = terminate the process, not just stop listening to it. An agent
      // that kept running after Stop would keep editing files under the next
      // turn's feet.
      let stopped = false;
      const stop = () => {
        stopped = true;
        try {
          child.kill("SIGTERM");
        } catch {
          /* already gone */
        }
        const force = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            /* already gone */
          }
        }, 3_000);
        force.unref();
      };
      if (signal?.aborted) stop();
      else signal?.addEventListener("abort", stop, { once: true });

      child.on("error", (err: NodeJS.ErrnoException) => {
        logStream?.end();
        signal?.removeEventListener("abort", stop);
        resolve({ ok: false, summary: "", error: err.code === "ENOENT" ? missing : err.message });
      });

      child.on("close", (code) => {
        logStream?.end();
        signal?.removeEventListener("abort", stop);
        if (stopped) {
          resolve({ ok: false, summary, error: "stopped", stopped: true });
        } else if (code === 0 && !failed) {
          resolve({ ok: true, summary: summary || "Agent edit" });
        } else {
          resolve({
            ok: false,
            summary,
            error: failed ?? (stderr.trim().slice(-800) || `${command} exited with code ${code}`),
          });
        }
      });

      child.stdin.on("error", () => {
        /* the CLI exited before reading the prompt; `close` reports why */
      });
      child.stdin.write(prompt);
      child.stdin.end();
    });
  }
}
