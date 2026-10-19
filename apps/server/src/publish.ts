import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { existsSync } from "node:fs";

const pexec = promisify(execFile);

export type BuildResult = { ok: boolean; output: string; log: string };

/**
 * "Publish" locally = produce a real production build of the project.
 * The static output is what you would deploy anywhere.
 */
export async function buildProject(dir: string): Promise<BuildResult> {
  try {
    const { stdout, stderr } = await pexec("npm", ["run", "build"], {
      cwd: dir,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    const log = `${stdout}\n${stderr}`.trim().slice(-4000);
    return { ok: true, output: existsSync(path.join(dir, "dist")) ? "dist/" : "build/", log };
  } catch (err: any) {
    const log = `${err?.stdout ?? ""}\n${err?.stderr ?? ""}\n${err?.message ?? ""}`
      .trim()
      .slice(-4000);
    throw Object.assign(new Error("Build failed"), { log });
  }
}
