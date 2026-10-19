import type { AgentProvider, AgentStatus, TurnEvent } from "@runner-builder/shared";

export type { AgentProvider, AgentStatus };

export type RunResult = {
  ok: boolean;
  summary: string;
  error?: string;
  /** The run ended because the caller aborted it, not because the CLI failed. */
  stopped?: boolean;
};

export type ProjectKind = "scaffold" | "repo" | "mobile";

export type RunOptions = {
  dir: string;
  prompt: string;
  /** Effort (reasoning) level, or null to leave the CLI's own default alone. */
  effort: string | null;
  /** Where the linked skills live, for a CLI that has no skill loader of its own. */
  skillsDir: string | null;
  onEvent: (e: TurnEvent) => void;
  /** Extra env for the child (e.g. GH_TOKEN). Never logged. */
  extraEnv?: NodeJS.ProcessEnv;
  /** Allow outbound network. Needed for gh / npm install. */
  network?: boolean;
  /** Give the agent read-only MemPalace memory, where the CLI supports it. */
  memory?: boolean;
  /** Aborting terminates the CLI; the run resolves with `stopped: true`. */
  signal?: AbortSignal;
};

/**
 * One coding-agent CLI the builder can drive. Every adapter takes the same
 * prompt, edits the same project directory, and reports the same events;
 * only the command line and the lines it prints differ.
 */
export interface AgentAdapter {
  readonly id: AgentProvider;
  readonly label: string;
  /** Effort levels this CLI accepts, lowest first; empty when it has none. */
  readonly efforts: string[];
  defaultEffort(kind: ProjectKind): string | null;
  status(): Promise<AgentStatus>;
  run(opts: RunOptions): Promise<RunResult>;
}
