import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import type { TurnEvent } from "@runner-builder/shared";
import {
  addEdit,
  addMessage,
  addRelease,
  createProject,
  createProjectFromRepo,
  deleteProject,
  fileTree,
  getEdit,
  listEdits,
  listMessages,
  listProjectsForUser,
  listReleases,
  readProjectFile,
  setPort,
  setPushOnPublish,
  setRepo,
  updateRelease,
} from "./projects.ts";
import { selfCheck } from "./checks.ts";
import { readBrief } from "./brief.ts";
import { expoAccount } from "./expo.ts";
import {
  TERMINAL_STATUSES,
  buildStatus,
  ensureEasProject,
  readIdentity,
  setIdentity,
  startBuilds,
  type ReleasePlatform,
  type ReleaseProfile,
} from "./release.ts";
import { toUser, toWorkspace } from "./db.ts";
import {
  addMember,
  backfillOrphanProjects,
  countOwners,
  countUsers,
  createUser,
  createWorkspace,
  ensurePersonalWorkspace,
  findUserByEmail,
  hasWorkspaceRole,
  isRole,
  listMembers,
  listWorkspacesForUser,
  removeMember,
  requireProjectAccess,
  setMemberRole,
  type Role,
} from "./accounts.ts";
import {
  SESSION_COOKIE,
  clearedCookie,
  createSession,
  currentUser,
  destroySession,
  readCookie,
  registerAuth,
  sessionCookie,
  verifyPassword,
} from "./auth.ts";
import { ensureDevServer, previewUrlFor } from "./devservers.ts";
import { cancelLogin, codexStatus, linkTerminalLogin, logout as codexLogout, startLogin } from "./codexAuth.ts";
import { buildPrompt, runCodex } from "./agent.ts";
import { buildProject } from "./publish.ts";
import { commitAll, git, revertTo } from "./git.ts";
import { runExclusive } from "./turns.ts";
import { MEMPALACE_ENABLED } from "./config.ts";
import {
  MIRROR_BRANCH,
  connectExisting,
  connectNew,
  createPr,
  ghAccount,
  ghToken,
  hasGh,
  listAccounts,
  listBranches,
  listRepos,
  pushToDefault,
  repoState,
  switchAccount,
  syncProject,
} from "./github.ts";

/** owner/name, as `gh` names repositories. */
const REPO_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** The prompt for the one fix turn after a failed self-check. */
function fixPrompt(output: string): string {
  return (
    "Your last change does not type-check. Fix every error below without changing the app's " +
    "behaviour or scope, then run `npx tsc --noEmit` again until it passes.\n\n```\n" +
    output +
    "\n```"
  );
}

