import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { EAS_TIMEOUT_MS } from "./config.ts";
import { easBin } from "./expo.ts";
import { git } from "./git.ts";

const pexec = promisify(execFile);

export type ReleasePlatform = "ios" | "android" | "all";
export type ReleaseProfile = "preview" | "production";

export type ReleaseRequest = {
  platform: ReleasePlatform;
  profile: ReleaseProfile;
  /** Queue a store submission as soon as the build finishes. */
  submit: boolean;
};

/** One EAS build, as the CLI reports it. */
export type EasBuild = {
  id: string;
  platform: "ios" | "android";
  status: string;
  artifactUrl: string | null;
  logUrl: string | null;
  error: string | null;
};

export type AppIdentity = {
  name: string;
  slug: string;
  /** com.example.app on iOS; null until chosen. */
  bundleId: string | null;
  /** com.example.app on Android; null until chosen. */
  packageName: string | null;
  /** The EAS project this app is linked to; null until `eas init` ran. */
  projectId: string | null;
  owner: string | null;
  /** The App Store Connect app id an iOS submission needs; null until recorded in eas.json. */
  ascAppId: string | null;
};

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

/** Reverse-DNS identifiers only; a bad one is rejected by both stores much later and much less clearly. */
export function identifierProblem(value: string): string | null {
  if (!IDENTIFIER.test(value)) return "use a reverse-DNS id like com.yourcompany.appname (letters, digits, dots)";
  if (value.length > 155) return "identifier is too long";
  return null;
}

async function appJson(dir: string): Promise<{ file: string; config: any }> {
  const file = path.join(dir, "app.json");
  const config = JSON.parse(await readFile(file, "utf8"));
  if (!config.expo || typeof config.expo !== "object") throw new Error("app.json has no expo section");
  return { file, config };
}

async function easJson(dir: string): Promise<{ file: string; config: any }> {
  const file = path.join(dir, "eas.json");
  let config: any = {};
  try {
    config = JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    // Only a missing file starts empty; a file that exists but does not
    // parse is never silently replaced.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`eas.json could not be read: ${(err as Error).message}`);
    }
  }
  return { file, config: typeof config === "object" && config ? config : {} };
}

export async function readIdentity(dir: string): Promise<AppIdentity> {
  const { config } = await appJson(dir);
  const { config: eas } = await easJson(dir);
  const e = config.expo;
  const ascAppId = eas.submit?.production?.ios?.ascAppId;
  return {
    name: String(e.name ?? ""),
    slug: String(e.slug ?? ""),
    bundleId: e.ios?.bundleIdentifier ?? null,
    packageName: e.android?.package ?? null,
    projectId: e.extra?.eas?.projectId ?? null,
    owner: e.owner ?? null,
    ascAppId: ascAppId ? String(ascAppId) : null,
  };
}

/**
 * Record the App Store Connect app id in eas.json, under the production
 * submit profile `eas submit` reads. Apple assigns it when the app record is
 * created in App Store Connect; without it an unattended iOS submission has
 * nothing to submit to and the CLI would stop to ask.
 */
export async function setSubmission(dir: string, submission: { ascAppId: string }): Promise<AppIdentity> {
  if (!/^\d{6,14}$/.test(submission.ascAppId)) {
    throw new Error("the App Store Connect app id is the number in the app's App Store Connect URL (digits only)");
  }
  const { file, config } = await easJson(dir);
  config.submit = { ...(config.submit ?? {}) };
  config.submit.production = { ...(config.submit.production ?? {}) };
  config.submit.production.ios = { ...(config.submit.production.ios ?? {}), ascAppId: submission.ascAppId };
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
  return readIdentity(dir);
}

/**
 * Record the store identifiers in app.json. Written once and then left alone:
 * changing a bundle id after a build exists makes the next build a different
 * app in the stores' eyes.
 */
export async function setIdentity(
  dir: string,
  identity: { bundleId: string; packageName: string },
): Promise<AppIdentity> {
  for (const value of [identity.bundleId, identity.packageName]) {
    const problem = identifierProblem(value);
    if (problem) throw new Error(problem);
  }
  const { file, config } = await appJson(dir);
  config.expo.ios = { ...(config.expo.ios ?? {}), bundleIdentifier: identity.bundleId };
  config.expo.android = { ...(config.expo.android ?? {}), package: identity.packageName };
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
  return readIdentity(dir);
}

/**
 * Run the project's EAS CLI. Commands that could prompt get `--non-interactive`
 * so they fail with a message instead of waiting on a question nobody sees;
 * `build:view` does not take the flag and is read-only anyway.
 */
async function eas(dir: string, args: string[], nonInteractive = true): Promise<{ stdout: string; stderr: string }> {
  const bin = easBin(dir);
  if (!bin) throw new Error("EAS CLI is not installed in this project");
  return pexec(bin, nonInteractive ? [...args, "--non-interactive"] : args, {
    cwd: dir,
    timeout: EAS_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1", NO_COLOR: "1", FORCE_COLOR: "0" },
  });
}

