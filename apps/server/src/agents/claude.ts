import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TurnEvent } from "@runner-builder/shared";
import {
  CLAUDE_EXTRA_TOOLS,
  CLAUDE_MODEL,
  DEFAULT_EFFORT,
  EFFORT_NONE,
  MOBILE_EFFORT,
  POLICY_UNATTENDED_ROOT_VARIABLE,
  PROJECTS_DIR,
} from "../config.ts";
import { JsonlProcess, UnknownEvents, relativeTo, tokens, type Parsed } from "./process.ts";
import type { AgentAdapter, AgentStatus, ProjectKind, RunOptions, RunResult } from "./types.ts";

const pexec = promisify(execFile);

/**
 * Commands the agent may run without asking. Claude Code has no OS sandbox
 * in headless mode, so instead of approving everything the builder names the
 * tools a turn needs: the type-check, the Expo and npm scripts, reading the
 * tree, and git's read-only commands. Anything else is denied automatically
 * (`--permission-prompts none`), and the agent is told so in its result.
 */
const ALLOWED_TOOLS = [
  "Bash(npx tsc:*)",
  "Bash(npx expo install:*)",
  "Bash(npx expo lint:*)",
  "Bash(npx expo export:*)",
  "Bash(npx expo-doctor:*)",
  "Bash(npm run:*)",
  "Bash(npm test:*)",
  "Bash(npx vitest:*)",
  "Bash(npx eslint:*)",
  "Bash(node:*)",
  "Bash(ls:*)",
  "Bash(cat:*)",
  "Bash(head:*)",
  "Bash(tail:*)",
  "Bash(wc:*)",
  "Bash(grep:*)",
  "Bash(rg:*)",
  "Bash(find:*)",
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git log:*)",
];
const NETWORK_TOOLS = ["Bash(gh:*)", "Bash(npm install:*)", "Bash(npm ci:*)"];

/**
 * Claude Code, driven as `claude -p --output-format stream-json` on the
 * person's own Anthropic subscription.
 *
 * `--safe-mode` is what isolation means here: the person's hooks, plugins,
 * MCP servers and CLAUDE.md files stay out of the agent's way (the Runner
 * engineering gate among them) while their login still works. A separate
 * CLAUDE_CONFIG_DIR would not: the login does not follow it.
 *
 * Observed event schema (Claude Code 2.1):
 *   {"type":"system","subtype":"init",...}
 *   {"type":"assistant","message":{"content":[{"type":"text","text"}|{"type":"tool_use","name","input"}]}}
 *   {"type":"user","message":{"content":[{"type":"tool_result","is_error","content"}]}}
 *   {"type":"result","subtype":"success"|...,"is_error","result","usage":{...}}
 */
export class ClaudeAdapter implements AgentAdapter {
  readonly id = "claude" as const;
  readonly label = "Claude Code";
  readonly efforts = ["low", "medium", "high", "xhigh", "max"];

  defaultEffort(kind: ProjectKind): string | null {
    const effort = kind === "mobile" ? MOBILE_EFFORT : DEFAULT_EFFORT;
    if (effort === EFFORT_NONE) return null;
    // Codex's top level has no equivalent here; the nearest one is used.
    return this.efforts.includes(effort) ? effort : "max";
  }

  async status(): Promise<AgentStatus> {
    let installed = true;
    let account: string | null = null;
    try {
      await pexec("claude", ["--version"], { timeout: 10_000 });
    } catch {
      installed = false;
    }
    if (installed) {
      try {
        const { stdout } = await pexec("claude", ["auth", "status", "--json"], {
          timeout: 15_000,
          env: { ...process.env, NO_COLOR: "1" },
        });
        const status = JSON.parse(stdout.slice(stdout.indexOf("{"))) as Record<string, unknown>;
        const email = [status.email, status.emailAddress, (status.account as any)?.email].find((v) => typeof v === "string");
        const loggedIn = status.loggedIn ?? status.authenticated ?? status.isLoggedIn ?? Boolean(email);
        account = typeof email === "string" ? email : loggedIn ? "signed in" : null;
      } catch {
        account = null;
      }
    }
    return {
      id: this.id,
      label: this.label,
      installed,
      account,
      model: CLAUDE_MODEL || null,
      efforts: this.efforts,
      defaultEfforts: {
        scaffold: this.defaultEffort("scaffold"),
        repo: this.defaultEffort("repo"),
        mobile: this.defaultEffort("mobile"),
      },
      note: installed
        ? account
          ? "Runs without your hooks and plugins; edits are approved, commands only from a fixed list."
          : "Not signed in. Run `claude` once in a terminal and sign in."
        : "Claude Code is not installed. See https://docs.anthropic.com/claude-code.",
    };
  }

