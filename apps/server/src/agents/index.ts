import path from "node:path";
import { BUILDER_CODEX_HOME, CODEX_ISOLATED, DEFAULT_AGENT } from "../config.ts";
import { ClaudeAdapter } from "./claude.ts";
import { CodexAdapter } from "./codex.ts";
import { GeminiAdapter } from "./gemini.ts";
import type { AgentAdapter, AgentProvider, AgentStatus } from "./types.ts";

export type { AgentAdapter, AgentProvider, AgentStatus, ProjectKind, RunOptions, RunResult } from "./types.ts";

export const AGENT_PROVIDERS: AgentProvider[] = ["codex", "claude", "gemini"];

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

  async statuses(): Promise<AgentStatus[]> {
    return Promise.all(AGENT_PROVIDERS.map((id) => this.adapters[id].status()));
  }
}

export const agents = new AgentRegistry();
