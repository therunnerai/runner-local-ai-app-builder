import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { DATABASE_URL, DB_PATH, HOME, LEGACY_DB_NAME, LEGACY_HOME } from "./config.ts";

const { Pool } = pg;

export type ProjectRow = {
  id: string;
  name: string;
  dir: string;
  port: number | null;
  created_at: number;
  updated_at: number;
  repo?: string | null;
  base_branch?: string | null;
  push_on_publish?: number | null;
  workspace_id?: string | null;
  created_by?: string | null;
  kind?: string | null;
  mirror_branch?: string | null;
  reasoning?: string | null;
};

export type MessageRow = {
  id: string;
  project_id: string;
  role: "user" | "agent" | "system";
  content: string;
  created_at: number;
  edit_id: string | null;
};

export type EditRow = {
  id: string;
  project_id: string;
  commit_sha: string | null;
  summary: string;
  created_at: number;
};

export type ReleaseRow = {
  id: string;
  project_id: string;
  build_id: string;
  platform: string;
  profile: string;
  status: string;
  submit: number;
  artifact_url: string | null;
  log_url: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
};

export type UserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: number;
};

export type SessionRow = {
  id: string;
  user_id: string;
  created_at: number;
  expires_at: number;
};

export type WorkspaceRow = {
  id: string;
  name: string;
  created_by: string;
  created_at: number;
  /** The coding-agent CLI this workspace's turns run on; null means the builder's default. */
  agent?: string | null;
};

export type MembershipRow = {
  workspace_id: string;
  user_id: string;
  role: "owner" | "editor" | "viewer";
  created_at: number;
};

/**
 * One store, two drivers. Every query is written once with `?` placeholders;
 * the Postgres driver rewrites them to `$1, $2, ...` (no `?` ever appears
 * inside a string literal here). SQLite is the default and keeps the data at
 * DB_PATH; `BUILDER_DATABASE_URL` selects Postgres.
 */
export interface Store {
  kind: "sqlite" | "postgres";
  run(sql: string, params?: unknown[]): Promise<void>;
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
}

function sqliteStore(db: DatabaseSync): Store {
  const args = (params: unknown[]) => params as SQLInputValue[];
  return {
    kind: "sqlite",
    async run(sql, params = []) {
      db.prepare(sql).run(...args(params));
    },
    async get<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).get(...args(params)) as T | undefined;
    },
    async all<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...args(params)) as T[];
    },
    async exec(sql) {
      db.exec(sql);
    },
  };
}

function postgresStore(pool: pg.Pool): Store {
  const numbered = (sql: string) => {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  };
  const query = (sql: string, params: unknown[]) => pool.query(numbered(sql), params as any[]);
  return {
    kind: "postgres",
    async run(sql, params = []) {
      await query(sql, params);
    },
    async get<T>(sql: string, params: unknown[] = []) {
      const { rows } = await query(sql, params);
      return rows[0] as T | undefined;
    },
    async all<T>(sql: string, params: unknown[] = []) {
      const { rows } = await query(sql, params);
      return rows as T[];
    },
    async exec(sql) {
      await pool.query(sql);
    },
  };
}

let store: Store | null = null;
let opening: Promise<Store> | null = null;

/** True for the process that moved a legacy data directory on this boot. */
export let legacyHomeAdopted = false;

/**
 * Move a pre-rename data directory under the new home, once. The database and
 * its WAL/shm companions are renamed together so SQLite replays the journal
 * against the right file; project rows are repointed below, after the schema
 * exists. Returns the old projects prefix when a move happened.
 */
function adoptLegacyHome(): string | null {
  if (process.env.BUILDER_HOME || existsSync(HOME) || !existsSync(LEGACY_HOME)) return null;
  renameSync(LEGACY_HOME, HOME);
  for (const suffix of ["", "-wal", "-shm"]) {
    const from = path.join(HOME, LEGACY_DB_NAME + suffix);
    if (existsSync(from)) renameSync(from, DB_PATH + suffix);
  }
  console.log(`[db] adopted ${LEGACY_HOME} as ${HOME}`);
  legacyHomeAdopted = true;
  return path.join(LEGACY_HOME, "projects") + path.sep;
}

/** Same tables and columns on both drivers; only the timestamp type differs. */
function schema(ts: "INTEGER" | "BIGINT"): string {
  return `
    CREATE TABLE IF NOT EXISTS projects (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      dir        TEXT NOT NULL,
      port       INTEGER,
      created_at ${ts} NOT NULL,
      updated_at ${ts} NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at ${ts} NOT NULL,
      edit_id    TEXT
    );
    CREATE TABLE IF NOT EXISTS edits (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      commit_sha TEXT,
      summary    TEXT NOT NULL,
      created_at ${ts} NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    ${ts} NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at ${ts} NOT NULL,
      expires_at ${ts} NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at ${ts} NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memberships (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role         TEXT NOT NULL,
      created_at   ${ts} NOT NULL,
      PRIMARY KEY (workspace_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS releases (
      id           TEXT PRIMARY KEY,
      project_id   TEXT NOT NULL,
      build_id     TEXT NOT NULL,
      platform     TEXT NOT NULL,
      profile      TEXT NOT NULL,
      status       TEXT NOT NULL,
      submit       INTEGER NOT NULL DEFAULT 0,
      artifact_url TEXT,
      log_url      TEXT,
      error        TEXT,
      created_at   ${ts} NOT NULL,
      updated_at   ${ts} NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_releases_project ON releases(project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_edits_project ON edits(project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
  `;
}

