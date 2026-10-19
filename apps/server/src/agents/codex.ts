import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TurnEvent } from "@runner-builder/shared";
import {
  BUILTIN_LOCAL_PROVIDERS,
  CODEX_MODEL,
  CODEX_SANDBOX,
  DEFAULT_EFFORT,
  EFFORT_NONE,
  MEMPALACE_SERVER,
  MOBILE_EFFORT,
  MODEL_PROVIDER,
  MODEL_PROVIDER_URL,
  POLICY_UNATTENDED_ROOT_VARIABLE,
  PROJECTS_DIR,
} from "../config.ts";
import { codexStatus } from "../codexAuth.ts";
import { ensureCodexHome } from "../codexHome.ts";
import { JsonlProcess, UnknownEvents, relativeTo, tokens, type Parsed } from "./process.ts";
import type { AgentAdapter, AgentStatus, ProjectKind, RunOptions, RunResult } from "./types.ts";

const pexec = promisify(execFile);

/**
 * The Codex CLI, driven as `codex exec --json` from the builder's own Codex
 * home. The default, because it is what the builder was written against:
 * an OS sandbox around the agent, skills loaded from the home, and the
 * person's ChatGPT subscription or a local model behind it.
 *
 * Observed event schema (codex-cli 0.162 and 0.163):
 *   {"type":"thread.started"|"turn.started"|"turn.completed","usage":{...}}
 *   {"type":"item.started"|"item.completed","item":{id,type,status,...}}
 *     item.type ∈ agent_message | command_execution | file_change | reasoning | error
 *   {"type":"turn.failed","error":{"message"}}
 */
export class CodexAdapter implements AgentAdapter {
  readonly id = "codex" as const;
  readonly label = "Codex";
  readonly efforts = ["low", "medium", "high", "xhigh", "max", "ultra"];

  defaultEffort(kind: ProjectKind): string | null {
    const effort = kind === "mobile" ? MOBILE_EFFORT : DEFAULT_EFFORT;
    return effort === EFFORT_NONE ? null : effort;
  }

  async status(): Promise<AgentStatus> {
    let installed = true;
    try {
      await pexec("codex", ["--version"], { timeout: 10_000 });
    } catch {
      installed = false;
    }
    const auth = codexStatus();
    const local = MODEL_PROVIDER ? `${MODEL_PROVIDER} · ${CODEX_MODEL}` : null;
    return {
      id: this.id,
      label: this.label,
      installed,
      account: MODEL_PROVIDER ? null : auth.connected ? (auth.email ?? auth.name ?? "connected") : null,
      model: CODEX_MODEL,
      efforts: this.efforts,
      defaultEfforts: {
        scaffold: this.defaultEffort("scaffold"),
        repo: this.defaultEffort("repo"),
        mobile: this.defaultEffort("mobile"),
      },
      note: local
        ? `Runs a local model through ${local}; no ChatGPT login needed.`
        : auth.connected
          ? null
          : "Not connected. Connect a ChatGPT account from the sidebar, or run `codex login` in a terminal.",
    };
  }