/** Credential shape check. Deliberately minimal: this is a local tool. */
function credentialProblem(email: string, name: string, password: string): string | null {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return "a valid email is required";
  if (!name.trim()) return "a name is required";
  if (password.length < 8) return "password must be at least 8 characters";
  return null;
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Registered before any route, so every route below is authenticated unless it
  // is explicitly listed as public inside the hook.
  registerAuth(app);

  app.get("/api/health", async () => ({ ok: true, previews: previewUrlFor("__none__") === null }));

  /* ------------------------------------------------- codex (chatgpt) login */

  // The account the agent runs as is machine-level, like the gh account: any
  // signed-in member may see and change it, and the UI says it applies to all.
  app.get("/api/codex", async () => codexStatus());

  app.post("/api/codex/login", async (req, reply) => {
    try {
      return await startLogin();
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.post("/api/codex/login/cancel", async () => {
    cancelLogin();
    return codexStatus();
  });

  app.post("/api/codex/logout", async () => {
    await codexLogout();
    return codexStatus();
  });

  app.post("/api/codex/link", async (req, reply) => {
    try {
      await linkTerminalLogin();
      return codexStatus();
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  /* --------------------------------------------- github, account level */

  /**
   * Repositories the active `gh` account can actually reach, for the connect
   * picker. Deliberately not limited to repositories the account owns: the org's
   * repositories are the ones that matter here, and they are invisible to a
   * plain `gh repo list`.
   */
  app.get("/api/github/repos", async (req, reply) => {
    if (!(await hasGh())) return reply.code(503).send({ error: "gh CLI is not available" });
    try {
      return await listRepos();
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.get("/api/github/accounts", async (req, reply) => {
    if (!(await hasGh())) return reply.code(503).send({ error: "gh CLI is not available" });
    try {
      return await listAccounts();
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  /**
   * Switch which GitHub account `gh` acts as. Machine-wide by nature: it rewrites
   * the active account for every `gh` command on this computer, the user's own
   * terminal included, which is why the UI states that before calling it.
   */
  /** Branches of any reachable repository, default first: the base-branch choice when opening one. */
  app.get("/api/github/branches", async (req, reply) => {
    const { repo } = req.query as { repo?: string };
    if (!repo || !REPO_SLUG.test(repo)) return reply.code(400).send({ error: "repo must be owner/name" });
    if (!(await hasGh())) return reply.code(503).send({ error: "gh CLI is not available" });
    try {
      return await listBranches(repo);
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.post("/api/github/accounts/switch", async (req, reply) => {
    const { login } = (req.body ?? {}) as { login?: string };
    if (!login?.trim()) return reply.code(400).send({ error: "login required" });
    try {
      await switchAccount(login.trim());
      return { ok: true, accounts: await listAccounts() };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  /* ------------------------------------------------------------------ auth */

  app.get("/api/auth/me", async (req) => ({
    user: currentUser(req),
    needsBootstrap: (await countUsers()) === 0,
  }));

  /** First run only. Once an account exists this is closed for good. */
  app.post("/api/auth/bootstrap", async (req, reply) => {
    if ((await countUsers()) > 0) return reply.code(409).send({ error: "already initialised" });
    const body = (req.body ?? {}) as { email?: string; name?: string; password?: string };
    const email = (body.email ?? "").trim();
    const name = (body.name ?? "").trim();
    const password = body.password ?? "";
    const problem = credentialProblem(email, name, password);
    if (problem) return reply.code(400).send({ error: problem });

    const user = await createUser(email, name, password);
    await ensurePersonalWorkspace(user.id, `${name} workspace`);
    // Existing projects predate accounts; claim them so nothing disappears.
    await backfillOrphanProjects();

    const { token } = await createSession(user.id);
    reply.header("set-cookie", sessionCookie(token));
    return { user: toUser(user) };
  });

  app.post("/api/auth/login", async (req, reply) => {
    const body = (req.body ?? {}) as { email?: string; password?: string };
    const row = await findUserByEmail(body.email ?? "");
    // Verify against a dummy when the account is missing, so a wrong email and a
    // wrong password take a similar amount of time.
    const ok = row
      ? verifyPassword(body.password ?? "", row.password_hash)
      : verifyPassword(body.password ?? "", "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
    if (!row || !ok) return reply.code(401).send({ error: "invalid email or password" });
    const { token } = await createSession(row.id);
    reply.header("set-cookie", sessionCookie(token));
    return { user: toUser(row) };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (token) await destroySession(token);
    reply.header("set-cookie", clearedCookie());
    return { ok: true };
  });

  /**
   * Additional accounts are created by an existing member, never by an open
   * register endpoint: this is a local app, and an open /register would let any
   * local process mint an identity.
   */
  app.post("/api/auth/users", async (req, reply) => {
    const actor = currentUser(req)!;
    const body = (req.body ?? {}) as { email?: string; name?: string; password?: string };
    const email = (body.email ?? "").trim();
    const name = (body.name ?? "").trim();
    const password = body.password ?? "";
    const problem = credentialProblem(email, name, password);
    if (problem) return reply.code(400).send({ error: problem });
    if (!(await listWorkspacesForUser(actor.id)).some((w) => w.role === "owner")) {
      return reply.code(403).send({ error: "only a workspace owner may create accounts" });
    }
    if (await findUserByEmail(email)) return reply.code(409).send({ error: "email already registered" });
    return { user: toUser(await createUser(email, name, password)) };
  });

  /* ------------------------------------------------------------ workspaces */

  app.get("/api/workspaces", async (req) => listWorkspacesForUser(currentUser(req)!.id));

  app.post("/api/workspaces", async (req, reply) => {
    const user = currentUser(req)!;
    const { name } = (req.body ?? {}) as { name?: string };
    const workspace = await createWorkspace((name ?? "").trim() || "Workspace", user.id);
    await addMember(workspace.id, user.id, "owner");
    reply.code(201);
    return toWorkspace(workspace, "owner");
  });

  app.get("/api/workspaces/:wid/members", async (req, reply) => {
    const user = currentUser(req)!;
    const { wid } = req.params as { wid: string };
    if (!(await hasWorkspaceRole(user.id, wid, "viewer"))) {
      return reply.code(404).send({ error: "workspace not found" });
    }
    return (await listMembers(wid)).map((m) => ({
      id: m.id,
      email: m.email,
      name: m.name,
      role: m.role,
      createdAt: m.created_at,
    }));
  });

  app.post("/api/workspaces/:wid/members", async (req, reply) => {
    const user = currentUser(req)!;
    const { wid } = req.params as { wid: string };
    if (!(await hasWorkspaceRole(user.id, wid, "owner"))) {
      return reply.code(404).send({ error: "workspace not found" });
    }
    const { email, role } = (req.body ?? {}) as { email?: string; role?: string };
    if (!isRole(role)) return reply.code(400).send({ error: "role must be viewer, editor or owner" });
    const target = await findUserByEmail(email ?? "");
    if (!target) return reply.code(404).send({ error: "no account with that email" });
    await addMember(wid, target.id, role);
    return { ok: true };
  });

  app.patch("/api/workspaces/:wid/members/:uid", async (req, reply) => {
    const user = currentUser(req)!;
    const { wid, uid } = req.params as { wid: string; uid: string };
    if (!(await hasWorkspaceRole(user.id, wid, "owner"))) {
      return reply.code(404).send({ error: "workspace not found" });
    }
    const { role } = (req.body ?? {}) as { role?: string };
    if (!isRole(role)) return reply.code(400).send({ error: "invalid role" });
    // A workspace must never reach zero owners or it becomes unadministrable.
    if (role !== "owner" && (await countOwners(wid)) <= 1) {
      const current = (await listMembers(wid)).find((m) => m.id === uid);
      if (current?.role === "owner") return reply.code(400).send({ error: "workspace needs an owner" });
    }
    await setMemberRole(wid, uid, role);
    return { ok: true };
  });

  app.delete("/api/workspaces/:wid/members/:uid", async (req, reply) => {
    const user = currentUser(req)!;
    const { wid, uid } = req.params as { wid: string; uid: string };
    if (!(await hasWorkspaceRole(user.id, wid, "owner"))) {
      return reply.code(404).send({ error: "workspace not found" });
    }
    const current = (await listMembers(wid)).find((m) => m.id === uid);
    if (current?.role === "owner" && (await countOwners(wid)) <= 1) {
      return reply.code(400).send({ error: "workspace needs an owner" });
    }
    await removeMember(wid, uid);
    return { ok: true };
  });

  /* -------------------------------------------------------------- projects */

  app.get("/api/projects", async (req) => {
    const user = currentUser(req)!;
    const { workspaceId } = req.query as { workspaceId?: string };
    const all = await listProjectsForUser(user.id);
    if (!workspaceId) return all;
    if (!(await hasWorkspaceRole(user.id, workspaceId, "viewer"))) return [];
    return all.filter((p) => p.workspaceId === workspaceId);
  });

  /**
   * A new project is either a scaffold (a brand-new app) or an existing
   * repository opened at a base branch to work on a feature inside it. The
   * repository form clones and installs, so it can take a minute or two.
   */
  app.post("/api/projects", async (req, reply) => {
    const user = currentUser(req)!;
    const body = (req.body ?? {}) as {
      name?: string;
      workspaceId?: string;
      repo?: string;
      baseBranch?: string;
      /** "mobile" for an Expo app; anything else is the web scaffold. */
      kind?: string;
    };
    const workspaceId = body.workspaceId ?? "";
    if (!(await hasWorkspaceRole(user.id, workspaceId, "editor"))) {
      return reply.code(404).send({ error: "workspace not found" });
    }

    if (body.repo !== undefined) {
      const repo = body.repo.trim();
      const baseBranch = (body.baseBranch ?? "").trim();
      if (!REPO_SLUG.test(repo)) return reply.code(400).send({ error: "repo must be owner/name" });
      if (!baseBranch || /\s/.test(baseBranch)) return reply.code(400).send({ error: "a base branch is required" });
      if (!(await hasGh())) return reply.code(503).send({ error: "gh CLI is not available" });
      const name = (body.name ?? "").trim() || repo.split("/")[1];
      try {
        const project = await createProjectFromRepo({ name, workspaceId, createdBy: user.id, repo, baseBranch });
        await addMessage(
          project.id,
          "system",
          `Opened ${repo} at ${baseBranch} on branch ${project.mirrorBranch}. Pull requests go into ${baseBranch}.`,
        );
        reply.code(201);
        return project;
      } catch (err) {
        return reply.code(502).send({ error: (err as Error).message });
      }
    }

    const name = (body.name ?? "").trim() || "Untitled";
    const kind = body.kind === "mobile" ? "mobile" : "scaffold";
    const project = await createProject(name, workspaceId, user.id, kind);
    reply.code(201);
    return project;
  });

  app.get("/api/projects/:id", async (req, reply) => {
    const user = currentUser(req)!;
    const { id } = req.params as { id: string };
    const project = await requireProjectAccess(user.id, id, "viewer");
    if (!project) return reply.code(404).send({ error: "project not found" });
    return {
      project,
      previewUrl: previewUrlFor(id),
      messages: await listMessages(id),
      edits: await listEdits(id),
    };
  });

  app.delete("/api/projects/:id", async (req, reply) => {
    const user = currentUser(req)!;
    const { id } = req.params as { id: string };
    // Destroys files on disk, so it is an owner action rather than an editor one.
    if (!(await requireProjectAccess(user.id, id, "owner"))) {
      return reply.code(404).send({ error: "project not found" });
    }
    return { ok: await deleteProject(id) };
  });

  app.get("/api/projects/:id/files", async (req, reply) => {
    const user = currentUser(req)!;
    const { id } = req.params as { id: string };
    const project = await requireProjectAccess(user.id, id, "viewer");
    if (!project) return reply.code(404).send({ error: "project not found" });
    return fileTree(project.dir);
  });

  app.get("/api/projects/:id/file", async (req, reply) => {
    const user = currentUser(req)!;
    const { id } = req.params as { id: string };
    const { path: rel } = req.query as { path?: string };
    const project = await requireProjectAccess(user.id, id, "viewer");
    if (!project) return reply.code(404).send({ error: "project not found" });
    if (!rel) return reply.code(400).send({ error: "path required" });
    try {
      return { path: rel, content: await readProjectFile(project.dir, rel) };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  /** Boot (or reuse) the project's dev server and return its URL for the preview iframe. */
  app.post("/api/projects/:id/preview", async (req, reply) => {
    const user = currentUser(req)!;
    const { id } = req.params as { id: string };
    const project = await requireProjectAccess(user.id, id, "editor");
    if (!project) return reply.code(404).send({ error: "project not found" });
    try {
      const { url, port, device } = await ensureDevServer(project);
      // Persist the port so a restarted orchestrator can re-adopt this server
      // instead of starting a second one.
      if (project.port !== port) await setPort(id, port);
      if (project.kind !== "mobile") return { url, device: null };
      // The phone needs the LAN link and the account Expo Go must match.
      return { url, device: { url: device, account: await expoAccount(project.dir) } };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  /* -------------------------------------------------------------- release */

  /** The store identity of a mobile project, and the Expo account the CLI runs as. */
  app.get("/api/projects/:id/release", async (req, reply) => {
    const user = currentUser(req)!;
    const { id } = req.params as { id: string };
    const project = await requireProjectAccess(user.id, id, "viewer");
    if (!project) return reply.code(404).send({ error: "project not found" });
    if (project.kind !== "mobile") return reply.code(400).send({ error: "only mobile apps are released to the stores" });
    try {
      return { ...(await readIdentity(project.dir)), account: await expoAccount(project.dir) };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  /**
   * The bundle id and package name, recorded in app.json and committed as a
   * version of its own. Chosen once: the stores treat a changed id as a
   * different app.
   */
  app.post("/api/projects/:id/release/identity", async (req, reply) => {
    const user = currentUser(req)!;
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { bundleId?: string; packageName?: string };
    const project = await requireProjectAccess(user.id, id, "editor");
    if (!project) return reply.code(404).send({ error: "project not found" });
    if (project.kind !== "mobile") return reply.code(400).send({ error: "only mobile apps are released to the stores" });
    const bundleId = (body.bundleId ?? "").trim();
    const packageName = (body.packageName ?? "").trim() || bundleId;
    if (!bundleId) return reply.code(400).send({ error: "a bundle id is required" });
    try {
      const identity = await runExclusive(id, () => {}, async () => {
        const next = await setIdentity(project.dir, { bundleId, packageName });
        const commit = await commitAll(project.dir, "Set the store identifiers");
        if (commit) await addEdit(id, commit, "Set the store identifiers");
        return next;
      });
      return { ...identity, account: await expoAccount(project.dir) };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  /**
   * Queue EAS cloud builds and, when asked, their store submissions. Returns as
   * soon as EAS has accepted them; the builds themselves take minutes and are
   * read back through the releases list.
   */
  app.post("/api/projects/:id/release", async (req, reply) => {
    const user = currentUser(req)!;
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { platform?: string; profile?: string; submit?: boolean };
    const project = await requireProjectAccess(user.id, id, "editor");
    if (!project) return reply.code(404).send({ error: "project not found" });
    if (project.kind !== "mobile") return reply.code(400).send({ error: "only mobile apps are released to the stores" });
    const platform = body.platform as ReleasePlatform;
    const profile = body.profile as ReleaseProfile;
    if (!["ios", "android", "all"].includes(platform)) return reply.code(400).send({ error: "platform must be ios, android or all" });
    if (!["preview", "production"].includes(profile)) return reply.code(400).send({ error: "profile must be preview or production" });
    const submit = Boolean(body.submit);

    try {
      const identity = await readIdentity(project.dir);
      if (!identity.bundleId || !identity.packageName) {
        return reply.code(400).send({ error: "set the app's bundle id and package name first" });
      }
      if (!(await expoAccount(project.dir))) {
        return reply.code(400).send({ error: "sign in to Expo first: run `npx expo login` in a terminal, then try again" });
      }
      const releases = await runExclusive(id, () => {}, async () => {
        // Linking writes the project id into app.json; keep that as a version.
        if (!identity.projectId) {
          await ensureEasProject(project.dir);
          const commit = await commitAll(project.dir, "Link the EAS project");
          if (commit) await addEdit(id, commit, "Link the EAS project");
        }
        const builds = await startBuilds(project.dir, { platform, profile, submit });
        for (const build of builds) {
          await addRelease(id, {
            buildId: build.id,
            platform: build.platform,
            profile,
            status: build.status,
            submit,
            artifactUrl: build.artifactUrl,
            logUrl: build.logUrl,
            error: build.error,
          });
        }
        const noun = builds.length === 1 ? "build" : "builds";
        await addMessage(
          id,
          "system",
          `Queued ${builds.length} EAS ${profile} ${noun}${submit ? " with store submission" : ""}`,
        );
        return listReleases(id);
      });
      return releases;
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  /** Builds queued from this project; `refresh=1` re-reads the unfinished ones from EAS. */
  app.get("/api/projects/:id/releases", async (req, reply) => {
    const user = currentUser(req)!;
    const { id } = req.params as { id: string };
    const { refresh } = req.query as { refresh?: string };
    const project = await requireProjectAccess(user.id, id, "viewer");
    if (!project) return reply.code(404).send({ error: "project not found" });
    let list = await listReleases(id);
    if (refresh === "1") {
      const pending = list.filter((r) => !TERMINAL_STATUSES.has(r.status)).slice(0, 6);
      for (const r of pending) {
        try {
          const b = await buildStatus(project.dir, r.buildId);
          await updateRelease(r.id, { status: b.status, artifactUrl: b.artifactUrl, logUrl: b.logUrl, error: b.error });
        } catch {
          /* keep the last known state; EAS may be briefly unreachable */
        }
      }
      if (pending.length) list = await listReleases(id);
    }
    return list;
  });

  /* -------------------------------------------------------------- github */

  app.get("/api/projects/:id/github", async (req, reply) => {
    const user = currentUser(req)!;
    const { id } = req.params as { id: string };
    const project = await requireProjectAccess(user.id, id, "viewer");
    if (!project) return reply.code(404).send({ error: "project not found" });

    if (!(await hasGh())) {
      return { available: false, account: null, connected: false, pushOnPublish: project.pushOnPublish };
    }
    const account = await ghAccount();
    const state = await repoState(project.dir, {
      repo: project.repo,
      base: project.baseBranch,
      mirror: project.mirrorBranch,
    });
    return {
      available: true,
      account: account.account ?? null,
      ...state,
      pushOnPublish: project.pushOnPublish,
    };
  });

  app.post("/api/projects/:id/github/connect", async (req, reply) => {
    const user = currentUser(req)!;
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as {
      mode?: "new" | "existing";
      name?: string;
      private?: boolean;
      remote?: string;
    };
    // Connecting acts through the single shared server-side `gh` credential, so
    // it can reach any repository that account can see. Owner, not editor.
    const project = await requireProjectAccess(user.id, id, "owner");
    if (!project) return reply.code(404).send({ error: "project not found" });
    if (project.kind === "repo") {
      return reply.code(400).send({ error: "this project was opened from a repository and is already connected" });
    }

    try {
      const mirror = project.mirrorBranch ?? MIRROR_BRANCH;
      const state =
        body.mode === "existing"
          ? await connectExisting(project.dir, (body.remote ?? "").trim(), mirror)
          : await connectNew(project.dir, (body.name ?? "").trim(), body.private !== false, mirror);
      await setRepo(id, state.repo ?? null, state.baseBranch ?? null);
      await addMessage(id, "system", `Connected to GitHub: ${state.repo}`);
      return state;
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  app.post("/api/projects/:id/github/sync", async (req, reply) => {
    const user = currentUser(req)!;
    const { id } = req.params as { id: string };
    const project = await requireProjectAccess(user.id, id, "editor");
    if (!project) return reply.code(404).send({ error: "project not found" });
    if (!project.repo) return reply.code(400).send({ error: "project is not connected to GitHub" });
    try {
      return await syncProject(project.dir, project.mirrorBranch ?? MIRROR_BRANCH);
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  app.post("/api/projects/:id/github/pr", async (req, reply) => {
    const user = currentUser(req)!;
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { title?: string; body?: string };
    const project = await requireProjectAccess(user.id, id, "editor");
    if (!project) return reply.code(404).send({ error: "project not found" });
    if (!project.repo) return reply.code(400).send({ error: "project is not connected to GitHub" });
    try {
      const mirror = project.mirrorBranch ?? MIRROR_BRANCH;
      const state = await repoState(project.dir, {
        repo: project.repo,
        base: project.baseBranch,
        mirror,
      });
      const baseBranch = state.baseBranch ?? project.baseBranch ?? "main";
      if (!state.baseBranch || project.baseBranch !== baseBranch) await setRepo(id, project.repo, baseBranch);
      await syncProject(project.dir, mirror);
      const pr = await createPr(project.dir, {
        mirror,
        baseBranch,
        title: body.title?.trim() || `${project.name}: changes from the agent`,
        body: body.body?.trim() || "Opened from Runner Builder.",
      });
      if (!pr.existing) await addMessage(id, "system", `Opened pull request #${pr.number}`);
      return pr;
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  /** Branches a pull request from this project could target. */
  app.get("/api/projects/:id/github/branches", async (req, reply) => {
    const user = currentUser(req)!;
    const { id } = req.params as { id: string };
    const project = await requireProjectAccess(user.id, id, "viewer");
    if (!project) return reply.code(404).send({ error: "project not found" });
    if (!project.repo) return reply.code(400).send({ error: "project is not connected to GitHub" });
    try {
      return await listBranches(project.repo);
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  /**
   * Per-project GitHub settings. Each field is optional and only a supplied
   * field changes, so the two controls in the dialog can save independently.
   * The base branch is where pull requests (and push-on-publish) land — for a
   * Runner repository that is `staging`, not the default branch.
   */
  app.post("/api/projects/:id/github/settings", async (req, reply) => {
    const user = currentUser(req)!;
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { pushOnPublish?: boolean; baseBranch?: string };
    const project = await requireProjectAccess(user.id, id, "editor");
    if (!project) return reply.code(404).send({ error: "project not found" });

    if (body.baseBranch !== undefined) {
      const base = body.baseBranch.trim();
      if (!base || /\s/.test(base)) return reply.code(400).send({ error: "invalid branch name" });
      if (!project.repo) return reply.code(400).send({ error: "project is not connected to GitHub" });
      await setRepo(id, project.repo, base);
    }
    if (body.pushOnPublish !== undefined) await setPushOnPublish(id, Boolean(body.pushOnPublish));

    const updated = (await requireProjectAccess(user.id, id, "viewer"))!;
    return { pushOnPublish: updated.pushOnPublish, baseBranch: updated.baseBranch };
  });

  app.delete("/api/projects/:id/github", async (req, reply) => {
    const user = currentUser(req)!;
    const { id } = req.params as { id: string };
    const project = await requireProjectAccess(user.id, id, "owner");
    if (!project) return reply.code(404).send({ error: "project not found" });
    // A project opened from a repository *is* that repository's checkout;
    // detaching it would leave a clone that can no longer go anywhere.
    if (project.kind === "repo") {
      return reply.code(400).send({ error: "a repository project cannot be disconnected; delete it instead" });
    }
    // Detach locally only; the repository itself is left alone.
    await git(project.dir, ["remote", "remove", "origin"]).catch(() => "");
    await setRepo(id, null, null);
    await setPushOnPublish(id, false);
    return { ok: true };
  });

  app.post("/api/projects/:id/publish", async (req, reply) => {
    const user = currentUser(req)!;
    const { id } = req.params as { id: string };
    const project = await requireProjectAccess(user.id, id, "editor");
    if (!project) return reply.code(404).send({ error: "project not found" });
    try {
      const result = await buildProject(project.dir);
      await addMessage(id, "system", `Published a production build to ${result.output}`);

      // Optional: also land the current state on the repo's default branch.
      if (project.repo && project.pushOnPublish && project.baseBranch) {
        try {
          await pushToDefault(project.dir, project.baseBranch);
          await addMessage(id, "system", `Pushed to ${project.repo}@${project.baseBranch}`);
        } catch (err) {
          return reply.code(200).send({ ...result, pushError: (err as Error).message });
        }
      }
      return result;
    } catch (err) {
      const log = (err as { log?: string }).log ?? "";
      return reply.code(500).send({ error: (err as Error).message, log });
    }
  });

  app.post("/api/projects/:id/revert", async (req, reply) => {
    const user = currentUser(req)!;
    const { id } = req.params as { id: string };
    const { editId } = (req.body ?? {}) as { editId?: string };
    const project = await requireProjectAccess(user.id, id, "editor");
    if (!project) return reply.code(404).send({ error: "project not found" });
    const edit = editId ? await getEdit(editId) : null;
    // The edit must belong to *this* project, otherwise a member of one workspace
    // could revert another workspace's project by guessing an edit id.
    if (!edit || edit.projectId !== id || !edit.commitSha) {
      return reply.code(400).send({ error: "edit has no commit" });
    }
    await revertTo(project.dir, edit.commitSha);
    await addMessage(id, "system", `Reverted to: ${edit.summary}`);
    return { ok: true };
  });

  /**
   * Start one agent turn and stream it as Server-Sent Events.
   * One turn = one git commit = one `edits` row.
   *
   * Turns on a project run one at a time: a request that arrives while another
   * turn is running waits (and says so) rather than running a second codex over
   * the same working tree. Closing the stream — the Stop button, or a closed
   * tab — terminates the running codex.
   */
  app.post("/api/projects/:id/turn", async (req, reply) => {
    const user = currentUser(req)!;
    const { id } = req.params as { id: string };
    const { prompt: rawPrompt } = (req.body ?? {}) as { prompt?: string };
    const project = await requireProjectAccess(user.id, id, "editor");
    if (!project) return reply.code(404).send({ error: "project not found" });
    const prompt = (rawPrompt ?? "").trim();
    if (!prompt) return reply.code(400).send({ error: "prompt required" });

    const turnId = crypto.randomUUID();
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (e: TurnEvent) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(": ping\n\n");
    }, 15_000);

    // The client going away is the stop signal. Firing after a normal end is
    // harmless: nothing listens any more.
    const stopper = new AbortController();
    res.on("close", () => stopper.abort());

    send({ type: "turn.started", projectId: id, turnId });

    // Get the preview up in parallel; a failure here must not kill the turn.
    ensureDevServer(project)
      .then(async ({ port }) => {
        if (project.port !== port) await setPort(id, port);
      })
      .catch((err) =>
        send({ type: "agent.tool", name: "preview", detail: `dev server failed: ${err.message}` }),
      );

    await runExclusive(
      id,
      (ahead) => send({ type: "turn.queued", projectId: id, turnId, ahead }),
      async () => {
        // Left while waiting: nothing was written, so there is nothing to record.
        if (stopper.signal.aborted) return;

        // History is read only now, so a queued turn sees the turn before it.
        const history = (await listMessages(id)).map((m) => ({ role: m.role, content: m.content }));
        await addMessage(id, "user", prompt);

        // When connected, the agent may use `gh` itself. The token is injected
        // into the child env (the macOS keychain is unreachable inside the
        // sandbox) and is never logged or persisted.
        const mirror = project.mirrorBranch ?? MIRROR_BRANCH;
        const github = project.repo
          ? {
              repo: project.repo,
              mirrorBranch: mirror,
              baseBranch: project.baseBranch ?? "main",
            }
          : null;
        const extraEnv: NodeJS.ProcessEnv = {};
        if (github) {
          const token = await ghToken();
          if (token) extraEnv.GH_TOKEN = token;
        }

        // The app brief is the agent's memory of the whole app; a repository
        // has its own instruction files instead.
        const brief = project.kind === "repo" ? null : await readBrief(project.dir);
        const run = (text: string) =>
          runCodex({
            dir: project.dir,
            prompt: buildPrompt(history, text, { kind: project.kind, github }, MEMPALACE_ENABLED, brief),
            onEvent: send,
            extraEnv,
            network: Boolean(github),
            memory: MEMPALACE_ENABLED,
            signal: stopper.signal,
          }).catch((err): Awaited<ReturnType<typeof runCodex>> => ({
            ok: false,
            summary: "",
            error: (err as Error).message,
          }));

        let result = await run(prompt);

        // A mobile turn is type-checked before it is reported as done. The agent
        // gets one chance to fix what it broke, inside the same turn and the same
        // commit, so the person sees a working app rather than a red screen.
        if (result.ok) {
          const check = await selfCheck(project.dir, project.kind);
          if (!check.skipped && check.ok) {
            send({ type: "agent.tool", name: "check", detail: "Type check passed" });
          } else if (!check.skipped) {
            send({ type: "agent.tool", name: "check", detail: "Type check failed; the agent is fixing it" });
            const fix = await run(fixPrompt(check.output));
            if (fix.stopped) {
              result = fix;
            } else {
              const again = await selfCheck(project.dir, project.kind);
              const passed = again.ok || Boolean(again.skipped);
              send({
                type: "agent.tool",
                name: "check",
                detail: passed ? "Type check passed after the fix" : "Type check still fails",
              });
              if (!passed) {
                await addMessage(id, "system", `The type check still fails after one fix:\n${again.output.slice(-1500)}`);
              }
              if (fix.ok && fix.summary) result = { ...result, summary: `${result.summary}\n\n${fix.summary}`.trim() };
            }
          }
        }

        if (result.stopped) {
          // Whatever codex had written before it was terminated is kept as its
          // own version, so it stays revertable instead of leaking into the
          // next turn's commit.
          const excerpt = prompt.length > 60 ? `${prompt.slice(0, 57)}…` : prompt;
          const commit = await commitAll(project.dir, `Stopped: ${excerpt}`);
          if (commit) {
            const editId = await addEdit(id, commit, `Stopped: ${excerpt}`);
            await addMessage(id, "agent", "Stopped before finishing. The partial changes are kept as a version you can revert.", editId);
          } else {
            await addMessage(id, "system", "Stopped before any files changed.");
          }
          return;
        }

        if (!result.ok) {
          await addMessage(id, "system", `Turn failed: ${result.error ?? "unknown error"}`);
          send({ type: "turn.failed", turnId, error: result.error ?? "unknown error" });
          return;
        }

        const summary = result.summary || "Agent edit";
        const commit = await commitAll(project.dir, summary);
        const editId = await addEdit(id, commit, summary);
        await addMessage(id, "agent", summary, editId);

        // Mirror to GitHub after every turn. Never moves HEAD, so the preview is
        // unaffected; a failure here must not fail the turn. A repository
        // project also gets its pull request opened the first time there is
        // something to review, so the person never has to ask for the branch.
        if (project.repo && commit) {
          try {
            await syncProject(project.dir, mirror);
            send({ type: "agent.tool", name: "github", detail: `synced to ${project.repo}` });
            if (project.kind === "repo") {
              const pr = await createPr(project.dir, {
                mirror,
                baseBranch: project.baseBranch ?? "main",
                title: project.name,
                body:
                  `Opened by Runner Builder from the project "${project.name}".\n\n` +
                  `Every agent turn is committed and pushed to \`${mirror}\`. Request changes ` +
                  "here and send them back to the project as new turns.",
              });
              if (!pr.existing) await addMessage(id, "system", `Opened pull request #${pr.number}: ${pr.url}`);
              send({ type: "agent.tool", name: "github", detail: `pull request #${pr.number} ${pr.url}` });
            }
          } catch (err) {
            send({
              type: "agent.tool",
              name: "github",
              detail: `sync failed: ${(err as Error).message}`.slice(0, 200),
            });
          }
        }

        send({ type: "turn.completed", turnId, editId, commit });
      },
    );

    clearInterval(heartbeat);
    return res.end();
  });
}
