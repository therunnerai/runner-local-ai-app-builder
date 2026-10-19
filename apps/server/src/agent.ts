import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import {
  CODEX_MODEL,
  CODEX_REASONING,
  CODEX_SANDBOX,
  MEMPALACE_SERVER,
  POLICY_UNATTENDED_ROOT_VARIABLE,
  PROJECT_LOG_DIR,
  PROJECTS_DIR,
} from "./config.ts";
import { ensureCodexHome } from "./codexHome.ts";
import type { TurnEvent } from "@runner-builder/shared";

export type RunResult = {
  ok: boolean;
  summary: string;
  error?: string;
  /** The run ended because the caller aborted it, not because codex failed. */
  stopped?: boolean;
};

/**
 * Skills reach the agent through its Codex home (see codexHome.ts). The
 * design skill is what the person expects every screen to be held to; the
 * Runner skills carry conventions worth reading but also terminal-session
 * rituals that have no meaning here.
 */
const SKILLS_SECTION = `Skills:
- For any user-facing UI work, read and apply the \`apple-design\` skill before designing: \
fluid motion, materials and depth, typography, restraint, reduced-motion. It is the bar.
- The \`runner-*\` skills describe Runner's engineering conventions; read the relevant one for \
how the code is laid out, typed and tested. Their workflow rituals do not apply here: do not file \
receipts, adopt worktrees, write delegation briefs or gate ledgers, do not delegate to subagents, \
and do not stop on a gate verdict. Every turn is committed for you and review happens on the \
pull request.`;

/**
 * The mobile agent's skill map. The Expo team's own guides come first: they
 * are versioned against the SDK the template pins, where memory is not.
 */
const MOBILE_SKILLS_SECTION = `Skills:
- Read \`building-native-ui\` before any screen or navigation work: it is the Expo team's guide to \
Expo Router, styling, components, native tabs, animations and the current SDK's APIs.
- Read \`native-data-fetching\` before adding network requests, caching or offline behaviour, and \
\`react-native-patterns\` for state, lists and data layers.
- Read \`apple-design\` for motion, materials and the feel of every interaction; \`liquid-glass-design\` \
when the person asks for the iOS 26 look.
- Read \`expo-deployment\` only when the person asks about builds, TestFlight or the stores.
- The \`runner-*\` skills carry terminal-session rituals that do not apply here: do not file receipts, \
adopt worktrees, write delegation briefs or gate ledgers, do not delegate to subagents, and do not \
stop on a gate verdict. Every turn is committed for you.
- When the Expo MCP tools are available, use them for current documentation and \`expo install\`; \
when they are not, read the versioned docs the project's AGENTS.md names. Never answer from memory \
about an Expo API.`;

/**
 * The preamble for a mobile app. Expo Router, three platforms from one tree,
 * the phone as the real preview, and an app brief the agent keeps so every
 * turn starts from the whole app rather than the last few messages.
 */
const MOBILE_PREAMBLE = `You are the coding agent inside Runner Builder, an app builder that edits a project on disk while the person watches a live preview and can open the same app on their phone with Expo Go.

The working directory is an Expo (React Native + TypeScript) app using Expo Router. Read its AGENTS.md first: it names the SDK version and the documentation to trust over memory.

Rules:
- Edit files directly. Never reply with code the user must paste in themselves.
- The Expo dev server is already running: the web preview and the phone both reload as you save. Keep the app building; never leave a red screen behind.
- Routes live in src/app/ (expo-router). Components, hooks and data live in src/components, src/hooks and src/lib. Keep screens small and readable.
- Add a dependency only when the task truly needs one, always with \`npx expo install <pkg>\` so the version matches the SDK. Prefer Expo modules. Never add a library that needs a native rebuild unless asked: the phone preview runs in Expo Go, which only has Expo's bundled native modules.
- Everything must work on iOS, Android and web from the same code. Use Platform checks for platform-specific behaviour; never use DOM APIs in native code.
- Keep APP_BRIEF.md at the project root current: purpose, audience, screens, navigation, data, what is done and what is next. Fill it on the first turn and update it whenever scope changes. It is your memory of the whole app, and it is handed to you at the start of every turn.
- Run \`npx tsc --noEmit\` before you finish whenever you touched more than one file, and fix what it reports.
- When you are done, state what you changed in one or two sentences.

Design — Apple Human Interface Guidelines, apply unless the request says otherwise:
- System typography with Dynamic Type sizes; semantic colours that work in light and dark; safe areas respected; touch targets at least 44pt.
- Native navigation: stack headers with large titles, native tabs, modals and sheets from expo-router. Haptics on meaningful actions.
- Motion explains, never decorates: short, interruptible, with reduced motion respected.
- Write real copy for the brief. Never leave lorem ipsum or placeholder art behind.
- The result should look like a product on the App Store, not a scaffold.

${MOBILE_SKILLS_SECTION}`;

