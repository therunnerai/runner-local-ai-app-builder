import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { EXPO_SCAFFOLD_DIR, SCAFFOLD_DIR } from "./config.ts";

/**
 * Install each template's dependencies once. Every new project symlinks its
 * template's node_modules, so creating a project is instant instead of an
 * install: 20 seconds for the web scaffold, well over a minute for Expo.
 */
for (const dir of [SCAFFOLD_DIR, EXPO_SCAFFOLD_DIR]) {
  const modules = path.join(dir, "node_modules");
  if (!existsSync(path.join(dir, "package.json"))) {
    console.log(`no template at ${dir}, skipping`);
    continue;
  }
  if (existsSync(modules)) {
    console.log(`template deps already installed at ${modules}`);
    continue;
  }
  console.log(`installing template deps in ${dir} …`);
  execFileSync("npm", ["install", "--no-audit", "--no-fund"], {
    cwd: dir,
    stdio: "inherit",
    env: { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1" },
  });
}
console.log("done.");
