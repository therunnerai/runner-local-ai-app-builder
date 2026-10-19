import crypto from "node:crypto";
import { getStore, now, toProject, toWorkspace, type MembershipRow, type ProjectRow, type UserRow, type WorkspaceRow } from "./db.ts";
import { hashPassword } from "./auth.ts";

/**
 * Users, workspaces and memberships.
 *
 * A workspace is the tenant: every project belongs to exactly one, and access is
 * decided by a `(workspace_id, user_id, role)` row. Enforcement lives here and on
 * the server only — the client is never trusted to name the workspace it may read.
 */

export type Role = MembershipRow["role"];

/** Higher outranks lower; comparisons are `rank(actual) >= rank(required)`. */
export const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };
export const ROLES: Role[] = ["viewer", "editor", "owner"];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as string[]).includes(value);
}

/* -------------------------------------------------------------------- users */

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function countUsers(): Promise<number> {
  const store = await getStore();
  const row = (await store.get<{ n: number }>("SELECT COUNT(*) AS n FROM users"))!;
  return row.n;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const store = await getStore();
  return (await store.get<UserRow>("SELECT * FROM users WHERE email = ?", [normalizeEmail(email)])) ?? null;
}

export async function getUser(id: string): Promise<UserRow | null> {
  const store = await getStore();
  return (await store.get<UserRow>("SELECT * FROM users WHERE id = ?", [id])) ?? null;
}

export async function createUser(email: string, name: string, password: string): Promise<UserRow> {
  const user: UserRow = {
    id: crypto.randomUUID(),
    email: normalizeEmail(email),
    name: name.trim(),
    password_hash: hashPassword(password),
    created_at: now(),
  };
  const store = await getStore();
  await store.run("INSERT INTO users (id,email,name,password_hash,created_at) VALUES (?,?,?,?,?)", [
    user.id,
    user.email,
    user.name,
    user.password_hash,
    user.created_at,
  ]);
  return user;
}

/* --------------------------------------------------------------- workspaces */

export async function createWorkspace(name: string, createdBy: string): Promise<WorkspaceRow> {
  const workspace: WorkspaceRow = {
    id: crypto.randomUUID(),
    name: name.trim() || "Workspace",
    created_by: createdBy,
    created_at: now(),
  };
  const store = await getStore();
  await store.run("INSERT INTO workspaces (id,name,created_by,created_at) VALUES (?,?,?,?)", [
    workspace.id,
    workspace.name,
    workspace.created_by,
    workspace.created_at,
  ]);
  return workspace;
}

export async function getWorkspace(id: string): Promise<WorkspaceRow | null> {
  const store = await getStore();
  return (await store.get<WorkspaceRow>("SELECT * FROM workspaces WHERE id = ?", [id])) ?? null;
}

export async function addMember(workspaceId: string, userId: string, role: Role): Promise<void> {
  const store = await getStore();
  await store.run(
    "INSERT INTO memberships (workspace_id,user_id,role,created_at) VALUES (?,?,?,?) " +
      "ON CONFLICT (workspace_id,user_id) DO UPDATE SET role = excluded.role",
    [workspaceId, userId, role, now()],
  );
}

export async function getMembership(workspaceId: string, userId: string): Promise<MembershipRow | null> {
  const store = await getStore();
  return (
    (await store.get<MembershipRow>("SELECT * FROM memberships WHERE workspace_id = ? AND user_id = ?", [
      workspaceId,
      userId,
    ])) ?? null
  );
}

/** Every workspace the user belongs to, each carrying the caller's own role. */
export async function listWorkspacesForUser(userId: string) {
  const store = await getStore();
  const rows = await store.all<WorkspaceRow & { member_role: Role }>(
    `SELECT w.*, m.role AS member_role
       FROM workspaces w
       JOIN memberships m ON m.workspace_id = w.id
      WHERE m.user_id = ?
      ORDER BY w.created_at ASC`,
    [userId],
  );
  return rows.map((r) => toWorkspace(r, r.member_role));
}

export async function listMembers(workspaceId: string) {
  const store = await getStore();
  return store.all<{ id: string; email: string; name: string; role: Role; created_at: number }>(
    `SELECT u.id, u.email, u.name, m.role, m.created_at
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = ?
      ORDER BY m.created_at ASC`,
    [workspaceId],
  );
}

export async function setMemberRole(workspaceId: string, userId: string, role: Role): Promise<void> {
  const store = await getStore();
  await store.run("UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = ?", [role, workspaceId, userId]);
}

export async function removeMember(workspaceId: string, userId: string): Promise<void> {
  const store = await getStore();
  await store.run("DELETE FROM memberships WHERE workspace_id = ? AND user_id = ?", [workspaceId, userId]);
}

export async function countOwners(workspaceId: string): Promise<number> {
  const store = await getStore();
  const row = (await store.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM memberships WHERE workspace_id = ? AND role = 'owner'",
    [workspaceId],
  ))!;
  return row.n;
}

/** The first workspace a user ever gets, created on bootstrap. */
export async function ensurePersonalWorkspace(userId: string, name: string): Promise<WorkspaceRow> {
  const existing = await listWorkspacesForUser(userId);
  if (existing.length > 0) return (await getWorkspace(existing[0].id))!;
  const workspace = await createWorkspace(name, userId);
  await addMember(workspace.id, userId, "owner");
  return workspace;
}

/* ------------------------------------------------------- access assertions */

export async function hasWorkspaceRole(userId: string, workspaceId: string, min: Role): Promise<boolean> {
  const membership = await getMembership(workspaceId, userId);
  if (!membership) return false;
  return ROLE_RANK[membership.role] >= ROLE_RANK[min];
}

/**
 * Resolve a project through its workspace and check the caller's role.
 *
 * Returns null for both "no such project" and "not a member": the caller answers
 * 404 either way, so a probe cannot tell a hidden project from a missing one.
 */
export async function requireProjectAccess(userId: string, projectId: string, min: Role) {
  const store = await getStore();
  const row = await store.get<ProjectRow>("SELECT * FROM projects WHERE id = ?", [projectId]);
  if (!row) return null;
  const project = toProject(row);
  if (!project.workspaceId) return null;
  return (await hasWorkspaceRole(userId, project.workspaceId, min)) ? project : null;
}

/**
 * Attach any project that predates accounts to the earliest user's workspace.
 *
 * Without this, switching the project list to a workspace-scoped query would
 * make every existing project disappear. Idempotent, and deliberately outside
 * the schema change so a failure here cannot roll back the tables.
 */
export async function backfillOrphanProjects(): Promise<number> {
  const store = await getStore();
  const orphaned = (await store.get<{ n: number }>("SELECT COUNT(*) AS n FROM projects WHERE workspace_id IS NULL"))!.n;
  if (!orphaned) return 0;

  const owner = await store.get<UserRow>("SELECT * FROM users ORDER BY created_at ASC LIMIT 1");
  if (!owner) return 0; // no accounts yet: the bootstrap flow will claim them

  const workspace = await ensurePersonalWorkspace(owner.id, `${owner.name || "My"} workspace`);
  await store.run(
    "UPDATE projects SET workspace_id = ?, created_by = COALESCE(created_by, ?) WHERE workspace_id IS NULL",
    [workspace.id, owner.id],
  );
  return orphaned;
}
