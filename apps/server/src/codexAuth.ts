import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, lstatSync, readFileSync, symlinkSync, unlinkSync } from "node:fs";
import path from "node:path";
import { ensureCodexHome } from "./codexHome.ts";
import { USER_CODEX_HOME } from "./config.ts";

const pexec = promisify(execFile);

/**
 * Which ChatGPT account the agent runs as.
 *
 * The builder's Codex home holds one login. It can be the person's terminal
 * login (a symlink to it, the default convenience) or an account connected
 * here through device authorization, which is what someone with several
 * accounts needs. Tokens never leave this module; only identity claims do.
 */
export type CodexAccount = {
  connected: boolean;
  email: string | null;
  name: string | null;
  plan: string | null;
  mode: "chatgpt" | "api_key" | null;
  /** True when the login is the person's terminal login, shared by symlink. */
  shared: boolean;
  /** A device-authorization login is waiting for the person to enter its code. */
  loginInProgress: boolean;
  /** The person's own Codex home has a login that could be linked. */
  terminalLoginAvailable: boolean;
};

export type LoginPrompt = { url: string; code: string; expiresInMinutes: number };

const homeDir = () => ensureCodexHome() ?? USER_CODEX_HOME;
const authPath = () => path.join(homeDir(), "auth.json");
const terminalAuthPath = () => path.join(USER_CODEX_HOME, "auth.json");

function decodeClaims(idToken: string): Record<string, unknown> | null {
  const part = idToken.split(".")[1];
  if (!part) return null;
  try {
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

let login: { child: ChildProcess; prompt: LoginPrompt | null; output: string } | null = null;

export function codexStatus(): CodexAccount {
  const file = authPath();
  const base: CodexAccount = {
    connected: false,
    email: null,
    name: null,
    plan: null,
    mode: null,
    shared: false,
    loginInProgress: Boolean(login),
    terminalLoginAvailable: file !== terminalAuthPath() && existsSync(terminalAuthPath()),
  };

  let shared = false;
  try {
    shared = lstatSync(file).isSymbolicLink();
  } catch {
    return base;
  }

  let raw: { auth_mode?: unknown; OPENAI_API_KEY?: unknown; tokens?: { id_token?: unknown } } | null = null;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return base;
  }

  const idToken = str(raw?.tokens?.id_token);
  const claims = idToken ? decodeClaims(idToken) : null;
  const auth = (claims?.["https://api.openai.com/auth"] ?? {}) as Record<string, unknown>;
  const apiKeyOnly = !idToken && Boolean(raw?.OPENAI_API_KEY);
  if (!idToken && !apiKeyOnly) return base;

  return {
    ...base,
    connected: true,
    email: str(claims?.email),
    name: str(claims?.name),
    plan: str(auth.chatgpt_plan_type),
    mode: apiKeyOnly ? "api_key" : "chatgpt",
    shared,
  };
}

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

function parsePrompt(output: string): LoginPrompt | null {
  const text = stripAnsi(output);
  const url = text.match(/https:\/\/\S+/)?.[0];
  const code = text.match(/\b([A-Z0-9]{4,}-[A-Z0-9]{4,})\b/)?.[1];
  if (!url || !code) return null;
  const minutes = Number(text.match(/expires in (\d+) minutes?/)?.[1] ?? 15);
  return { url, code, expiresInMinutes: minutes };
}

/**
 * Start (or report) a device-authorization login into the builder's home. A
 * shared terminal login is unlinked first: Codex writes the new credentials to
 * auth.json, and writing through the symlink would silently replace the
 * person's own login with the account they meant to add here.
 */
export async function startLogin(): Promise<LoginPrompt> {
  if (login?.prompt) return login.prompt;
  if (!login) {
    const file = authPath();
    try {
      if (lstatSync(file).isSymbolicLink()) unlinkSync(file);
    } catch {
      /* nothing linked */
    }
    const child = spawn("codex", ["login", "--device-auth"], {
      env: { ...process.env, CODEX_HOME: homeDir(), NO_COLOR: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const entry = { child, prompt: null as LoginPrompt | null, output: "" };
    const absorb = (chunk: Buffer) => {
      entry.output += chunk.toString();
      if (!entry.prompt) entry.prompt = parsePrompt(entry.output);
    };
    child.stdout?.on("data", absorb);
    child.stderr?.on("data", absorb);
    child.on("close", () => {
      if (login?.child === child) login = null;
    });
    child.on("error", () => {
      if (login?.child === child) login = null;
    });
    login = entry;
  }

  const current = login;
  const deadline = Date.now() + 15_000;
  while (!current.prompt && Date.now() < deadline && login === current) {
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!current.prompt) {
    const detail = stripAnsi(current.output).trim().slice(-300);
    cancelLogin();
    throw new Error(detail ? `codex login did not offer a device code: ${detail}` : "codex login did not start");
  }
  return current.prompt;
}

export function cancelLogin(): void {
  const current = login;
  login = null;
  try {
    current?.child.kill("SIGTERM");
  } catch {
    /* already gone */
  }
}

/** Forget the builder's login. A shared terminal login is only unlinked, never revoked. */
export async function logout(): Promise<void> {
  cancelLogin();
  const file = authPath();
  let isLink = false;
  try {
    isLink = lstatSync(file).isSymbolicLink();
  } catch {
    return;
  }
  if (isLink) {
    unlinkSync(file);
    return;
  }
  await pexec("codex", ["logout"], { env: { ...process.env, CODEX_HOME: homeDir(), NO_COLOR: "1" } }).catch(
    () => {
      try {
        unlinkSync(file);
      } catch {
        /* already gone */
      }
    },
  );
}

/** Use the person's terminal login here, by link, so a refresh on either side is seen by both. */
export async function linkTerminalLogin(): Promise<void> {
  const file = authPath();
  if (file === terminalAuthPath()) return;
  if (!existsSync(terminalAuthPath())) throw new Error("no terminal login to use: run `codex login` in a terminal first");
  await logout();
  symlinkSync(terminalAuthPath(), file);
}
