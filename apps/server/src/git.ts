import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const pexec = promisify(execFile);

/**
 * Keep an orchestrator-owned path out of the project's commits without editing
 * the project's own .gitignore, which belongs to the person and the agent.
 * Uses the repository's local exclude file, so it never shows up in a diff and
 * also covers projects scaffolded before the log directory was renamed.
 */
export async function ensureExcluded(dir: string, entry: string): Promise<void> {
  const infoDir = path.join(dir, ".git", "info");
  const file = path.join(infoDir, "exclude");
  let current = "";
  try {
    current = await readFile(file, "utf8");
  } catch {
    /* no exclude file yet */
  }
  if (current.split("\n").some((line) => line.trim() === entry)) return;
  await mkdir(infoDir, { recursive: true });
  const separator = current && !current.endsWith("\n") ? "\n" : "";
  await writeFile(file, `${current}${separator}${entry}\n`);
}

/** Run a git command in `dir`. Throws on non-zero exit. */
export async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await pexec("git", args, {
    cwd: dir,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout.trim();
}

/** The identity every turn commits as, set per repository so nothing global changes. */
export async function configureIdentity(dir: string): Promise<void> {
  await git(dir, ["config", "user.email", "builder@therunner.ai"]);
  await git(dir, ["config", "user.name", "Runner Builder"]);
}

export async function initRepo(dir: string): Promise<void> {
  await git(dir, ["init", "-q"]);
  await configureIdentity(dir);
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "-m", "Initial scaffold", "--allow-empty"]);
}

/** Stage everything and commit. Returns the new sha, or null when nothing changed. */
export async function commitAll(dir: string, message: string): Promise<string | null> {
  await git(dir, ["add", "-A"]);
  const status = await git(dir, ["status", "--porcelain"]);
  if (!status) return null;
  const safe = message.replace(/"/g, "'").slice(0, 200);
  await git(dir, ["commit", "-q", "-m", safe || "Agent edit"]);
  return await git(dir, ["rev-parse", "HEAD"]);
}

export async function revertTo(dir: string, sha: string): Promise<void> {
  await git(dir, ["reset", "--hard", sha]);
  await git(dir, ["clean", "-fd"]);
}

export async function changedFiles(dir: string): Promise<string[]> {
  const out = await git(dir, ["status", "--porcelain"]);
  if (!out) return [];
  return out
    .split("\n")
    .map((l) => l.slice(3).trim())
    .filter(Boolean);
}
