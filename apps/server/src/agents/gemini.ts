import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TurnEvent } from "@runner-builder/shared";
import { GEMINI_MODEL, POLICY_UNATTENDED_ROOT_VARIABLE, PROJECTS_DIR } from "../config.ts";
import { JsonlProcess, UnknownEvents, relativeTo, tokens, type Parsed } from "./process.ts";
import type { AgentAdapter, AgentStatus, ProjectKind, RunOptions, RunResult } from "./types.ts";

const pexec = promisify(execFile);

/**
 * Gemini CLI, driven as `gemini -p --output-format stream-json` on the
 * person's own Google account.
 *
 * Headless Gemini either asks before every tool call or approves all of them;
 * there is no allow-list to hand it and no OS sandbox, so the builder runs it
 * with `--approval-mode yolo` and says so in the picker. Its documented stream
 * has init, message, tool_use, tool_result, error and result events; the
 * field names are not documented, so this parser reads the usual ones and
 * logs what it does not recognise. Written from the documentation, not yet
 * against a signed-in CLI.
 */
export class GeminiAdapter implements AgentAdapter {
  readonly id = "gemini" as const;
  readonly label = "Gemini CLI";
  readonly efforts: string[] = [];

  defaultEffort(_kind: ProjectKind): string | null {
    return null;
  }

  async status(): Promise<AgentStatus> {
    let installed = true;
    try {
      await pexec("gemini", ["--version"], { timeout: 10_000 });
    } catch {
      installed = false;
    }
    return {
      id: this.id,
      label: this.label,
      installed,
      account: null,
      model: GEMINI_MODEL || null,
      efforts: this.efforts,
      defaultEfforts: { scaffold: null, repo: null, mobile: null },
      note: installed
        ? "Approves every tool call the model asks for; there is no sandbox. Sign in once by running `gemini` in a terminal."
        : "Gemini CLI is not installed: `npm install -g @google/gemini-cli`, then run `gemini` once to sign in.",
    };
  }

  run(opts: RunOptions): Promise<RunResult> {
    const { dir, prompt, skillsDir, onEvent, extraEnv, signal } = opts;
    // The prompt travels on stdin; `-p` appends to it and forces headless mode.
    const args = ["-p", "Do what the message above asks.", "--output-format", "stream-json", "--approval-mode", "yolo"];
    if (skillsDir) args.push("--include-directories", skillsDir);
    if (GEMINI_MODEL) args.push("-m", GEMINI_MODEL);

    const skillsNote = skillsDir
      ? `Skills named below are folders under ${skillsDir}; read a skill by reading its SKILL.md there.\n\n`
      : "";
    const unknown = new UnknownEvents("gemini");
    return new JsonlProcess({
      command: "gemini",
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
      logName: "agent-gemini.log.jsonl",
      missing: "Gemini CLI (`gemini`) not found on PATH. Install it with `npm install -g @google/gemini-cli` and sign in once.",
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
    const text = (v: unknown): string =>
      typeof v === "string" ? v : Array.isArray(v) ? v.map((p: any) => (typeof p === "string" ? p : p?.text ?? "")).join("") : "";

    if (type === "message") {
      const role = obj.role ?? obj.message?.role ?? "assistant";
      const body = text(obj.content ?? obj.text ?? obj.message?.content).trim();
      if (role === "assistant" && body) {
        events.push({ type: "agent.delta", text: body });
        return { events, summary: body };
      }
      return { events };
    }
    if (type === "tool_use") {
      const name = String(obj.name ?? obj.tool_name ?? obj.tool ?? "");
      const input = obj.args ?? obj.input ?? obj.arguments ?? obj.parameters ?? {};
      return { events: this.toolEvents(name, input, dir) };
    }
    if (type === "tool_result") {
      const failed = obj.error ?? obj.is_error ?? (obj.status === "error" ? obj.output : null);
      if (failed) events.push({ type: "agent.tool", name: "error", detail: text(failed).slice(-300) });
      return { events };
    }
    if (type === "error") {
      events.push({ type: "agent.tool", name: "error", detail: text(obj.message ?? obj.error ?? "").slice(0, 300) });
      return { events };
    }
    if (type === "result") {
      const stats = obj.stats ?? {};
      const input = Number(stats.input_tokens ?? stats.inputTokens ?? stats.prompt_tokens ?? 0);
      const output = Number(stats.output_tokens ?? stats.outputTokens ?? stats.candidates_tokens ?? 0);
      if (input || output) events.push({ type: "agent.tool", name: "usage", detail: `${tokens(input)} in · ${tokens(output)} out` });
      const failed = obj.error ? text(obj.error.message ?? obj.error) : null;
      const summary = text(obj.response ?? obj.result).trim();
      return failed ? { events, failed: failed.slice(0, 600) } : { events, summary: summary || undefined };
    }
    if (type === "init") return { events };
    if (type) unknown.note(line);
    return { events };
  }

  /** Gemini's built-in tool names, in the vocabulary the chat panel already speaks. */
  private toolEvents(name: string, input: any, dir: string): TurnEvent[] {
    const file = typeof input.file_path === "string" ? relativeTo(dir, input.file_path) : typeof input.path === "string" ? relativeTo(dir, input.path) : null;
    switch (name) {
      case "write_file":
      case "replace":
      case "edit":
        return file
          ? [
              { type: "files.changed", paths: [file] },
              { type: "agent.tool", name: "edit", detail: file },
            ]
          : [];
      case "run_shell_command":
        return [{ type: "agent.tool", name: "command", detail: String(input.command ?? "").slice(0, 300) }];
      case "read_file":
      case "read_many_files":
        return [{ type: "agent.tool", name: "command", detail: `cat ${file ?? ""}` }];
      case "grep_search":
      case "search_file_content":
        return [{ type: "agent.tool", name: "command", detail: `rg ${String(input.pattern ?? input.query ?? "")}`.slice(0, 300) }];
      case "glob":
      case "list_directory":
        return [{ type: "agent.tool", name: "command", detail: `ls ${String(input.pattern ?? file ?? "")}`.slice(0, 300) }];
      case "web_fetch":
      case "google_web_search":
        return [{ type: "agent.tool", name: "command", detail: `curl ${String(input.url ?? input.query ?? "")}`.slice(0, 300) }];
      default:
        return [{ type: "agent.tool", name: "command", detail: name || "tool" }];
    }
  }
}
