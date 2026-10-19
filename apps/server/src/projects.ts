import { mkdir, rm, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import crypto from "node:crypto";
import { PROJECTS_DIR, PROJECT_LOG_DIR } from "./config.ts";
import { getStore, now, toProject, toMessage, toEdit, toRelease } from "./db.ts";
import { configureIdentity, ensureExcluded, git, initRepo } from "./git.ts";
import { cloneRepo } from "./github.ts";
import { stopDevServer } from "./devservers.ts";
import { SCAFFOLD_SKIP, seedScaffold, type ScaffoldKind } from "./scaffold.ts";

const pexec = promisify(execFile);
const SKIP = SCAFFOLD_SKIP;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

/** The repository's own package manager, read from its lockfile. */
function installCommand(dir: string): { cmd: string; args: string[] } | null {
  if (existsSync(path.join(dir, "pnpm-lock.yaml"))) return { cmd: "pnpm", args: ["install", "--frozen-lockfile"] };
  if (existsSync(path.join(dir, "yarn.lock"))) return { cmd: "yarn", args: ["install", "--frozen-lockfile"] };
  if (existsSync(path.join(dir, "package-lock.json"))) return { cmd: "npm", args: ["ci", "--no-audit", "--no-fund"] };
  if (existsSync(path.join(dir, "package.json"))) return { cmd: "npm", args: ["install", "--no-audit", "--no-fund"] };
  return null;
}

/** A branch name a reviewer can read: the feature, plus enough id to stay unique. */
export function branchNameFor(name: string, id: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `builder/${slug || "work"}-${id.slice(0, 6)}`;
}

export type RepoProjectInput = {
  name: string;
  workspaceId: string;
  createdBy: string;
  /** owner/name */
  repo: string;
  /** The branch pull requests target — for a Runner repository, staging. */
  baseBranch: string;
};

/**
 * Open an existing repository as a project: clone it at the base branch,
 * install its dependencies, and put it on its own branch named after the
 * feature. Every turn commits and mirrors there; the base branch is only ever
 * the target of a pull request. A failure at any step leaves nothing behind.
 */
export async function createProjectFromRepo(input: RepoProjectInput) {
  const id = crypto.randomUUID();
  const dir = path.join(PROJECTS_DIR, id);
  const mirrorBranch = branchNameFor(input.name, id);
  await mkdir(PROJECTS_DIR, { recursive: true });

  try {
    await cloneRepo(input.repo, dir, input.baseBranch);
    await configureIdentity(dir);
    await git(dir, ["checkout", "-q", "-b", mirrorBranch]);
    await ensureExcluded(dir, `${PROJECT_LOG_DIR}/`);
    const install = installCommand(dir);
    if (install) {
      await pexec(install.cmd, install.args, {
        cwd: dir,
        timeout: INSTALL_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, CI: "1", NO_COLOR: "1" },
      });
    }
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    const message = (err as Error).message ?? String(err);
    throw new Error(message.split("\n").filter(Boolean).slice(-3).join(" ").slice(0, 400));
  }

  const store = await getStore();
  const t = now();
  await store.run(
    `INSERT INTO projects (id,name,dir,port,created_at,updated_at,workspace_id,created_by,repo,base_branch,kind,mirror_branch)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, input.name, dir, null, t, t, input.workspaceId, input.createdBy, input.repo, input.baseBranch, "repo", mirrorBranch],
  );

  return (await getProject(id))!;
}

/**
 * A brand-new app from one of the builder's templates: the web scaffold, or
 * the Expo scaffold for a mobile app. Both share their template's installed
 * node_modules, so creating a project is instant.
 */
export async function createProject(
  name: string,
  workspaceId: string,
  createdBy: string,
  kind: ScaffoldKind = "scaffold",
) {
  const id = crypto.randomUUID();
  const dir = path.join(PROJECTS_DIR, id);
  await mkdir(dir, { recursive: true });

  await seedScaffold(dir, kind);

  await initRepo(dir);
  await ensureExcluded(dir, `${PROJECT_LOG_DIR}/`);

  const store = await getStore();
  const t = now();
  await store.run(
    "INSERT INTO projects (id,name,dir,port,created_at,updated_at,workspace_id,created_by,kind) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, name, dir, null, t, t, workspaceId, createdBy, kind],
  );

  return (await getProject(id))!;
}

/**
 * Every project, across all workspaces. Used on boot to re-adopt detached dev
 * servers, which is process-level work rather than a user-facing read — user
 * requests go through `listProjectsForUser`.
 */
export async function listProjects() {
  const store = await getStore();
  const rows = await store.all<any>("SELECT * FROM projects ORDER BY updated_at DESC");
  return rows.map(toProject);
}

/** The workspace-scoped list: the only project list a request may return. */
export async function listProjectsForUser(userId: string) {
  const store = await getStore();
  const rows = await store.all<any>(
    `SELECT p.* FROM projects p
       JOIN memberships m ON m.workspace_id = p.workspace_id
      WHERE m.user_id = ?
      ORDER BY p.updated_at DESC`,
    [userId],
  );
  return rows.map(toProject);
}

export async function getProject(id: string) {
  const store = await getStore();
  const row = await store.get<any>("SELECT * FROM projects WHERE id = ?", [id]);
  return row ? toProject(row) : null;
}

export async function touchProject(id: string) {
  const store = await getStore();
  await store.run("UPDATE projects SET updated_at = ? WHERE id = ?", [now(), id]);
}

export async function setPort(id: string, port: number | null) {
  const store = await getStore();
  await store.run("UPDATE projects SET port = ? WHERE id = ?", [port, id]);
}

export async function setRepo(id: string, repo: string | null, baseBranch: string | null) {
  const store = await getStore();
  await store.run("UPDATE projects SET repo = ?, base_branch = ? WHERE id = ?", [repo, baseBranch, id]);
}

export async function setPushOnPublish(id: string, value: boolean) {
  const store = await getStore();
  await store.run("UPDATE projects SET push_on_publish = ? WHERE id = ?", [value ? 1 : 0, id]);
}

export async function listMessages(projectId: string) {
  const store = await getStore();
  const rows = await store.all<any>("SELECT * FROM messages WHERE project_id = ? ORDER BY created_at ASC", [projectId]);
  return rows.map(toMessage);
}

export async function listEdits(projectId: string) {
  const store = await getStore();
  const rows = await store.all<any>("SELECT * FROM edits WHERE project_id = ? ORDER BY created_at DESC", [projectId]);
  return rows.map(toEdit);
}

export async function addMessage(
  projectId: string,
  role: "user" | "agent" | "system",
  content: string,
  editId: string | null = null,
) {
  const id = crypto.randomUUID();
  const store = await getStore();
  await store.run("INSERT INTO messages (id,project_id,role,content,created_at,edit_id) VALUES (?,?,?,?,?,?)", [
    id,
    projectId,
    role,
    content,
    now(),
    editId,
  ]);
  await touchProject(projectId);
  return id;
}

export async function addEdit(projectId: string, commitSha: string | null, summary: string) {
  const id = crypto.randomUUID();
  const store = await getStore();
  await store.run("INSERT INTO edits (id,project_id,commit_sha,summary,created_at) VALUES (?,?,?,?,?)", [
    id,
    projectId,
    commitSha,
    summary,
    now(),
  ]);
  await touchProject(projectId);
  return id;
}

export async function getEdit(id: string) {
  const store = await getStore();
  const row = await store.get<any>("SELECT * FROM edits WHERE id = ?", [id]);
  return row ? toEdit(row) : null;
}

export async function deleteProject(id: string) {
  const project = await getProject(id);
  if (!project) return false;
  await stopDevServer(id);
  const store = await getStore();
  await store.run("DELETE FROM messages WHERE project_id = ?", [id]);
  await store.run("DELETE FROM edits WHERE project_id = ?", [id]);
  await store.run("DELETE FROM releases WHERE project_id = ?", [id]);
  await store.run("DELETE FROM projects WHERE id = ?", [id]);
  await rm(project.dir, { recursive: true, force: true }).catch(() => {});
  return true;
}

/* -------------------------------------------------------------- releases */

/** One EAS build queued from this project, tracked until it reaches a terminal state. */
export async function addRelease(
  projectId: string,
  build: {
    buildId: string;
    platform: "ios" | "android";
    profile: "preview" | "production";
    status: string;
    submit: boolean;
    artifactUrl: string | null;
    logUrl: string | null;
    error: string | null;
  },
) {
  const id = crypto.randomUUID();
  const store = await getStore();
  const t = now();
  await store.run(
    `INSERT INTO releases (id,project_id,build_id,platform,profile,status,submit,artifact_url,log_url,error,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      projectId,
      build.buildId,
      build.platform,
      build.profile,
      build.status,
      build.submit ? 1 : 0,
      build.artifactUrl,
      build.logUrl,
      build.error,
      t,
      t,
    ],
  );
  await touchProject(projectId);
  return id;
}

