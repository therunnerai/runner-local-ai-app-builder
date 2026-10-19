import type {
  AgentProvider,
  AgentsInfo,
  AuthState,
  FileNode,
  GithubState,
  PreviewInfo,
  Project,
  ProjectDetail,
  Release,
  ReleaseConfig,
  TurnEvent,
  User,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
} from "@runner-builder/shared";

const BASE = "/api";

/**
 * One place where a session-expiry is noticed. `fetch` already defaults to
 * `credentials: "same-origin"`, so the cookie flows without extra headers —
 * but a 401 still has to send the user to the login screen, and doing that at
 * every call site would be a bug waiting to happen.
 */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, { credentials: "same-origin", ...init });
  if (res.status === 401) {
    onUnauthorized?.();
    throw new Error("Your session has expired. Please sign in again.");
  }
  return res;
}

async function ok<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body?.error ?? detail;
    } catch {
      /* non-JSON error */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body ?? {}),
});

/* ------------------------------------------------------------------- auth */

export const me = () => req("/auth/me").then(ok<AuthState>);

export const bootstrap = (body: { email: string; name: string; password: string }) =>
  req("/auth/bootstrap", json(body)).then(ok<{ user: User }>);

export const login = (body: { email: string; password: string }) =>
  req("/auth/login", json(body)).then(ok<{ user: User }>);

export const logout = () => req("/auth/logout", json({})).then(ok<{ ok: boolean }>);

export const createAccount = (body: { email: string; name: string; password: string }) =>
  req("/auth/users", json(body)).then(ok<{ user: User }>);

/* ------------------------------------------------------------- workspaces */

export const listWorkspaces = () => req("/workspaces").then(ok<Workspace[]>);

export const createWorkspace = (name: string) =>
  req("/workspaces", json({ name })).then(ok<Workspace>);

export const listMembers = (workspaceId: string) =>
  req(`/workspaces/${workspaceId}/members`).then(ok<WorkspaceMember[]>);

export const addMember = (workspaceId: string, email: string, role: WorkspaceRole) =>
  req(`/workspaces/${workspaceId}/members`, json({ email, role })).then(ok<{ ok: boolean }>);

export const setMemberRole = (workspaceId: string, userId: string, role: WorkspaceRole) =>
  req(`/workspaces/${workspaceId}/members/${userId}`, {
    ...json({ role }),
    method: "PATCH",
  }).then(ok<{ ok: boolean }>);

export const removeMember = (workspaceId: string, userId: string) =>
  req(`/workspaces/${workspaceId}/members/${userId}`, { method: "DELETE" }).then(
    ok<{ ok: boolean }>,
  );

/* ----------------------------------------------------------------- agents */

/** The coding-agent CLIs on this machine and the builder's default. */
export const getAgents = () => req("/agents").then(ok<AgentsInfo>);

/** Which agent a workspace's turns run on; null returns to the default. Owners only. */
export const setWorkspaceAgent = (workspaceId: string, agent: AgentProvider | null) =>
  req(`/workspaces/${workspaceId}`, { ...json({ agent }), method: "PATCH" }).then(ok<Workspace>);

/** Per-project choices; `reasoning: null` returns to the default effort for the project's kind. */
export const setProjectSettings = (id: string, settings: { reasoning?: string | null }) =>
  req(`/projects/${id}/settings`, { ...json(settings), method: "PATCH" }).then(ok<Project>);

/* --------------------------------------------------------------- projects */

export const listProjects = (workspaceId?: string) =>
  req(`/projects${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""}`).then(
    ok<Project[]>,
  );

/** A new app from a template: the web scaffold, or an Expo app for the phone. */
export const createProject = (name: string, workspaceId: string, kind: "scaffold" | "mobile" = "scaffold") =>
  req("/projects", json({ name, workspaceId, kind })).then(ok<Project>);

/**
 * Open an existing repository as a project. Clones and installs on the server,
 * so this takes a while; the dialog says so.
 */
export const openRepository = (body: {
  name: string;
  workspaceId: string;
  repo: string;
  baseBranch: string;
}) => req("/projects", json(body)).then(ok<Project>);

/* ----------------------------------------------------------- codex login */

export type CodexAccount = {
  connected: boolean;
  email: string | null;
  name: string | null;
  plan: string | null;
  mode: "chatgpt" | "api_key" | null;
  shared: boolean;
  loginInProgress: boolean;
  terminalLoginAvailable: boolean;
};

export type CodexLoginPrompt = { url: string; code: string; expiresInMinutes: number };

export const getCodex = () => req("/codex").then(ok<CodexAccount>);
export const startCodexLogin = () => post<CodexLoginPrompt>("/codex/login");
export const cancelCodexLogin = () => post<CodexAccount>("/codex/login/cancel");
export const logoutCodex = () => post<CodexAccount>("/codex/logout");
export const linkTerminalCodex = () => post<CodexAccount>("/codex/link");

