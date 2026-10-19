import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo root: apps/server/src -> runner-builder/ */
export const REPO_ROOT = path.resolve(here, "../../..");
export const SCAFFOLD_DIR = path.join(REPO_ROOT, "templates", "scaffold");
/** The Expo (React Native) starter a mobile project begins from. */
export const EXPO_SCAFFOLD_DIR = path.join(REPO_ROOT, "templates", "scaffold-expo");
export const WEB_DIST = path.join(REPO_ROOT, "apps", "web", "dist");

/** Everything the tool owns lives under one home dir. */
export const HOME = process.env.BUILDER_HOME ?? path.join(os.homedir(), ".runner-builder");
export const PROJECTS_DIR = path.join(HOME, "projects");
export const DB_PATH = path.join(HOME, "builder.db");
/** Postgres connection string. Empty means SQLite at DB_PATH, the default. */
export const DATABASE_URL = process.env.BUILDER_DATABASE_URL ?? "";

/**
 * Where the data lived before the product was renamed. Adopted once, on boot,
 * when the new home does not exist yet (see `adoptLegacyHome` in db.ts), so an
 * upgrade keeps every project and account.
 */
export const LEGACY_HOME = path.join(os.homedir(), ".lovable-local");
export const LEGACY_DB_NAME = "lovable.db";

/** Per-project directory for agent and dev-server logs. */
export const PROJECT_LOG_DIR = ".builder";

export const PORT = Number(process.env.PORT ?? 4310);
export const HOST = process.env.HOST ?? "127.0.0.1";

/**
 * The codex child runs from a builder-owned Codex home by default. The person's
 * own ~/.codex carries plugins and hooks meant for their interactive terminal
 * sessions (the Runner engineering gate among them), which would stop an
 * unattended agent inside a Runner repository at its first write. The builder
 * home keeps the login (shared by symlink, never copied) and the read-only
 * team memory, and nothing else. `BUILDER_CODEX_ISOLATED=0` runs the agent
 * from the person's own home instead.
 */
export const CODEX_ISOLATED = process.env.BUILDER_CODEX_ISOLATED !== "0";
export const BUILDER_CODEX_HOME = process.env.BUILDER_CODEX_HOME ?? path.join(HOME, "codex-home");
export const USER_CODEX_HOME = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");

/**
 * The Runner engineering gate is also installed machine-wide, as managed Codex
 * hooks under /etc/codex, and those run for every codex process whatever its
 * CODEX_HOME. The hook exempts a run whose working directory sits under the
 * root this variable names, so the builder marks its children with the
 * projects directory: every clone the agent works in lives there, and the
 * builder itself commits, mirrors and opens the pull request for each turn.
 */
export const POLICY_UNATTENDED_ROOT_VARIABLE = "RUNNER_POLICY_UNATTENDED_ROOT";

/**
 * Skills the agent gets, linked into the builder's Codex home. Everything in
 * the person's Codex skills folder (the runner-* skills among them), plus the
 * named design skills from their Claude skills folder: apple-design is what
 * gives the builder's UI work its taste.
 */
export const CODEX_SKILL_SOURCES = (
  process.env.BUILDER_SKILL_DIRS ?? [USER_CODEX_HOME, "skills"].join(path.sep)
).split(path.delimiter).filter(Boolean);
export const CLAUDE_SKILLS_DIR = process.env.BUILDER_CLAUDE_SKILLS_DIR ?? path.join(os.homedir(), ".claude", "skills");
export const CLAUDE_SKILLS = (process.env.BUILDER_CLAUDE_SKILLS ?? "apple-design,design-taste-frontend,web-design-guidelines")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Skills that arrive as plugins rather than loose folders.
 *
 * Codex plugins install under <codex home>/plugins/cache/<marketplace>/<plugin>/
 * <version>/skills; only the named plugins are linked, so the official `expo`
 * plugin reaches the agent while unrelated plugin bundles stay out of its way.
 * Claude plugins keep the same shape under ~/.claude/plugins/cache, and the
 * named skills are looked up by name across every installed version.
 */