export async function listReleases(projectId: string) {
  const store = await getStore();
  const rows = await store.all<any>("SELECT * FROM releases WHERE project_id = ? ORDER BY created_at DESC", [projectId]);
  return rows.map(toRelease);
}

export async function updateRelease(
  id: string,
  next: { status: string; artifactUrl: string | null; logUrl: string | null; error: string | null },
) {
  const store = await getStore();
  await store.run(
    "UPDATE releases SET status = ?, artifact_url = ?, log_url = COALESCE(?, log_url), error = ?, updated_at = ? WHERE id = ?",
    [next.status, next.artifactUrl, next.logUrl, next.error, now(), id],
  );
}

/** Walk the project dir into a nested tree, skipping noise. */
export async function fileTree(root: string, rel = ""): Promise<any[]> {
  const abs = path.join(root, rel);
  const entries = await readdir(abs, { withFileTypes: true });
  const out: any[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push({ name: e.name, path: childRel, type: "dir", children: await fileTree(root, childRel) });
    } else {
      out.push({ name: e.name, path: childRel, type: "file" });
    }
  }
  return out;
}

export async function readProjectFile(root: string, rel: string) {
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(path.resolve(root))) throw new Error("path escapes project");
  const st = await stat(abs);
  if (!st.isFile()) throw new Error("not a file");
  if (st.size > 512 * 1024) throw new Error("file too large to preview");
  const { readFile } = await import("node:fs/promises");
  return await readFile(abs, "utf8");
}