/** Branches of any reachable repository, default first. */
export const listRepoBranches = (repo: string) =>
  req(`/github/branches?repo=${encodeURIComponent(repo)}`).then(ok<string[]>);

export const getProject = (id: string) => req(`/projects/${id}`).then(ok<ProjectDetail>);

export const deleteProject = (id: string) =>
  req(`/projects/${id}`, { method: "DELETE" }).then(ok<{ ok: boolean }>);

export const getFiles = (id: string) => req(`/projects/${id}/files`).then(ok<FileNode[]>);

export const getFile = (id: string, filePath: string) =>
  req(`/projects/${id}/file?path=${encodeURIComponent(filePath)}`).then(
    ok<{ path: string; content: string }>,
  );

export const ensurePreview = (id: string) =>
  req(`/projects/${id}/preview`, { method: "POST" }).then(ok<PreviewInfo>);

/* --------------------------------------------------------------- release */

export const getReleaseConfig = (id: string) => req(`/projects/${id}/release`).then(ok<ReleaseConfig>);

export const setReleaseIdentity = (id: string, body: { bundleId: string; packageName: string }) =>
  req(`/projects/${id}/release/identity`, json(body)).then(ok<ReleaseConfig>);

/** The App Store Connect app id an unattended iOS submission needs. */
export const setReleaseSubmission = (id: string, body: { ascAppId: string }) =>
  req(`/projects/${id}/release/submission`, json(body)).then(ok<ReleaseConfig>);

/** Queue EAS cloud builds; returns the project's releases including the new ones. */
export const startRelease = (
  id: string,
  body: { platform: "ios" | "android" | "all"; profile: "preview" | "production"; submit: boolean },
) => req(`/projects/${id}/release`, json(body)).then(ok<Release[]>);

export const listReleases = (id: string, refresh = false) =>
  req(`/projects/${id}/releases${refresh ? "?refresh=1" : ""}`).then(ok<Release[]>);

export const revertTo = (id: string, editId: string) =>
  req(`/projects/${id}/revert`, json({ editId })).then(ok<{ ok: boolean }>);

export const publishProject = (id: string) =>
  req(`/projects/${id}/publish`, { method: "POST" }).then(
    ok<{ ok: boolean; output: string; log: string; pushError?: string }>,
  );

/* ---------------------------------------------------------------- github */

const post = <T,>(url: string, body?: unknown) => req(url, json(body)).then(ok<T>);

export const getGithub = (id: string) => req(`/projects/${id}/github`).then(ok<GithubState>);

export const connectGithub = (
  id: string,
  body: { mode: "new" | "existing"; name?: string; private?: boolean; remote?: string },
) => post<GithubState>(`/projects/${id}/github/connect`, body);

export const syncGithub = (id: string) => post<GithubState>(`/projects/${id}/github/sync`);

export const createGithubPr = (id: string, body?: { title?: string; body?: string }) =>
  post<{ number: number; url: string; title: string; existing: boolean }>(
    `/projects/${id}/github/pr`,
    body,
  );

export const setGithubSettings = (
  id: string,
  settings: { pushOnPublish?: boolean; baseBranch?: string },
) =>
  post<{ pushOnPublish: boolean; baseBranch: string | null }>(
    `/projects/${id}/github/settings`,
    settings,
  );

/** Branches a pull request from this project could target, default first. */
export const listGithubBranches = (id: string) =>
  req(`/projects/${id}/github/branches`).then(ok<string[]>);

export const disconnectGithub = (id: string) =>
  req(`/projects/${id}/github`, { method: "DELETE" }).then(ok<{ ok: boolean }>);

export type RepoSummary = {
  nameWithOwner: string;
  description: string | null;
  isPrivate: boolean;
  updatedAt: string | null;
};

export type GhAccountInfo = { login: string; active: boolean; host: string };

/** Repositories the active `gh` account can reach, for the connect picker. */
export const listGithubRepos = () => req("/github/repos").then(ok<RepoSummary[]>);

export const listGithubAccounts = () => req("/github/accounts").then(ok<GhAccountInfo[]>);

/**
 * Switch which account `gh` acts as.
 * Machine-wide: this changes the active account for every `gh` command on the
 * computer, not just this app, so the UI states that before offering it.
 */
export const switchGithubAccount = (login: string) =>
  post<{ ok: boolean; accounts: GhAccountInfo[] }>("/github/accounts/switch", { login });

/**
 * Run one agent turn and stream its events.
 * Server-Sent Events over fetch, because EventSource cannot POST a body.
 */
export async function streamTurn(
  id: string,
  prompt: string,
  onEvent: (event: TurnEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await req(`/projects/${id}/turn`, {
    ...json({ prompt }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`turn failed to start (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as TurnEvent);
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}
