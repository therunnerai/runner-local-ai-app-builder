import { cp, symlink } from "node:fs/promises";
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