  run(opts: RunOptions): Promise<RunResult> {
    const { dir, prompt, effort, onEvent, extraEnv, network, memory, signal } = opts;
    const args = ["exec", "--json", "-C", dir, "-s", CODEX_SANDBOX, "-m", CODEX_MODEL, "--skip-git-repo-check"];
    // Set explicitly rather than inherited from ~/.codex/config.toml, so the
    // app's effort level is the app's decision. A local model without a
    // thinking mode refuses any level, so "none" sends nothing.
    if (effort && effort !== EFFORT_NONE) args.push("-c", `model_reasoning_effort="${effort}"`);
    if (network) args.push("-c", "sandbox_workspace_write.network_access=true");

    const env: NodeJS.ProcessEnv = {};
    if (MODEL_PROVIDER && BUILTIN_LOCAL_PROVIDERS.has(MODEL_PROVIDER)) {
      // Codex's own Ollama and LM Studio providers: no login, no config block;
      // the server address travels in the variable Codex reads for them.
      args.push("--oss", "--local-provider", MODEL_PROVIDER);
      if (MODEL_PROVIDER_URL) env.CODEX_OSS_BASE_URL = MODEL_PROVIDER_URL;
    } else if (MODEL_PROVIDER) {
      // A self-hosted OpenAI-compatible server, declared in the builder's
      // Codex home (see codexHome.ts); this selects it for the run.
      args.push("-c", `model_provider="${MODEL_PROVIDER}"`);
    }

    // MemPalace is read-only, and enforced as such rather than requested.
    //
    // `enabled_tools` is an allow-list: only the two read tools are advertised to
    // the model, so `mempalace_add_drawer` is not callable at all. The user's
    // global codex config marks all three tools `approval_mode = "approve"`,
    // which no headless run can satisfy — a per-tool `approve` also shadows the
    // server default, so the read tools must be re-set to `auto` explicitly or
    // every memory call would fail.
    if (memory) {
      const server = MEMPALACE_SERVER;
      args.push(
        "-c",
        `mcp_servers.${server}.enabled_tools=["mempalace_search","mempalace_status"]`,
        "-c",
        `mcp_servers.${server}.disabled_tools=["mempalace_add_drawer"]`,
        "-c",
        `mcp_servers.${server}.default_tools_approval_mode="auto"`,
        "-c",
        `mcp_servers.${server}.tools.mempalace_search.approval_mode="auto"`,
        "-c",
        `mcp_servers.${server}.tools.mempalace_status.approval_mode="auto"`,
      );
    }

    // The builder-owned home (see codexHome.ts) keeps the person's own hooks
    // out of the agent's way; the unattended marker does the same for the
    // machine-wide managed policy, which runs whatever the home is.
    const codexHome = ensureCodexHome();
    const unknown = new UnknownEvents("codex");
    return new JsonlProcess({
      command: "codex",
      args,
      cwd: dir,
      env: {
        ...process.env,
        ...extraEnv,
        ...env,
        ...(codexHome ? { CODEX_HOME: codexHome } : {}),
        [POLICY_UNATTENDED_ROOT_VARIABLE]: PROJECTS_DIR,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      },
      prompt,
      logName: "agent.log.jsonl",
      missing: "codex CLI not found on PATH. Install it and run `codex login`.",
      parse: (line) => this.parse(line, dir, unknown),
      onEvent,
      signal,
    }).run();
  }

  /**
   * We emit on the transitions that carry real information: a command at
   * `started` (so the UI feels live), everything else at `completed`.
   */
  private parse(line: string, dir: string, unknown: UnknownEvents): Parsed {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      const text = line.trim();
      return { events: text ? [{ type: "agent.delta", text: text + "\n" }] : [] };
    }

    const events: TurnEvent[] = [];
    const type = obj?.type;
    const item = obj?.item;
    const kind = item?.type;

    if (type === "item.started") {
      if (kind === "command_execution") {
        events.push({
          type: "agent.tool",
          name: "command",
          detail: String(item.command ?? "").replace(/^\/bin\/zsh -lc\s*/, "").slice(0, 300),
        });
      }
    } else if (type === "item.completed") {
      if (kind === "agent_message" && typeof item.text === "string" && item.text.trim()) {
        events.push({ type: "agent.delta", text: item.text });
        return { events, summary: item.text.trim() };
      }
      if (kind === "command_execution" && item.exit_code != null && item.exit_code !== 0) {
        events.push({
          type: "agent.tool",
          name: "error",
          detail: `exit ${item.exit_code}: ${String(item.aggregated_output ?? "").slice(-300)}`,
        });
      }
      if (kind === "file_change") {
        const paths = (item.changes ?? [])
          .map((c: any) => (typeof c?.path === "string" ? relativeTo(dir, c.path) : null))
          .filter((v: string | null): v is string => Boolean(v));
        if (paths.length) {
          events.push({ type: "files.changed", paths });
          events.push({ type: "agent.tool", name: "edit", detail: paths.join(", ") });
        }
      }
      if (kind === "error" && typeof item.message === "string") {
        events.push({ type: "agent.tool", name: "error", detail: item.message.slice(0, 300) });
      }
    } else if (type === "turn.completed") {
      const u = obj.usage;
      if (u) {
        events.push({
          type: "agent.tool",
          name: "usage",
          detail: `${tokens(u.input_tokens ?? 0)} in · ${tokens(u.output_tokens ?? 0)} out`,
        });
      }
    } else if (type === "turn.failed") {
      return { events, failed: String(obj.error?.message ?? "the agent reported a failed turn").slice(0, 600) };
    } else if (type === "error") {
      // Transient: Codex retries on its own; the final word is turn.failed.
      events.push({ type: "agent.tool", name: "error", detail: String(obj.message ?? "").slice(0, 300) });
    } else if (type === "thread.started" || type === "turn.started" || type === "item.updated") {
      /* ignored */
    } else if (type) {
      unknown.note(line);
    }

    return { events };
  }
}