export const CODEX_PLUGIN_CACHE = path.join(USER_CODEX_HOME, "plugins", "cache");
export const CODEX_PLUGINS = (process.env.BUILDER_CODEX_PLUGINS ?? "expo")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
export const CLAUDE_PLUGIN_CACHE =
  process.env.BUILDER_CLAUDE_PLUGIN_CACHE ?? path.join(os.homedir(), ".claude", "plugins", "cache");
export const CLAUDE_PLUGIN_SKILLS = (process.env.BUILDER_CLAUDE_PLUGIN_SKILLS ?? "react-native-patterns,liquid-glass-design")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * The Expo MCP server: current Expo docs, `expo install`, EAS builds and
 * TestFlight data, reachable from the agent's own Codex home. It needs a
 * one-time login from that home: `CODEX_HOME=~/.runner-builder/codex-home codex mcp login expo`.
 */
export const EXPO_MCP_ENABLED = process.env.BUILDER_EXPO_MCP !== "0";
export const EXPO_MCP_URL = process.env.BUILDER_EXPO_MCP_URL ?? "https://mcp.expo.dev/mcp";

/**
 * The app brief the agent keeps at a project's root: purpose, screens, data,
 * what is done and what is next. Injected into every turn, so the agent holds
 * the whole app in mind rather than the last few messages.
 */
export const BRIEF_FILE = "APP_BRIEF.md";

/**
 * After a mobile turn, type-check the project and hand the agent one chance to
 * fix what it broke before the turn is reported as done. Off with
 * BUILDER_SELF_CHECK=0; the time limit keeps a stuck compiler from holding a turn.
 */
export const SELF_CHECK = process.env.BUILDER_SELF_CHECK !== "0";
export const SELF_CHECK_TIMEOUT_MS = Number(process.env.BUILDER_SELF_CHECK_TIMEOUT_MS ?? 120_000);

/** EAS commands run in the cloud but the CLI still has a ceiling for the request itself. */
export const EAS_TIMEOUT_MS = Number(process.env.BUILDER_EAS_TIMEOUT_MS ?? 5 * 60 * 1000);

/**
 * Environment handed to a repository project's dev server, as KEY=VALUE pairs
 * separated by commas. A real app's preview is only the app if it can reach a
 * backend, and on a builder machine that backend is staging: the Runner
 * frontend reads RUNNER_DEV_API_TARGET for exactly this.
 */
export const PREVIEW_ENV: Record<string, string> = Object.fromEntries(
  (process.env.BUILDER_PREVIEW_ENV ?? "")
    .split(",")
    .map((pair) => pair.trim())
    .filter((pair) => pair.includes("="))
    .map((pair) => [pair.slice(0, pair.indexOf("=")).trim(), pair.slice(pair.indexOf("=") + 1).trim()]),
);

/** Model used by the codex agent. Overridable per invocation. */
export const CODEX_MODEL = process.env.BUILDER_MODEL ?? "gpt-6-astra";

/**
 * Where the Codex agent's model runs. Empty means the Codex login's own
 * provider (the person's ChatGPT subscription). `ollama` and `lmstudio` are
 * Codex's built-in local providers, selected with `codex exec --oss`, so a
 * local model is one setting: BUILDER_PROVIDER=ollama BUILDER_MODEL=gpt-oss:20b.
 * Any other value names a self-hosted OpenAI-compatible server (vLLM,
 * llama.cpp, a gateway) declared in the agent's Codex home, which Codex talks
 * to over the Responses API only.
 */
export const MODEL_PROVIDER = (process.env.BUILDER_PROVIDER ?? "").trim();
export const BUILTIN_LOCAL_PROVIDERS = new Set(["ollama", "lmstudio"]);
/**
 * The server's address. For a built-in provider it is the server root, handed
 * to Codex as CODEX_OSS_BASE_URL (unset keeps Codex's default, Ollama's
 * http://localhost:11434); for a custom provider it is the API base, …/v1.
 */
