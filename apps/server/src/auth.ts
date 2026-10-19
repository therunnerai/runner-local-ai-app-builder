import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ALLOWED_ORIGINS, SECURE_COOKIES, SESSION_TTL_MS } from "./config.ts";
import { getStore, now, toUser, type SessionRow, type UserRow } from "./db.ts";

/**
 * Local accounts: scrypt password hashing and opaque server-side sessions.
 *
 * Everything here uses `node:crypto` and one cookie. There is no JWT (it would
 * need a signing dependency and cannot be revoked without a store, which this
 * already has) and no session plugin (a single cookie is a few lines to parse).
 */

export const SESSION_COOKIE = "rb_session";

/* --------------------------------------------------------------- passwords */

const SCRYPT = { N: 16384, r: 8, p: 1 } as const;
const KEYLEN = 64;

/** Self-describing, so the cost parameters can be raised without invalidating rows. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEYLEN, SCRYPT);
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  try {
    const expected = Buffer.from(hashB64, "base64");
    const derived = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return derived.length === expected.length && timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- sessions */

/** The raw token is never stored: a leaked database yields no usable session. */
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type SessionUser = ReturnType<typeof toUser>;

export async function createSession(userId: string): Promise<{ token: string; expiresAt: number }> {
  const token = randomBytes(32).toString("base64url");
  const created = now();
  const expiresAt = created + SESSION_TTL_MS;
  const store = await getStore();
  await store.run("INSERT INTO sessions (id,user_id,created_at,expires_at) VALUES (?,?,?,?)", [
    hashToken(token),
    userId,
    created,
    expiresAt,
  ]);
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  const store = await getStore();
  await store.run("DELETE FROM sessions WHERE id = ?", [hashToken(token)]);
}

export async function pruneSessions(): Promise<void> {
  const store = await getStore();
  await store.run("DELETE FROM sessions WHERE expires_at <= ?", [now()]);
}

export async function resolveSessionToken(token: string | null): Promise<SessionUser | null> {
  if (!token) return null;
  const store = await getStore();
  const row = await store.get<SessionRow>("SELECT * FROM sessions WHERE id = ?", [hashToken(token)]);
  if (!row) return null;
  if (row.expires_at <= now()) {
    await store.run("DELETE FROM sessions WHERE id = ?", [row.id]);
    return null;
  }
  const user = await store.get<UserRow>("SELECT * FROM users WHERE id = ?", [row.user_id]);
  if (!user) return null;

  // Sliding expiry, extended at most once a day so a request does not always write.
  const DAY = 24 * 60 * 60 * 1000;
  if (row.expires_at - now() < SESSION_TTL_MS - DAY) {
    await store.run("UPDATE sessions SET expires_at = ? WHERE id = ?", [now() + SESSION_TTL_MS, row.id]);
  }
  return toUser(user);
}

/* ----------------------------------------------------------------- cookies */

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

export function sessionCookie(token: string): string {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (SECURE_COOKIES) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearedCookie(): string {
  const attrs = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (SECURE_COOKIES) attrs.push("Secure");
  return attrs.join("; ");
}

/* ------------------------------------------------------- request attachment */

const requestUsers = new WeakMap<FastifyRequest, SessionUser>();

export function setRequestUser(req: FastifyRequest, user: SessionUser | null): void {
  if (user) requestUsers.set(req, user);
  else requestUsers.delete(req);
}

/** Null only for the public routes, which the hook lets through unauthenticated. */
export function currentUser(req: FastifyRequest): SessionUser | null {
  return requestUsers.get(req) ?? null;
}

/* -------------------------------------------------------------------- hook */

const PUBLIC_PATHS = new Set([
  "/api/health",
  "/api/auth/me",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/bootstrap",
]);

/**
 * One `onRequest` hook for the whole app, registered before any route, so a new
 * route is authenticated by default and only the list above opts out.
 */
export function registerAuth(app: FastifyInstance): void {
  app.addHook("onRequest", async (req, reply) => {
    // SameSite=Lax already blocks cross-site POSTs; this is defence in depth.
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin && !ALLOWED_ORIGINS.has(origin)) {
        return reply.code(403).send({ error: "origin not allowed" });
      }
    }

    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    const user = await resolveSessionToken(token);
    setRequestUser(req, user);

    const path = req.url.split("?")[0];
    if (!path.startsWith("/api/")) return; // the SPA and its assets stay public
    if (PUBLIC_PATHS.has(path)) return;
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
  });
}
