# Runner Builder

Runner's app builder: describe an app in a chat, an agent writes it to disk, and you
watch it come to life in a live preview next to the conversation.

The code generator is **a CLI you already have**: the Codex CLI on your ChatGPT
subscription, Claude Code on your Anthropic subscription, Gemini CLI on your Google
account, or a local model through Ollama. There is no third-party builder account, no
cloud, and no data leaving the machine except the model calls your own login already
makes.

Open source under the [GNU AGPL-3.0](LICENSE); commercial licenses are available from
Runner AI. **Powered by [Runner AI](https://therunner.ai).**

## What you can build

| Kind | What it is | Preview | Ship |
|---|---|---|---|
| **Web app** | A Vite + React + Tailwind site or web app started from the builder's scaffold | Live Vite dev server in the frame, element picking | **Publish** makes a production build; push to GitHub |
| **Mobile app** | An Expo (React Native) app for iOS and Android started from the Expo scaffold | Web build in a phone frame, the real app in Expo Go on your phone | **Release** builds in Expo's cloud and submits to TestFlight and Google Play |
| **Existing repository** | A real codebase cloned from GitHub at a base branch | The repository's own dev server | Every turn is a commit on a feature branch; the builder opens the pull request |

The same chat, agent, history and revert work for all three. The agent runs on **your own
subscription** through the Codex CLI, Claude Code or Gemini CLI, chosen per workspace, or
on a **local model** (see [Agents](#agents) and [Local models](#local-models)).

## A free, open-source alternative to the hosted builders

Runner Builder does what people use **Lovable, Bolt.new, v0, Replit Agent, Base44, Rork and
Vibecode** for, without the parts that make them expensive or closed:

| | Hosted builders | Runner Builder |
|---|---|---|
| Price | Credits or a monthly plan per builder | Free. Your existing ChatGPT subscription, or a local model at no cost |
| Where your code lives | Their cloud, exported on request | Your disk, a git repository from the first turn |
| Model | Theirs, fixed | Codex, Claude Code or Gemini CLI per workspace; local models through Ollama, LM Studio or any Responses-API server |
| Mobile | Some; web wrappers or paid tiers | Native Expo apps, phone preview, App Store and Google Play through EAS |
| Existing codebases | Rarely | Open any GitHub repository, work on a branch, get a pull request |
| Lock-in | Account, credits, hosting | None. Stop the process and the project is still a normal project on disk |

The trade: you run it yourself, on your machine, with your own accounts. That is the point.

---

## What works today

| Capability | Status |
|---|---|
| Dashboard: projects, sidebar, composer | ✅ |
| Create a project from a prompt on the dashboard | ✅ |
| Chat → agent edits files on disk | ✅ |
| Live preview in an iframe (real Vite dev server, HMR) | ✅ |
| Streaming agent output (text, commands, file edits, token usage) | ✅ |
| **Queue follow-ups** while the agent works; they run in order. Stop really stops | ✅ |
| **Select element** — click a thing in the preview to target an edit | ✅ |
| Code tab (file tree + viewer) · Files tab | ✅ |
| Revert to any previous turn (git-backed) | ✅ |
| Publish (real production build) | ✅ |
| Mobile device frame in the preview | ✅ |
| **Accounts** — first-run claim, then owner-created accounts | ✅ |
| **Workspaces** — projects scoped to a workspace, with members and roles | ✅ |
| **GitHub** — pick a repository from your account, mirror work, open PRs | ✅ |
| **Read-only team memory** — the agent can search MemPalace, never write | ✅ |
| Light + dark, reduced-motion aware | ✅ |
| **Mobile apps** — an Expo (React Native) project kind: phone preview via Expo Go, web preview in the frame, EAS cloud builds and store submission from a Release panel | ✅ |
| **Agent per workspace** — Codex, Claude Code or Gemini CLI from the sidebar; **effort per project** from the composer | ✅ |
| CI on every pull request: both type-checks and the UI build | ✅ |

Not built (deliberately): billing, cloud deploys, custom domains, database hosting,
connectors.

## Mobile apps

"Mobile app" on the dashboard (or **New mobile app** in the sidebar) starts an Expo
project from `templates/scaffold-expo`: Expo Router, TypeScript, `react-native-web`, and
the Expo SDK the template pins. The same agent builds it, with a mobile preamble: Expo
Router under `src/app/`, Apple Human Interface Guidelines, `npx expo install` for every
dependency, and an `APP_BRIEF.md` it keeps at the project root as its memory of the
whole app (purpose, screens, data, done, next). The brief is handed to the agent at the
start of every turn, so a long project does not degrade into the last eight messages.

The preview runs the project's own Expo dev server. The frame shows the web build; **Open
on your phone** shows the QR code Expo Go scans over LAN (`exp://<lan address>:<port>`).
Expo Go only opens projects from the same Expo account as the dev server, so sign in
once with `npx expo login` and in Expo Go, and the panel names the account it sees. It
also names the **Expo SDK** the app runs on: Expo Go runs exactly one SDK, the one the App
Store and Play Store currently ship, so the template pins that version and is bumped only
after the stores move. "This project requires a newer version of Expo Go" means the phone
is behind; "too old" means the template is.

After every mobile turn the project is type-checked (`tsc --noEmit`). If it fails, the
agent gets one fix turn with the compiler's output, inside the same turn and commit, so a
red screen is caught before anyone sees it. `BUILDER_SELF_CHECK=0` turns this off.

**Release** replaces Publish for a mobile app. It records the iOS bundle id and Android
package in `app.json` (a version of its own), links the project to EAS on the first
build, and queues `eas build` in Expo's cloud for the chosen platforms and profile:
`preview` for installable test builds, `production` for store-ready ones, optionally with
`--auto-submit` to TestFlight and the Play internal track. Before the upload the builder
untracks a committed `node_modules` link and resolves the project's lockfile against its
`package.json`, because the build machine installs with `npm ci` and refuses a lockfile
that has drifted. Nothing is compiled on this
machine. An Android build creates its signing key in EAS on the first run, unattended;
an iOS build needs your Apple Developer sign-in once (`npx eas-cli credentials` in the
project), and an iOS submission needs the **App Store Connect app id** of the app record
you created there, which the Release dialog records in `eas.json`. Store listings,
screenshots and App Review stay yours.

The agent's skills for mobile come from the official Expo plugin for Codex
(`codex plugin add expo@openai-curated`): `building-native-ui`, `native-data-fetching`,
`expo-deployment` and the rest are linked into the builder's Codex home from the plugin
cache (`BUILDER_CODEX_PLUGINS`, default `expo`), alongside `react-native-patterns` and
`liquid-glass-design` from the Claude plugin cache (`BUILDER_CLAUDE_PLUGIN_SKILLS`). The
builder home also declares the Expo MCP server (current docs, `expo install`, EAS builds,
TestFlight crashes); sign it in once with
`CODEX_HOME=~/.runner-builder/codex-home codex mcp login expo`, or set `BUILDER_EXPO_MCP=0`.

`npm run setup` installs both templates' dependencies. Every mobile project symlinks the
Expo template's `node_modules`; its `metro.config.js` watches the real directory so Metro
resolves through the link, and the agent's sandbox reads through it too, so `npx tsc`,
`npx expo lint` and `npx expo install` work inside a turn. The link is checked before
every turn and restored if something removed it.

---

## Architecture

```
apps/web      builder UI        Vite · React · Tailwind v4 · framer-motion
apps/server   orchestrator      Fastify · SQLite or Postgres · git
packages/shared  shared types
templates/scaffold   what every new project starts from
```

```
builder UI ──REST + SSE──▶ orchestrator ──▶ per-project Vite or Expo dev server ──▶ preview iframe
                                │
                                ├─▶ apps/server/src/agents: codex exec · claude -p · gemini -p  (the agent)
                                ├─▶ git commit per turn  (history / revert)
                                └─▶ SQLite (users · sessions · workspaces · projects · messages · edits · releases)
```

**One agent turn = one `edits` row = one git commit.** That is what makes
"Revert to this version" instant and exact.

Projects live in `~/.runner-builder/projects/<id>/`. Each new project symlinks a single
installed `node_modules` from `templates/scaffold`, so creating a project is instant
rather than a fresh 20-second install.

Project dev servers are spawned **detached** and re-adopted on boot by their persisted
port, so restarting the orchestrator does not kill the previews a user has open.

---

## Setup

Requires Node ≥ 22 and the Codex CLI logged in (`codex login`).

```bash
npm install
npm run setup     # installs the scaffold's deps once (shared by all projects)
npm run dev       # orchestrator on :4310, builder UI on :4311
```

Open <http://localhost:4311> and create the first account — it becomes the workspace
owner, and any projects that predate accounts are adopted into your workspace.

Ports are configurable: `PORT=4310` for the orchestrator (also update the `proxy`
target in `apps/web/vite.config.ts` and its `server.port`).

Data lives under `~/.runner-builder` (override with `BUILDER_HOME`). On first boot after
an upgrade from the pre-rename layout, an existing `~/.lovable-local` directory is adopted
in place: the directory and database are renamed and every project row is repointed, so
nothing has to be recreated.

### Database

SQLite (`~/.runner-builder/builder.db`, via `node:sqlite`) is the default and needs
nothing installed. To run against Postgres instead, start the local container and point
the server at it:

```bash
docker compose up -d postgres
BUILDER_DATABASE_URL=postgres://runner_builder:runner_builder@127.0.0.1:5433/runner_builder npm run dev
```

The schema is created and migrated on boot on either driver. Legacy `~/.lovable-local`
adoption is SQLite-only: it moves the builder's own database file, and there is nothing
to move for a Postgres database.

---

## Working on an existing repository

"Work on a repository" in the sidebar opens a real codebase as a project: pick the
repository, the branch the work merges into (Runner repositories use `staging`), and
name the feature. The repository is cloned at that branch, its dependencies installed,
and the project put on its own branch, `builder/<feature>-<id>`. The preview is the
repository's own Vite dev server, every turn is a commit on that branch, and the
pull request targets the base. The agent is told it is inside a real product and must
integrate changes where they belong, following the repository's own instruction files.

Previews currently need a Vite app with its dependencies installed. A real app's preview
is only the app if it can reach a backend, so repository previews get
`BUILDER_PREVIEW_ENV` (comma-separated `KEY=VALUE` pairs) in their environment, for
example `RUNNER_DEV_API_TARGET=https://api-staging.example.com` to point a frontend's
dev proxy at a staging API. Unset, nothing is added. The repository's own `.env.local`
still applies, since Vite loads it itself. See `.env.example` for every variable.

## The agent's Codex home

The agent runs from a builder-owned Codex home (`~/.runner-builder/codex-home`, or
`BUILDER_CODEX_HOME`), not from `~/.codex`: a personal home carries plugins and hooks
meant for interactive terminal sessions, which would stop an unattended agent at its
first write inside a gated repository. The builder home holds:

- the **login**: your terminal's login by symlink at first, or an account connected
  from the sidebar's **ChatGPT** row through a one-time code, which is how someone with
  several accounts chooses which one the agent spends;
- the **read-only MemPalace** server (`BUILDER_MEMPALACE_URL`);
- **skills**, linked from `~/.codex/skills` (the `runner-*` skills) and the named design
  skills from `~/.claude/skills` (`apple-design` first; `BUILDER_CLAUDE_SKILLS`). The
  agent is told to apply `apple-design` to every piece of UI work.

`BUILDER_CODEX_ISOLATED=0` runs the agent from your own Codex home instead.

## Accounts and workspaces

Local-first: SQLite is the account of record, so the tool keeps its no-cloud property.
Passwords are hashed with `scrypt` and sessions are opaque tokens — only the token's
SHA-256 is stored, so a leaked database yields no usable session.

The first account is claimed at `/login`; there is no open self-signup, because on a
local machine that would let any local process mint an identity. Further accounts are
created by a workspace owner from the members dialog.

A **workspace** is the tenant. Every project belongs to exactly one, and access is a
`(workspace_id, user_id, role)` row:

| Role | May |
|---|---|
| `viewer` | read projects, files, messages, GitHub state |
| `editor` | + run turns, preview, publish, revert, sync, open PRs |
| `owner` | + delete projects, manage members, connect/disconnect GitHub |

Enforcement is server-side only; the UI hiding a control is convenience, not the
boundary. A project that is not yours answers 404, not 403, so a probe cannot tell a
hidden project from a missing one.

---

## How a turn runs

1. The UI POSTs the prompt; the server answers with an SSE stream.
2. The server writes the user message, boots the project's dev server if needed, checks
   the project's `node_modules` link, and spawns the workspace's agent. With Codex:
   ```
   codex exec --json -C <project> -s workspace-write -m gpt-6-astra \
              -c model_reasoning_effort="high" --skip-git-repo-check
   ```
   with a system preamble describing the scaffold's conventions.
3. Each JSON line is parsed into `agent.delta` / `agent.tool` / `files.changed`
   and streamed to the UI. The raw stream is kept at
   `<project>/.builder/agent*.log.jsonl` for debugging the parser.
4. On exit: `git add -A && git commit`, one `edits` row, `turn.completed`.

Turns on a project run **one at a time**. A prompt sent while a turn is running is
queued in the UI and starts when the turn ends, with that turn's result in its
history; a second client that posts a turn meanwhile waits server-side and is told
how many turns are ahead (`turn.queued`). Pressing **Stop** closes the stream, which
terminates the codex process; anything it had already written is committed as its
own `Stopped: …` version so it stays revertable, and queued prompts are discarded.

### Effort

How hard the agent thinks is a per-project choice in the composer (the gauge chip next
to **Select element**), from the levels the workspace's agent accepts. Unset, a project
gets the builder's default for its kind: `BUILDER_REASONING` (default `xhigh`) for web
and repository turns and `BUILDER_MOBILE_REASONING` (default `high`) for mobile turns,
which read several skills and the app brief every time and get expensive fast at the top
levels. `gpt-6-astra` supports `low | medium | high | xhigh | max | ultra`; Claude Code
`low | medium | high | xhigh | max`; Gemini CLI has no levels. `BUILDER_SANDBOX` and
`BUILDER_MODEL` still override the Codex sandbox and model.

## Agents

The agent is a CLI the builder drives, and a workspace chooses which one from the
sidebar's **Agent** row (owners only; the change applies to every project in the
workspace from its next turn). `BUILDER_AGENT` sets the default for workspaces that have
not chosen. All three are the person's own installed, signed-in CLI; the builder holds no
model key.

| Agent | Command | Isolation | Permissions |
|---|---|---|---|
| **Codex** (default) | `codex exec --json` from the builder's own Codex home | Codex's OS sandbox, `workspace-write` | Edits the project; network only for repository projects |
| **Claude Code** | `claude -p --output-format stream-json --safe-mode` | `--safe-mode`: your hooks, plugins, MCP servers and `CLAUDE.md` stay out of the agent's way, your login still works | Edits are approved; commands come from an allow-list (the type-check, Expo's install/lint/export, the project's lint, build, typecheck and test scripts, reading the tree, read-only git) and a command outside it is denied. The list is a permission filter, not an OS sandbox: an allowed script runs whatever the project defines for it. Extend with `BUILDER_CLAUDE_ALLOWED_TOOLS` |
| **Gemini CLI** | `gemini -p --output-format stream-json --approval-mode yolo` | None | Approves every tool call; there is no allow-list to hand it. Written from the documentation and not yet exercised against a signed-in CLI |

Skills reach Codex through its home; Claude Code and Gemini CLI are pointed at the same
folder (`--add-dir`, `--include-directories`) and told where the skills live, so every
agent sees the same design and framework guides. Read-only MemPalace memory is wired
through Codex's MCP configuration only. Codex runs with its built-in ChatGPT connector
server switched off (`--disable apps`): an unattended agent has no use for it, and its
tool definitions would ride along on every call.

### Local models

Codex can run a local model instead of the subscription. `ollama` and `lmstudio` are
Codex's own built-in providers (`codex exec --oss`), so a local model is two settings:

```bash
ollama pull gpt-oss:20b
BUILDER_PROVIDER=ollama BUILDER_MODEL=gpt-oss:20b npm run dev
```

With a provider set, the default effort is `none`: no reasoning level is sent, which a
model without a thinking mode needs (one that has it takes `BUILDER_REASONING=medium`).
Give the server room for a turn: a builder prompt carries a few thousand tokens of
instructions, the app brief and the tool definitions before the model writes a line, and
Ollama's default context window is 4096 tokens, which ends a turn with "something went
wrong". Run Ollama with `OLLAMA_CONTEXT_LENGTH=32768` (or set the context length in the
Ollama app's settings) and pick a model that supports tool calls.
`BUILDER_PROVIDER_URL` names the server root when it is not Ollama's
`http://localhost:11434`. Any other provider name is a self-hosted OpenAI-compatible
server (vLLM, llama.cpp, a gateway) declared in the agent's Codex home from the required
`BUILDER_PROVIDER_URL` (ending in `/v1`); Codex speaks only the Responses API to it, which
Ollama and current vLLM serve. `BUILDER_PROVIDER_KEY_ENV` names an env variable holding a
key for servers that want one. Everything else is unchanged: the sandbox, one commit per
turn, the preview. Expect a local model to be slower and less capable than the hosted
frontier models on full app builds; it shines for edits and for working offline. The
ChatGPT login is not needed in this mode.

---

## GitHub

Connecting starts from the repositories your active `gh` account can actually reach —
including your organisation's, which a plain `gh repo list` hides. The dialog names the
account `gh` is acting as and can switch it (`gh auth switch`, which is machine-wide).

Work mirrors to a `builder/work` branch; **the repository's default branch is never
touched**, and pull requests are opened from the mirror. The branch they target is a
per-project setting in the GitHub dialog ("Pull requests into"), so a Runner repository
can take its pull requests on `staging` while the mirror and the default branch stay
untouched. Connecting an existing
repository creates that branch — the dialog says so before you commit to it.

---

## Memory (MemPalace)

If `MEMPALACE_TOKEN` is present, the agent gets a **read-only** connection to the team's
shared engineering memory: it can search and read the palace overview, and cannot write.
That is enforced structurally — `enabled_tools` advertises only the two read tools, so
the write tool is not callable — rather than by asking the agent nicely.

MemPalace is team-visible and shared, which is why the agent cannot write to it and why
the connection can be disabled with `BUILDER_MEMPALACE=0`.

---

## API

```
GET    /api/health
GET    /api/auth/me                 POST /api/auth/login · logout · bootstrap · users
GET    /api/agents
GET    /api/workspaces              POST /api/workspaces      PATCH /api/workspaces/:id (agent)
GET    /api/workspaces/:id/members  POST · PATCH · DELETE members
GET    /api/github/repos            GET  /api/github/accounts
POST   /api/github/accounts/switch
GET    /api/projects                POST /api/projects
GET    /api/projects/:id            DELETE /api/projects/:id
GET    /api/projects/:id/files      GET  /api/projects/:id/file?path=
POST   /api/projects/:id/preview    PATCH /api/projects/:id/settings (reasoning)
POST   /api/projects/:id/turn       → SSE event stream
GET/POST /api/projects/:id/release[/identity|/submission]   GET /api/projects/:id/releases
POST   /api/projects/:id/revert
POST   /api/projects/:id/publish
GET/POST/DELETE /api/projects/:id/github[/connect|/sync|/pr|/settings]
```

Every route requires a session except `/api/health` and `/api/auth/*`.

---

## Design

Apple's system colours, used as published: the semantic label and background hierarchy,
plus the system accent set (blue, green, indigo, orange, pink, purple, red, teal,
yellow), each as the platform's own light/dark pair.

The interface follows Apple's fluid-interface principles: translucent chrome
(`backdrop-filter`) rather than solid bars, interruptible springs over fixed-duration
easing, size-specific tracking, and an explicit `prefers-reduced-motion` path. The system
font (`system-ui`) is used deliberately — it ships SF Pro's optical sizing on macOS.

---

## Known limitations

- The parsers are written against `codex-cli 0.163`'s and Claude Code 2.1's event
  schemas, and Gemini CLI's from its documentation; unknown events are logged rather than
  failing the turn.
- **Running `vite build` creates `apps/web/dist`, and the orchestrator serves that
  directory when it exists** — so a restart after a build serves a frozen UI on :4310.
  Delete it if the orchestrator should stay API-only.
- There is no file-system isolation between workspaces: this is logical multi-tenancy on
  one trusted OS user, and every project directory is readable by any local process.
- Preview dev servers run unauthenticated on their own ports.
- GitHub actions run through a single shared server-side `gh` credential, so an `editor`
  can sync and open PRs as the token's owner. Per-user tokens are the real fix.
- Forgotten passwords have no reset flow; the only recovery is deleting the `users` row
  from `~/.runner-builder/builder.db`.
- Attachments in the composer are not wired up yet.
- Publish produces a build; it does not yet serve the built output on a stable URL.
- CI type-checks and builds; there is no test suite yet, so behaviour is verified by hand.

---

## Roadmap

- **Expo tools sign-in from the UI**: the Expo MCP login (`codex mcp login expo`) still
  needs a terminal and a browser; the ChatGPT row's one-time-code flow is the model.
- **Device preview on iOS simulators and Android emulators** where the machine has them.
- **Store listing help**: screenshots, description and privacy answers drafted by the agent
  for App Store Connect and the Play Console.

---

## Contributing

Pull requests are welcome and are merged with a maintainer's approval. Read
[CONTRIBUTING.md](CONTRIBUTING.md) for the product rules and the setup, and
[SECURITY.md](SECURITY.md) for reporting a vulnerability privately. Everyone here follows
the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Runner Builder is free software under the [GNU Affero General Public License v3.0](LICENSE).
You may use, modify and redistribute it under those terms; if you run a modified version as
a service, the AGPL requires you to make your modifications available to its users. A
commercial license without that obligation is available from
[Runner AI](https://therunner.ai). Contributions are accepted under the
[Contributor License Agreement](CLA.md).

© 2026 Runner AI. Powered by [Runner AI](https://therunner.ai).
