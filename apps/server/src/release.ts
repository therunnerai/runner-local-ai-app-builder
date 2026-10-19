import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { EAS_TIMEOUT_MS } from "./config.ts";
import { easBin } from "./expo.ts";

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

export async function readIdentity(dir: string): Promise<AppIdentity> {
  const { config } = await appJson(dir);
  const e = config.expo;
  return {
    name: String(e.name ?? ""),
    slug: String(e.slug ?? ""),
    bundleId: e.ios?.bundleIdentifier ?? null,
    packageName: e.android?.package ?? null,
    projectId: e.extra?.eas?.projectId ?? null,
    owner: e.owner ?? null,
  };
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

async function eas(dir: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const bin = easBin(dir);
  if (!bin) throw new Error("EAS CLI is not installed in this project");
  return pexec(bin, [...args, "--non-interactive"], {
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

function toBuild(raw: any): EasBuild {
  const account = raw?.project?.ownerAccount?.name ?? raw?.ownerAccount?.name ?? null;
  const slug = raw?.project?.slug ?? null;
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
    const { stdout } = await eas(dir, ["build:view", buildId, "--json"]);
    return toBuild(parseJson(stdout));
  } catch (err) {
    throw easError(err);
  }
}

/** Builds that EAS will not change any more. */
export const TERMINAL_STATUSES = new Set(["FINISHED", "ERRORED", "CANCELED", "CANCELLED"]);
