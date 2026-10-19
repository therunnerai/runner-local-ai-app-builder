import path from "node:path";
import { BUILDER_CODEX_HOME, CODEX_ISOLATED, DEFAULT_AGENT } from "../config.ts";
import { ClaudeAdapter } from "./claude.ts";
import { CodexAdapter } from "./codex.ts";
import { GeminiAdapter } from "./gemini.ts";
import type { AgentAdapter, AgentProvider, AgentStatus } from "./types.ts";

export type { AgentAdapter, AgentProvider, AgentStatus, ProjectKind, RunOptions, RunResult } from "./types.ts";

export const AGENT_PROVIDERS: AgentProvider[] = ["codex", "claude", "gemini"];

/** How long one round of CLI status answers is reused before the CLIs are asked again. */
const STATUS_TTL_MS = 30_000;

export function isAgentProvider(value: unknown): value is AgentProvider {
  return typeof value === "string" && (AGENT_PROVIDERS as string[]).includes(value);
}

/**
 * The CLIs the builder can drive, and which one a workspace uses. A
 * workspace without a choice gets the builder's default (BUILDER_AGENT,
 * codex unless set), so a single-person install never has to pick.
 */
export class AgentRegistry {
  private readonly adapters: Record<AgentProvider, AgentAdapter> = {
    codex: new CodexAdapter(),
    claude: new ClaudeAdapter(),
    gemini: new GeminiAdapter(),
  };

  readonly defaultProvider: AgentProvider = isAgentProvider(DEFAULT_AGENT) ? DEFAULT_AGENT : "codex";

  /** The adapter a workspace's choice names, or the default when it has none. */
  resolve(choice: string | null | undefined): AgentAdapter {
    return this.adapters[isAgentProvider(choice) ? choice : this.defaultProvider];
  }

  /**
   * Where the linked skills live. Codex reads them from its home itself; the
   * other CLIs are pointed at the same folder, so every agent sees the same
   * design and framework guides.
   */
  skillsDir(): string | null {
    return CODEX_ISOLATED ? path.join(BUILDER_CODEX_HOME, "skills") : null;
  }

  private statusCache: { at: number; value: Promise<AgentStatus[]> } | null = null;

  /**
   * Every CLI is asked for its version and login. The sidebar, the agent
   * dialog and each open project ask at once, so one round of answers is
   * shared for a short while; a failed round is not kept.
   */
  statuses(): Promise<AgentStatus[]> {
    const now = Date.now();
    if (this.statusCache && now - this.statusCache.at < STATUS_TTL_MS) return this.statusCache.value;
    const value = Promise.all(AGENT_PROVIDERS.map((id) => this.adapters[id].status()));
    this.statusCache = { at: now, value };
    value.catch(() => {
      this.statusCache = null;
    });
    return value;
  }

  /** Forget the cached answers, e.g. after a login changed. */
  forgetStatuses(): void {
    this.statusCache = null;
  }
}

export const agents = new AgentRegistry();