/** The CLI's `--json` output can be preceded by progress lines; the JSON starts at the first bracket. */
function parseJson(stdout: string): unknown {
  const start = Math.min(
    ...["[", "{"].map((c) => stdout.indexOf(c)).filter((i) => i >= 0),
  );
  if (!Number.isFinite(start)) throw new Error("EAS returned no JSON");
  return JSON.parse(stdout.slice(start));
}

/** `eas build --json` and `eas build:view --json` name the app under `app`; older output used `project`. */
function toBuild(raw: any): EasBuild {
  const app = raw?.app ?? raw?.project ?? null;
  const account = app?.ownerAccount?.name ?? raw?.ownerAccount?.name ?? null;
  const slug = app?.slug ?? null;
  const id = String(raw?.id ?? "");
  return {
    id,
    platform: String(raw?.platform ?? "").toLowerCase() === "ios" ? "ios" : "android",
    status: String(raw?.status ?? "UNKNOWN"),
    artifactUrl: raw?.artifacts?.buildUrl ?? raw?.artifacts?.applicationArchiveUrl ?? null,
    logUrl: account && slug && id ? `https://expo.dev/accounts/${account}/projects/${slug}/builds/${id}` : null,
    error: raw?.error?.message ?? null,
  };
}

/** The last useful lines of an EAS failure, for the person rather than a log file. */
function easError(err: unknown): Error {
  const e = err as { stdout?: string; stderr?: string; message?: string };
  const text = `${e.stderr ?? ""}\n${e.stdout ?? ""}`.trim();
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return new Error(lines.slice(-4).join(" ").slice(0, 600) || e.message || "EAS failed");
}

/**
 * EAS builds from a clone of the project's commits. A project scaffolded
 * before the template's ignore rule matched a link as well as a directory
 * committed its node_modules link, which arrives on the build machine as a
 * dangling link into this Mac and breaks the install phase. Untrack it and
 * fix the rule; the caller commits. Returns whether anything changed.
 */
export async function untrackSharedModules(dir: string): Promise<boolean> {
  const tracked = await git(dir, ["ls-files", "--", "node_modules"]).catch(() => "");
  if (!tracked) return false;
  await git(dir, ["rm", "-r", "-q", "--cached", "--", "node_modules"]);
  const file = path.join(dir, ".gitignore");
  let ignore = "";
  try {
    ignore = await readFile(file, "utf8");
  } catch {
    /* no ignore file: one is written below */
  }
  if (!ignore.split("\n").some((line) => line.trim() === "node_modules")) {
    const fixed = ignore.replace(/^node_modules\/[ \t]*$/m, "node_modules");
    ignore = /^node_modules[ \t]*$/m.test(fixed) ? fixed : `node_modules\n${fixed}`;
    await writeFile(file, ignore.endsWith("\n") ? ignore : `${ignore}\n`);
  }
  return true;
}

/**
 * EAS installs with `npm ci`, which refuses a lockfile that disagrees with
 * package.json, and a project's lockfile drifts: the template's lock is copied
 * at creation while `npx expo install` and SDK pins move package.json. Resolve
 * the lock on this machine, without touching the shared node_modules, so the
 * upload is consistent. Returns whether the lockfile changed; the caller commits.
 */
export async function syncLockfile(dir: string): Promise<boolean> {
  const lock = path.join(dir, "package-lock.json");
  const current = () => readFile(lock, "utf8").catch(() => "");
  const before = await current();
  await pexec("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: dir,
    timeout: EAS_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, CI: "1", NO_COLOR: "1" },
  });
  return (await current()) !== before;
}

/**
 * Link the project to an EAS project under the signed-in account. Idempotent:
 * a project that already carries a projectId is left as it is.
 */
export async function ensureEasProject(dir: string): Promise<AppIdentity> {
  const current = await readIdentity(dir);
  if (current.projectId) return current;
  try {
    await eas(dir, ["init", "--force"]);
  } catch (err) {
    throw easError(err);
  }
  return readIdentity(dir);
}

/**
 * Queue cloud builds and return at once. The builds run on EAS; their state is
 * read back with `buildStatus`. With `submit`, EAS submits each finished build
 * to its store using the credentials and submit profile kept in EAS and eas.json.
 */
export async function startBuilds(dir: string, req: ReleaseRequest): Promise<EasBuild[]> {
  const args = ["build", "--platform", req.platform, "--profile", req.profile, "--no-wait", "--json"];
  if (req.submit) args.push("--auto-submit");
  try {
    const { stdout } = await eas(dir, args);
    const parsed = parseJson(stdout);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.map(toBuild).filter((b) => b.id);
  } catch (err) {
    throw easError(err);
  }
}

export async function buildStatus(dir: string, buildId: string): Promise<EasBuild> {
  try {
    const { stdout } = await eas(dir, ["build:view", buildId, "--json"], false);
    return toBuild(parseJson(stdout));
  } catch (err) {
    throw easError(err);
  }
}

/** Builds that EAS will not change any more. */
export const TERMINAL_STATUSES = new Set(["FINISHED", "ERRORED", "CANCELED", "CANCELLED"]);