  run(opts: RunOptions): Promise<RunResult> {
    const { dir, prompt, effort, skillsDir, onEvent, extraEnv, network, signal } = opts;
    const tools = [...ALLOWED_TOOLS, ...(network ? NETWORK_TOOLS : []), ...CLAUDE_EXTRA_TOOLS];
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--safe-mode",
      "--no-session-persistence",
      "--permission-mode",
      "acceptEdits",
      "--permission-prompts",
      "none",
      "--allowedTools",
      tools.join(","),
    ];
    if (skillsDir) args.push("--add-dir", skillsDir);
    if (effort && effort !== EFFORT_NONE) args.push("--effort", effort);
    if (CLAUDE_MODEL) args.push("--model", CLAUDE_MODEL);

    const skillsNote = skillsDir
      ? `Skills named below are folders under ${skillsDir}; read a skill by reading its SKILL.md there.\n\n`
      : "";
    const unknown = new UnknownEvents("claude");
    return new JsonlProcess({
      command: "claude",
      args,
      cwd: dir,
      env: {
        ...process.env,
        ...extraEnv,
        [POLICY_UNATTENDED_ROOT_VARIABLE]: PROJECTS_DIR,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      },
      prompt: skillsNote + prompt,
      logName: "agent-claude.log.jsonl",
      missing: "Claude Code (`claude`) not found on PATH. Install it and sign in once in a terminal.",
      parse: (line) => this.parse(line, dir, unknown),
      onEvent,
      signal,
    }).run();
  }

  private parse(line: string, dir: string, unknown: UnknownEvents): Parsed {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      return { events: [] };
    }
    const events: TurnEvent[] = [];
    const type = obj?.type;

    if (type === "assistant") {
      let summary: string | undefined;
      for (const part of obj.message?.content ?? []) {
        if (part?.type === "text" && typeof part.text === "string" && part.text.trim()) {
          events.push({ type: "agent.delta", text: part.text });
          summary = part.text.trim();
        } else if (part?.type === "tool_use") {
          events.push(...this.toolEvents(String(part.name ?? ""), part.input ?? {}, dir));
        }
      }
      return { events, summary };
    }
    if (type === "user") {
      for (const part of obj.message?.content ?? []) {
        if (part?.type === "tool_result" && part.is_error) {
          const text = Array.isArray(part.content)
            ? part.content.map((c: any) => c?.text ?? "").join(" ")
            : String(part.content ?? "");
          events.push({ type: "agent.tool", name: "error", detail: text.slice(-300) });
        }
      }
      return { events };
    }
    if (type === "result") {
      const u = obj.usage;
      if (u) {
        const input = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        events.push({ type: "agent.tool", name: "usage", detail: `${tokens(input)} in · ${tokens(u.output_tokens ?? 0)} out` });
      }
      const failed = obj.is_error || (obj.subtype && obj.subtype !== "success");
      const text = typeof obj.result === "string" ? obj.result.trim() : "";
      return failed
        ? { events, failed: (text || String(obj.subtype ?? "the agent reported a failed turn")).slice(0, 600) }
        : { events, summary: text || undefined };
    }
    if (type === "system" || type === "rate_limit_event" || type === "prompt_suggestion") return { events };
    if (type) unknown.note(line);
    return { events };
  }

  /** Claude's tools, in the vocabulary the chat panel already speaks. */
  private toolEvents(name: string, input: any, dir: string): TurnEvent[] {
    const file = typeof input.file_path === "string" ? relativeTo(dir, input.file_path) : null;
    switch (name) {
      case "Edit":
      case "Write":
      case "MultiEdit":
      case "NotebookEdit":
        return file
          ? [
              { type: "files.changed", paths: [file] },
              { type: "agent.tool", name: "edit", detail: file },
            ]
          : [];
      case "Bash":
        return [{ type: "agent.tool", name: "command", detail: String(input.command ?? "").slice(0, 300) }];
      case "Read":
        return [{ type: "agent.tool", name: "command", detail: `cat ${file ?? ""}` }];
      case "Grep":
        return [{ type: "agent.tool", name: "command", detail: `rg ${String(input.pattern ?? "")}`.slice(0, 300) }];
      case "Glob":
        return [{ type: "agent.tool", name: "command", detail: `find ${String(input.pattern ?? "")}`.slice(0, 300) }];
      case "WebFetch":
      case "WebSearch":
        return [{ type: "agent.tool", name: "command", detail: `curl ${String(input.url ?? input.query ?? "")}`.slice(0, 300) }];
      default:
        return [{ type: "agent.tool", name: "command", detail: name }];
    }
  }
}