export const MODEL_PROVIDER_URL = (process.env.BUILDER_PROVIDER_URL ?? "").trim();
/** Name of an env variable holding the provider's API key, for servers that want one. */
export const MODEL_PROVIDER_KEY_ENV = (process.env.BUILDER_PROVIDER_KEY_ENV ?? "").trim();
if (MODEL_PROVIDER && !BUILTIN_LOCAL_PROVIDERS.has(MODEL_PROVIDER) && !MODEL_PROVIDER_URL) {
  throw new Error(
    `BUILDER_PROVIDER=${MODEL_PROVIDER} needs BUILDER_PROVIDER_URL, the server's OpenAI-compatible base URL ending in /v1`,
  );
}

/**
 * Effort (reasoning) levels. A project can choose its own from the composer;
 * these are the defaults a project without a choice gets. A mobile turn reads
 * several skills and the app brief every time, so the highest levels get
 * expensive fast; `high` keeps the result while cutting the bill. "none"
 * passes no level at all, which a local model without a thinking mode needs.
 */
export const EFFORT_NONE = "none";
const REASONING = process.env.BUILDER_REASONING;
export const DEFAULT_EFFORT = REASONING ?? (MODEL_PROVIDER ? EFFORT_NONE : "xhigh");
export const MOBILE_EFFORT = process.env.BUILDER_MOBILE_REASONING ?? (MODEL_PROVIDER ? DEFAULT_EFFORT : REASONING ?? "high");
/** Sandbox mode for codex exec. workspace-write lets it edit the project. */
export const CODEX_SANDBOX = process.env.BUILDER_SANDBOX ?? "workspace-write";

/**
 * Which CLI drives the agent when a workspace has not chosen one: codex (the
 * default), claude (Claude Code) or gemini (Gemini CLI). Each is the person's
 * own installed, signed-in CLI; the builder never holds a model API key.
 */
export const DEFAULT_AGENT = (process.env.BUILDER_AGENT ?? "codex").trim();
export const CLAUDE_MODEL = (process.env.BUILDER_CLAUDE_MODEL ?? "").trim();
export const GEMINI_MODEL = (process.env.BUILDER_GEMINI_MODEL ?? "").trim();
/** Extra Claude Code tool permissions, comma-separated, in Claude's own `Bash(npm run:*)` syntax. */
export const CLAUDE_EXTRA_TOOLS = (process.env.BUILDER_CLAUDE_ALLOWED_TOOLS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Web dev-server origin, so the CSRF origin check accepts the Vite proxy. */
const WEB_PORT = Number(process.env.BUILDER_WEB_PORT ?? 4311);

/** Session lifetime, sliding: an authenticated request extends it. */
export const SESSION_TTL_MS = Number(process.env.BUILDER_SESSION_TTL_MS ?? 30 * 24 * 60 * 60 * 1000);

/**
 * Set `Secure` on the session cookie. Only valid behind TLS: on `http://` the
 * browser silently drops a `Secure` cookie, so login would appear to succeed and
 * then immediately 401. Off by default because this app is loopback HTTP.
 */
export const SECURE_COOKIES = process.env.BUILDER_SECURE_COOKIES === "1";

/** Origins permitted to make state-changing requests. Defence in depth behind SameSite=Lax. */
export const ALLOWED_ORIGINS = new Set([
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${WEB_PORT}`,
  `http://localhost:${WEB_PORT}`,
]);

/**
 * MemPalace memory for the agent. Read-only, and enabled only when a token is
 * actually present — without one the turn runs exactly as it did before.
 */
/** Where the builder-owned Codex home points its MemPalace MCP server. No default: a team sets its own. */
export const MEMPALACE_URL = process.env.BUILDER_MEMPALACE_URL ?? "";
export const MEMPALACE_ENABLED =
  process.env.BUILDER_MEMPALACE !== "0" && Boolean(process.env.MEMPALACE_TOKEN) && Boolean(MEMPALACE_URL);
export const MEMPALACE_SERVER = process.env.BUILDER_MEMPALACE_SERVER ?? "mempalace";
