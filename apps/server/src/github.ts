import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

/**
 * GitHub integration, driven by the `gh` CLI.
 *
 * Hard rule: nothing here ever changes the checked-out branch. The preview is
 * served from the working tree, so a `checkout` would swap the app out from
 * under a non-technical user mid-session. Every push therefore targets an
 * explicit remote ref (`HEAD:refs/heads/x`) and never moves HEAD locally.
 */

function env(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
    NO_COLOR: "1",
  };
}

async function run(cmd: string, args: string[], cwd?: string): Promise<string> {
  const { stdout } = await pexec(cmd, args, { cwd, env: env(), maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

/**
 * `execFile` reports failures as "Command failed: <argv>\n<stderr>". The argv
 * adds nothing the caller does not already know, and the stderr is the part that
 * explains why, so keep only that.
 */
function readableGhError(err: unknown): Error {
  const message = (err as Error)?.message ?? String(err);
  const detail = message.split("\n").slice(1).join("\n").trim() || message;
  return new Error(detail.slice(0, 300));
}

const git = (dir: string, args: string[]) => run("git", args, dir);
const gh = (dir: string, args: string[]) => run("gh", args, dir);

/**
 * The branch a scaffold project's work mirrors to once connected. A repository
 * project carries its own branch (see projects.ts) and never uses this one.
 */
export const MIRROR_BRANCH = "builder/work";

/** Clone through gh so the person's GitHub login and protocol apply. */
export async function cloneRepo(repo: string, dir: string, branch: string): Promise<void> {
  try {
    await run("gh", ["repo", "clone", repo, dir, "--", "--branch", branch]);
  } catch (err) {
    throw readableGhError(err);
  }
}

export type GhAccount = { authed: boolean; account?: string; protocol?: string; error?: string };

export async function ghAccount(): Promise<GhAccount> {
  try {
    const login = await run("gh", ["api", "user", "--jq", ".login"]);
    return { authed: true, account: login };
  } catch (err) {
    const message = (err as Error).message;
    return { authed: false, error: /not logged/i.test(message) ? "gh is not logged in" : message };
  }
}

export type GhAccountInfo = { login: string; active: boolean; host: string };

/** Every account `gh` is signed in as, and which one it currently acts as. */
export async function listAccounts(): Promise<GhAccountInfo[]> {
  const raw = await run("gh", ["auth", "status", "--json", "hosts"]);
  const parsed = JSON.parse(raw) as {
    hosts?: Record<
      string,
      { login?: string; active?: boolean; host?: string; state?: string }[]
    >;
  };

  const accounts: GhAccountInfo[] = [];
  for (const [host, entries] of Object.entries(parsed.hosts ?? {})) {
    for (const entry of entries) {
      if (entry.login && entry.state === "success") {
        accounts.push({ login: entry.login, active: Boolean(entry.active), host: entry.host ?? host });
      }
    }
  }
  return accounts;
}

/**
 * Switch the account `gh` acts as.
 *
 * Machine-wide, not app-scoped: this rewrites the active account for every `gh`
 * command on the computer, including the user's own terminal. The UI says so
 * before offering it.
 */
export async function switchAccount(login: string): Promise<void> {
  await run("gh", ["auth", "switch", "--hostname", "github.com", "--user", login]);
}

export type RepoSummary = {
  nameWithOwner: string;
  description: string | null;
  isPrivate: boolean;
  updatedAt: string | null;
};

const REPO_FIELDS = "nameWithOwner,description,isPrivate,updatedAt";
/** Bound on the membership fan-out below, so one click cannot become N network calls. */
const MAX_ORG_SCAN = 12;

/**
 * Repositories the signed-in account can actually reach.
 *
 * `gh repo list` with no login lists only repositories the account *owns*, which
 * hides every organisation repository — the exact case that matters here. Each
 * organisation the account belongs to is therefore listed too and the results
 * merged, capped at MAX_ORG_SCAN so a pathological membership list cannot turn
 * a single click into an unbounded fan of requests.
 */
export async function listRepos(): Promise<RepoSummary[]> {
  const seen = new Map<string, RepoSummary>();
  const absorb = (raw: string) => {
    try {
      for (const row of JSON.parse(raw) as RepoSummary[]) {
        if (row?.nameWithOwner && !seen.has(row.nameWithOwner)) seen.set(row.nameWithOwner, row);
      }
    } catch {
      /* a single unreadable listing must not lose the others */
    }
  };

  // The account's own listing is the primary source, and a failure here is
  // reported rather than absorbed: "no repositories" and "gh refused to
  // authenticate" look identical to a user, and only one of them is true.
  // Organisation listings stay best-effort so one unreadable org cannot hide
  // the rest.
  let mine: string;
  try {
    mine = await run("gh", ["repo", "list", "--limit", "200", "--json", REPO_FIELDS]);
  } catch (err) {
    throw readableGhError(err);
  }
  absorb(mine);

  const orgsRaw = await run("gh", ["api", "user/orgs", "--jq", "[.[].login]"]).catch(() => "[]");

  let orgs: string[] = [];
  try {
    orgs = (JSON.parse(orgsRaw) as string[]).filter((org) => typeof org === "string");
  } catch {
    orgs = [];
  }

  const listings = await Promise.all(
    orgs
      .slice(0, MAX_ORG_SCAN)
      .map((org) =>
        run("gh", ["repo", "list", org, "--limit", "200", "--json", REPO_FIELDS]).catch(() => "[]"),
      ),
  );
  for (const listing of listings) absorb(listing);

  return [...seen.values()].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export type RepoState = {
  connected: boolean;
  repo?: string;
  url?: string;
  mirrorBranch?: string;
  baseBranch?: string;
  pushedAt?: number;
  ahead?: number;
  openPr?: { number: number; url: string; title: string } | null;
  error?: string;
};

export function repoFullName(remoteUrl: string): string {
  const m = remoteUrl.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/i);
  return m ? m[1] : remoteUrl;
}

async function remoteUrl(dir: string): Promise<string | null> {
  try {
    const url = await git(dir, ["remote", "get-url", "origin"]);
    return url || null;
  } catch {
    return null;
  }
}

async function defaultBranch(repo: string): Promise<string> {
  try {
    return await run("gh", ["repo", "view", repo, "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"]);
  } catch {
    return "main";
  }
}

export async function repoState(
  dir: string,
  opts: { repo?: string | null; base?: string | null; mirror?: string | null } = {},
): Promise<RepoState> {
  const url = await remoteUrl(dir);
  if (!url) return { connected: false };

  const repo = opts.repo ?? repoFullName(url);
  const baseBranch = opts.base ?? (await defaultBranch(repo));
  const mirror = opts.mirror ?? MIRROR_BRANCH;

  let ahead: number | undefined;
  try {
    const count = await git(dir, ["rev-list", "--count", `origin/${mirror}..HEAD`]);
    ahead = Number(count) || 0;
  } catch {
    ahead = undefined;
  }

  let pushedAt: number | undefined;
  try {
    const iso = await git(dir, ["log", "-1", "--format=%cI", `origin/${mirror}`]);
    pushedAt = iso ? Date.parse(iso) : undefined;
  } catch {
    /* branch not pushed yet */
  }

  let openPr: RepoState["openPr"] = null;
  try {
    const raw = await gh(dir, [
      "pr", "list", "--head", mirror, "--state", "open",
      "--json", "number,url,title", "--limit", "1",
    ]);
    const arr = JSON.parse(raw || "[]");
    openPr = arr[0] ?? null;
  } catch {
    openPr = null;
  }

  return { connected: true, repo, url, mirrorBranch: mirror, baseBranch, pushedAt, ahead, openPr };
}

/** Create a brand-new private repo and import the current state as the baseline. */
export async function connectNew(
  dir: string,
  name: string,
  isPrivate: boolean,
  mirror = MIRROR_BRANCH,
): Promise<RepoState> {
  const visibility = isPrivate ? "--private" : "--public";
  // No --source: we wire the remote ourselves so we control which refs move.
  const created = await gh(dir, ["repo", "create", name, visibility, "--confirm"]);
  const repo = repoFullName(created);

  const sshUrl = await gh(dir, ["repo", "view", repo, "--json", "sshUrl", "--jq", ".sshUrl"]);
  await git(dir, ["remote", "add", "origin", sshUrl]);

  // Baseline on the default branch so pull requests have something to target.
  await git(dir, ["push", "-u", "origin", `HEAD:refs/heads/${await defaultBranch(repo)}`]);
  // Mirror branch starts at the same commit.
  await git(dir, ["push", "origin", `HEAD:refs/heads/${mirror}`]);
  await git(dir, ["fetch", "origin"]);

  return repoState(dir, { repo, mirror });
}

/** Attach an existing repo. Never touches that repo's default branch. */
/**
 * Turn whatever the caller supplied into something git can actually fetch.
 *
 * The connect picker supplies `nameWithOwner` from `gh repo list`, which is a
 * bare `owner/name` slug. Handing that to `git remote add` makes git treat it as
 * a *local path* and the push fails with "'owner/name' does not appear to be a
 * git repository" — an error that names the repo and so reads like an access
 * problem rather than a malformed URL. A pasted URL passes through untouched.
 */
export function normalizeRemote(remote: string): string {
  const trimmed = remote.trim();
  if (!trimmed) return trimmed;
  // Already a URL or scp-style address.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.startsWith("git@")) return trimmed;
  // owner/name -> the account's git protocol is ssh (per `gh auth status`).
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    return `git@github.com:${trimmed.replace(/\.git$/, "")}.git`;
  }
  // Anything else is left alone: a genuine local path is legitimate.
  return trimmed;
}

export async function connectExisting(
  dir: string,
  remote: string,
  mirror = MIRROR_BRANCH,
): Promise<RepoState> {
  const url = normalizeRemote(remote);
  const has = await remoteUrl(dir);
  if (has) await git(dir, ["remote", "set-url", "origin", url]);
  else await git(dir, ["remote", "add", "origin", url]);

  const repo = repoFullName(url);
  const base = await defaultBranch(repo);
  await git(dir, ["push", "origin", `HEAD:refs/heads/${mirror}`]);
  await git(dir, ["fetch", "origin"]);
  return repoState(dir, { repo, base, mirror });
}

/** Mirror the working tree to the project branch. Never moves HEAD. */
export async function syncProject(dir: string, mirror = MIRROR_BRANCH): Promise<RepoState> {
  await git(dir, ["push", "origin", `HEAD:refs/heads/${mirror}`, "--force-with-lease"]);
  await git(dir, ["fetch", "origin"]);
  return repoState(dir, { mirror });
}

/**
 * Branches a pull request could target: the repository's branches with the
 * default first and builder branches left out (a PR from a builder branch
 * into another is not what anyone means by "base").
 */
export async function listBranches(repo: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await run("gh", ["api", `repos/${repo}/branches`, "--paginate", "--jq", ".[].name"]);
  } catch (err) {
    throw readableGhError(err);
  }
  const names = raw
    .split("\n")
    .map((s) => s.trim())
    .filter((n) => n && !n.startsWith("builder/"));
  const def = await defaultBranch(repo);
  return [...new Set([def, ...names])];
}

/** Land the current state on the default branch — the non-technical "ship it". */
export async function pushToDefault(dir: string, baseBranch: string): Promise<void> {
  await git(dir, ["push", "origin", `HEAD:refs/heads/${baseBranch}`]);
}

/** Open (or return) the pull request that mirrors this project. Never moves HEAD. */
export async function createPr(
  dir: string,
  opts: { baseBranch: string; title: string; body?: string; mirror?: string },
): Promise<{ number: number; url: string; title: string; existing: boolean }> {
  const mirror = opts.mirror ?? MIRROR_BRANCH;
  const existingRaw = await gh(dir, [
    "pr", "list", "--head", mirror, "--state", "open",
    "--json", "number,url,title", "--limit", "1",
  ]).catch(() => "[]");
  const existing = JSON.parse(existingRaw || "[]")[0];
  if (existing) return { ...existing, existing: true };

  const url = await gh(dir, [
    "pr", "create",
    "--head", mirror,
    "--base", opts.baseBranch,
    "--title", opts.title,
    "--body", opts.body ?? "",
  ]);
  const number = Number(url.match(/\/pull\/(\d+)/)?.[1] ?? 0);
  return { number, url, title: opts.title, existing: false };
}

/**
 * Token for the code agent, so it can run `gh` itself inside the sandbox
 * (the macOS keychain is not reachable from there). Read once, never logged.
 */
export async function ghToken(): Promise<string | null> {
  try {
    const token = await run("gh", ["auth", "token"]);
    return token || null;
  } catch {
    return null;
  }
}

export async function hasGh(): Promise<boolean> {
  try {
    await run("gh", ["--version"]);
    return true;
  } catch {
    return false;
  }
}
