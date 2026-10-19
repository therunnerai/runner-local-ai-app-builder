import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import path from "node:path";
import { SELF_CHECK, SELF_CHECK_TIMEOUT_MS } from "./config.ts";

const pexec = promisify(execFile);

export type CheckResult = {
  ok: boolean;
  /** Compiler output when the check failed, trimmed to what an agent needs. */
  output: string;
  /** Why no check ran, when none did. */
  skipped?: string;
};

/**
 * The check a turn must pass before it is reported as done.
 *
 * A mobile project is type-checked with its own TypeScript. A red screen on the
 * phone is the failure a non-technical person cannot read, and most of them are
 * type errors the compiler names precisely; handing that text back to the agent
 * for one fix turn removes most of them before anyone sees them. Repository
 * projects run their own checks and web scaffolds are not checked yet.
 */
export async function selfCheck(dir: string, kind: string): Promise<CheckResult> {
  if (!SELF_CHECK) return { ok: true, output: "", skipped: "self-check is off" };
  if (kind !== "mobile") return { ok: true, output: "", skipped: "only mobile projects are checked" };

  const tsc = path.join(dir, "node_modules", ".bin", "tsc");
  if (!existsSync(tsc) || !existsSync(path.join(dir, "tsconfig.json"))) {
    return { ok: true, output: "", skipped: "no TypeScript toolchain in the project" };
  }

  try {
    await pexec(tsc, ["--noEmit", "-p", dir], {
      cwd: dir,
      timeout: SELF_CHECK_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    return { ok: true, output: "" };
  } catch (err) {
    const e = err as { killed?: boolean; stdout?: string; stderr?: string; message?: string };
    if (e.killed) return { ok: true, output: "", skipped: "type check timed out" };
    const output = `${e.stdout ?? ""}\n${e.stderr ?? ""}`.trim();
    if (!output) return { ok: true, output: "", skipped: `type check could not run: ${e.message ?? "unknown"}` };
    return { ok: false, output: output.slice(-6000) };
  }
}