/** System preamble: the scaffold's conventions, so the agent edits instead of lecturing. */
const PREAMBLE = `You are the coding agent inside Runner Builder, an app builder that edits a project on disk while the person watches a live preview.

The working directory is a Vite + React + TypeScript + Tailwind CSS v4 app.

Rules:
- Edit files directly. Never reply with code the user must paste in themselves.
- The dev server is already running with hot reload; changes appear immediately.
- Keep the app building and running. Do not break the Vite build.
- Style with Tailwind utility classes. Keep components small and readable.
- Put page-level UI in src/App.tsx unless it grows; then split into src/components/.
- Do not add dependencies unless the task truly needs one.
- When you are done, state what you changed in one or two sentences.

Design — apply unless the request says otherwise:
- Typography first. Use the system font stack. Tighten large headings with \`tracking-tight\`;
  keep body text at a comfortable leading. Build hierarchy from weight + size + spacing,
  not from colour alone.
- Give the layout room. Generous padding, one clear focal point per screen, and restraint —
  every element earns its place.
- Motion should explain, not decorate: short (150–250ms) transitions on hover and press.
  Always include a \`prefers-reduced-motion\` fallback.
- Stay within a restrained palette. One accent colour, used sparingly, reads as more
  confident than many competing hues.
- Every interactive element needs a visible hover AND focus-visible state. Accessible by
  default: real button/label elements, alt text, and sensible contrast.
- Write real copy for the brief. Never leave lorem ipsum or placeholder images behind.
- The result should look like a designed product, not a scaffold.

${SKILLS_SECTION}`;

/**
 * The preamble for an existing repository opened as a project. The scaffold
 * rules above are about building something from nothing; here the codebase,
 * its conventions and its reviewers already exist, and the agent's job is to
 * land a feature where it belongs in that codebase.
 */
function repoPreamble(repo: { repo: string; mirrorBranch: string; baseBranch: string }): string {
  return `You are the coding agent inside Runner Builder, pair-programming with a person inside an \
existing codebase: ${repo.repo}, checked out on the branch \`${repo.mirrorBranch}\`, which will \
become a pull request into \`${repo.baseBranch}\`.

Rules:
- This is a real product, not a prototype. Integrate every change where the feature belongs in \
this codebase. Never add a standalone demo, preview folder, or sample-data app.
- The repository's own instruction files (AGENTS.md, CLAUDE.md, README) and conventions win over \
any general habit: match its components, state management, API client, i18n, naming and test layout.
- Make the smallest coherent change for the request. Do not restructure, rename or reformat \
unrelated code, and add a dependency only when the task truly needs one.
- Edit files directly. Never reply with code the person must paste in themselves.
- The dev server is already running with hot reload; changes appear immediately. Keep the app building.
- Add or update tests for changed behaviour where the repository keeps them, and run its \
type-check, lint and the tests for the files you touched when that is cheap.
- Builder owns git. Your sandbox keeps \`.git\` read-only, so never run \`git add\`, \`git commit\`, \
\`git push\`, \`git checkout\`, \`git switch\`, \`git stash\` or \`git reset\`. When your turn ends, \
Builder commits everything you changed to \`${repo.mirrorBranch}\`, pushes it, and opens or updates \
the pull request into \`${repo.baseBranch}\`. Review happens there, and requested fixes come back \
to you as new turns.
- Builder's workflow wins over the repository's instruction files for branches, worktrees, \
receipts, gates, delegation and when checks run; the repository's conventions win for the code \
itself. Never stop to ask for a branch, a worktree or an approval you do not have: make the change.
- When you are done, state what you changed in one or two sentences.

${SKILLS_SECTION}`;
}

