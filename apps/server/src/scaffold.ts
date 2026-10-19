import { cp, lstat, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { EXPO_SCAFFOLD_DIR, SCAFFOLD_DIR } from "./config.ts";

/** Never copied out of a template: build output, installs, and OS noise. */
export const SCAFFOLD_SKIP = new Set(["node_modules", ".git", "dist", ".expo", ".DS_Store"]);

/** The kinds of project a template can start. A repository brings its own app. */
export type ScaffoldKind = "scaffold" | "mobile";

export function scaffoldDirFor(kind: ScaffoldKind): string {
  return kind === "mobile" ? EXPO_SCAFFOLD_DIR : SCAFFOLD_DIR;
}

/**
 * Put a starter app into `dir`: the template files, plus a link to the
 * template's installed node_modules so the preview starts without an install.
 * One installed tree per template is shared by every project made from it.
 */
export async function seedScaffold(dir: string, kind: ScaffoldKind = "scaffold"): Promise<void> {
  const source = scaffoldDirFor(kind);
  await cp(source, dir, {
    recursive: true,
    filter: (src) => !SCAFFOLD_SKIP.has(path.basename(src)),
  });

  const sharedModules = path.join(source, "node_modules");
  if (existsSync(sharedModules)) {
    await symlink(sharedModules, path.join(dir, "node_modules"), "dir").catch(() => {});
  }
}

/**
 * Make sure a template project still has its node_modules link before the
 * agent starts. Without it the project cannot type-check, lint or even start,
 * and the agent's first command of a turn has found it missing before.
 * Restoring the link is instant; a template that was never installed is
 * reported so the person can run the builder's setup.
 */
export async function ensureSharedModules(dir: string, kind: ScaffoldKind): Promise<"present" | "linked" | "missing"> {
  const dest = path.join(dir, "node_modules");
  try {
    await lstat(dest);
    return "present";
  } catch {
    /* not there: fall through and relink */
  }
  const shared = path.join(scaffoldDirFor(kind), "node_modules");
  if (!existsSync(shared)) return "missing";
  await symlink(shared, dest, "dir");
  return "linked";
}