async function open(): Promise<Store> {
  let s: Store;
  let movedFrom: string | null = null;

  if (DATABASE_URL) {
    // Timestamps are BIGINT, which pg hands back as strings by default; the
    // row mappers expect numbers, as they get from SQLite.
    pg.types.setTypeParser(20, (v) => Number(v));
    s = postgresStore(new Pool({ connectionString: DATABASE_URL }));
  } else {
    // Legacy-home adoption only makes sense for the file the builder owns.
    movedFrom = adoptLegacyHome();
    mkdirSync(HOME, { recursive: true });
    const db = new DatabaseSync(DB_PATH);
    db.exec("PRAGMA journal_mode = WAL;");
    // Sessions and memberships depend on users and workspaces. A constraint the
    // engine silently ignores is worse than no constraint, so enforcement is
    // switched on before those tables are created. The pre-existing tables
    // declare no foreign keys, so nothing about them changes.
    db.exec("PRAGMA foreign_keys = ON;");
    s = sqliteStore(db);
  }

  await s.exec(schema(s.kind === "postgres" ? "BIGINT" : "INTEGER"));

  // Additive migrations (safe to re-run). On SQLite a failure is expected when
  // the column already exists, so only unexpected errors are surfaced — silently
  // discarding every error here would hide a real failure until a query broke
  // at runtime. Postgres has IF NOT EXISTS for this.
  const add = s.kind === "postgres" ? "ADD COLUMN IF NOT EXISTS" : "ADD COLUMN";
  for (const stmt of [
    `ALTER TABLE projects ${add} repo TEXT`,
    `ALTER TABLE projects ${add} base_branch TEXT`,
    `ALTER TABLE projects ${add} push_on_publish INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE projects ${add} workspace_id TEXT`,
    `ALTER TABLE projects ${add} created_by TEXT`,
    `ALTER TABLE projects ${add} kind TEXT NOT NULL DEFAULT 'scaffold'`,
    `ALTER TABLE projects ${add} mirror_branch TEXT`,
    `ALTER TABLE projects ${add} reasoning TEXT`,
    `ALTER TABLE workspaces ${add} agent TEXT`,
  ]) {
    try {
      await s.exec(stmt);
    } catch (err) {
      const message = (err as Error).message;
      if (!/duplicate column name/i.test(message)) {
        console.error("[db] additive migration failed:", stmt, message);
      }
    }
  }

  // Only after the ALTER loop above: `workspace_id` does not exist on a database
  // created before accounts, so indexing it earlier would fail at startup.
  await s.exec("CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id)");

  if (movedFrom) {
    const movedTo = path.join(HOME, "projects") + path.sep;
    await s.run("UPDATE projects SET dir = ? || substr(dir, ?) WHERE substr(dir, 1, ?) = ?", [
      movedTo,
      movedFrom.length + 1,
      movedFrom.length,
      movedFrom,
    ]);
  }

  return s;
}

/** The first call opens the driver, runs the schema and the migrations. */
export async function getStore(): Promise<Store> {
  if (store) return store;
  opening ??= open().then((s) => (store = s));
  return opening;
}

export const now = () => Date.now();

/** Column names are snake_case; the API speaks camelCase. */
export function toProject(r: ProjectRow) {
  return {
    id: r.id,
    name: r.name,
    dir: r.dir,
    port: r.port ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    repo: r.repo ?? null,
    baseBranch: r.base_branch ?? null,
    pushOnPublish: Boolean(r.push_on_publish),
    workspaceId: r.workspace_id ?? null,
    createdBy: r.created_by ?? null,
    kind: r.kind === "repo" ? ("repo" as const) : r.kind === "mobile" ? ("mobile" as const) : ("scaffold" as const),
    mirrorBranch: r.mirror_branch ?? null,
    reasoning: r.reasoning ?? null,
  };
}

export function toMessage(r: MessageRow) {
  return {
    id: r.id,
    projectId: r.project_id,
    role: r.role,
    content: r.content,
    createdAt: r.created_at,
    editId: r.edit_id ?? null,
  };
}

export function toEdit(r: EditRow) {
  return {
    id: r.id,
    projectId: r.project_id,
    commitSha: r.commit_sha ?? null,
    summary: r.summary,
    createdAt: r.created_at,
  };
}

export function toRelease(r: ReleaseRow) {
  return {
    id: r.id,
    projectId: r.project_id,
    buildId: r.build_id,
    platform: r.platform === "ios" ? ("ios" as const) : ("android" as const),
    profile: r.profile === "production" ? ("production" as const) : ("preview" as const),
    status: r.status,
    submit: Boolean(r.submit),
    artifactUrl: r.artifact_url ?? null,
    logUrl: r.log_url ?? null,
    error: r.error ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Deliberately omits password_hash: this shape is what leaves the process. */
export function toUser(r: UserRow) {
  return { id: r.id, email: r.email, name: r.name, createdAt: r.created_at };
}

export function toWorkspace(r: WorkspaceRow, role?: MembershipRow["role"]) {
  const agent = r.agent;
  return {
    id: r.id,
    name: r.name,
    createdBy: r.created_by,
    createdAt: r.created_at,
    role: role ?? null,
    agent: agent === "codex" || agent === "claude" || agent === "gemini" ? agent : null,
  };
}

export function toMembership(r: MembershipRow) {
  return {
    workspaceId: r.workspace_id,
    userId: r.user_id,
    role: r.role,
    createdAt: r.created_at,
  };
}

export { path };