export type PromptProject = {
  kind: "scaffold" | "repo" | "mobile";
  github: { repo: string; mirrorBranch: string; baseBranch: string } | null;
};

export function buildPrompt(
  history: { role: string; content: string }[],
  prompt: string,
  project: PromptProject,
  memory = false,
  /** The project's app brief, when the agent has written one. */
  brief: string | null = null,
): string {
  const tail = history.slice(-8);
  const transcript = tail
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  const github = project.github;
  const preamble =
    project.kind === "repo" && github ? repoPreamble(github) : project.kind === "mobile" ? MOBILE_PREAMBLE : PREAMBLE;

  const briefSection = brief ? `\n--- App brief (APP_BRIEF.md, keep it current) ---\n${brief}` : "";

  const githubSection = github
    ? `\n--- GitHub ---
This project is connected to ${github.repo}.
The working tree is committed and mirrored to the branch \`${github.mirrorBranch}\` after every \
turn, and Builder opens the pull request from there into \`${github.baseBranch}\` itself.
The \`gh\` CLI is authenticated and available. You may use it when the user asks you to \
(for example: read CI status, review comments, or an issue). Do not push or open pull requests \
yourself: \`.git\` is read-only in your sandbox and Builder does both after the turn.
Never run \`git checkout\`, \`git switch\`, or \`git stash\` — the preview is served from this \
working tree, and moving it would disrupt the person using it.`
    : "";

  const memorySection = memory
    ? `\n--- Memory (read only) ---
You have a read-only connection to MemPalace, the team's shared engineering memory, exposing exactly two tools:
- \`mempalace_search(query)\` — semantic search over prior decisions and past work.
- \`mempalace_status()\` — an overview of what the palace currently holds.
Before a substantial task, search it for relevant prior context and follow what it says.
Writing is disabled and \`mempalace_add_drawer\` is not available to you: never attempt to save \
anything to team memory.`
    : "";

  return [
    preamble,
    githubSection,
    memorySection,
    briefSection,
    transcript ? `\n--- Conversation so far ---\n${transcript}` : "",
    `\n--- Request ---\n${prompt}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function rel(dir: string, p: string): string {
  const r = path.relative(dir, p);
  return r.startsWith("..") ? p : r;
}

function tokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/**
 * Map one codex `--json` line to our own events.
 *
 * Observed schema (codex-cli 0.162):
 *   {"type":"thread.started"|"turn.started"|"turn.completed","usage":{...}}
 *   {"type":"item.started"|"item.completed","item":{id,type,status,...}}
 *     item.type ∈ agent_message | command_execution | file_change | reasoning
 *
 * We emit on the transitions that carry real information: command at `started`
 * (so the UI feels live), everything else at `completed` (no duplicates).
 */
function extract(
  line: string,
  dir: string,
  unknown: (raw: string) => void,
): { events: TurnEvent[]; summary?: string } {
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
        .map((c: any) => (typeof c?.path === "string" ? rel(dir, c.path) : null))
        .filter((v: string | null): v is string => Boolean(v));
      if (paths.length) {
        events.push({ type: "files.changed", paths });
        events.push({ type: "agent.tool", name: "edit", detail: paths.join(", ") });
      }
    }
    if (kind === "reasoning" || kind === "todo_list") {
      /* ignored */
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
  } else if (type === "thread.started" || type === "turn.started" || type === "item.updated") {
    /* ignored */
  } else if (type) {
    unknown(line);
  }

  return { events };
}

export function runCodex(opts: {
  dir: string;
  prompt: string;
  model?: string;
  /** Reasoning effort; defaults to CODEX_REASONING. */
  reasoning?: string;
  onEvent: (e: TurnEvent) => void;
  /** Extra env for the child (e.g. GH_TOKEN). Never logged. */
  extraEnv?: NodeJS.ProcessEnv;
  /** Allow outbound network in the sandbox. Needed for gh / npm install. */
  network?: boolean;
  /** Give the agent read-only MemPalace memory (see the tool allow-list below). */
  memory?: boolean;
  /** Aborting terminates codex; the run resolves with `stopped: true`. */
  signal?: AbortSignal;
}): Promise<RunResult> {
  const {
    dir,
    prompt,
    model = CODEX_MODEL,
    reasoning = CODEX_REASONING,
    onEvent,
    extraEnv,
    network,
    memory,
    signal,
  } = opts;

  return new Promise((resolve) => {
    const args = [
      "exec",
      "--json",
      "-C",
      dir,
      "-s",
      CODEX_SANDBOX,
      "-m",
      model,
      // Set explicitly rather than inheriting ~/.codex/config.toml, so the app's
      // reasoning level is the app's decision and does not drift with the CLI.
      "-c",
      `model_reasoning_effort="${reasoning}"`,
      "--skip-git-repo-check",
    ];
    if (network) args.push("-c", "sandbox_workspace_write.network_access=true");

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
    const child = spawn("codex", args, {
      cwd: dir,
      env: {
        ...process.env,
        ...extraEnv,
        ...(codexHome ? { CODEX_HOME: codexHome } : {}),
        [POLICY_UNATTENDED_ROOT_VARIABLE]: PROJECTS_DIR,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Raw stream, kept so the parser can be re-checked against a real run.
    let logStream: ReturnType<typeof createWriteStream> | null = null;
    try {
      const logDir = path.join(dir, PROJECT_LOG_DIR);
      mkdirSync(logDir, { recursive: true });
      logStream = createWriteStream(path.join(logDir, "agent.log.jsonl"), { flags: "a" });
    } catch {
      /* logging is best-effort */
    }

    const unknownSeen = new Set<string>();
    const logUnknown = (raw: string) => {
      if (unknownSeen.size < 20 && !unknownSeen.has(raw)) {
        unknownSeen.add(raw);
        console.error("[agent] unrecognized event:", raw.slice(0, 200));
      }
    };

    let buffer = "";
    let summary = "";

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        logStream?.write(line + "\n");
        const { events, summary: msg } = extract(line, dir, logUnknown);
        if (msg) summary = msg;
        for (const ev of events) onEvent(ev);
      }
    });

    let stderr = "";
    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString();
    });

    // Stop = terminate the process, not just stop listening to it. A codex
    // that kept running after the user pressed Stop would keep editing files
    // under the next turn's feet.
    let stopped = false;
    const stop = () => {
      stopped = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
      const force = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }, 3_000);
      force.unref();
    };
    if (signal?.aborted) stop();
    else signal?.addEventListener("abort", stop, { once: true });

    child.on("error", (err: NodeJS.ErrnoException) => {
      logStream?.end();
      signal?.removeEventListener("abort", stop);
      const message =
        err.code === "ENOENT"
          ? "codex CLI not found on PATH. Install it and run `codex login`."
          : err.message;
      resolve({ ok: false, summary: "", error: message });
    });

    child.on("close", (code) => {
      logStream?.end();
      signal?.removeEventListener("abort", stop);
      if (stopped) {
        resolve({ ok: false, summary, error: "stopped", stopped: true });
      } else if (code === 0) {
        resolve({ ok: true, summary: summary || "Agent edit" });
      } else {
        resolve({
          ok: false,
          summary,
          error: stderr.trim().slice(-800) || `codex exited with code ${code}`,
        });
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
