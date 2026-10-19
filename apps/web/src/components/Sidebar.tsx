import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Bot, Check, ChevronDown, FolderOpen, Github, KeyRound, LogOut, Plus, Smartphone, Users } from "lucide-react";
import type { AgentsInfo, Project } from "@runner-builder/shared";
import { Button, SPRING, cx } from "./ui";
import { MembersDialog } from "./MembersDialog";
import { GithubConnectDialog } from "./GithubConnectDialog";
import { CodexDialog } from "./CodexDialog";
import { AgentDialog } from "./AgentDialog";
import { getAgents, getCodex, listGithubAccounts, type CodexAccount } from "../lib/api";
import { relativeTime } from "../lib/format";
import { useSession } from "../lib/session";

/**
 * Brand lockup. The Runner mark is a dark glyph on transparency, so it is
 * inverted on dark chrome where it would otherwise disappear; the letter mark
 * stands in only if the asset fails to load.
 */
function BrandMark() {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-ink text-[13px] font-semibold text-canvas">
        R
      </span>
    );
  }
  return (
    <img
      src="/runner-logo.png"
      alt=""
      className="size-7 shrink-0 object-contain dark:invert"
      onError={() => setFailed(true)}
    />
  );
}

/** Workspace switcher: the tenant the project list below is scoped to. */
function WorkspacePicker() {
  const { workspaces, workspace, selectWorkspace, addWorkspace } = useSession();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [name, setName] = useState("");

  if (workspaces.length === 0 && !creating) {
    return (
      <button
        type="button"
        onClick={() => setCreating(true)}
        className="w-full rounded-[10px] border border-dashed border-hairline px-2.5 py-2 text-left text-[12.5px] text-muted hover:text-ink"
      >
        Create a workspace
      </button>
    );
  }

  if (creating) {
    return (
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const value = name.trim();
          if (!value) return;
          await addWorkspace(value);
          setName("");
          setCreating(false);
        }}
      >
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => !name.trim() && setCreating(false)}
          placeholder="Workspace name"
          className="w-full rounded-[10px] border border-hairline bg-surface px-2.5 py-2 text-[12.5px] outline-none focus-visible:border-accent"
        />
      </form>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-[10px] border border-hairline px-2.5 py-2 text-left transition-colors hover:bg-[color-mix(in_oklab,var(--c-ink)_6%,transparent)]"
        >
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
            {workspace?.name ?? "Workspace"}
          </span>
          <ChevronDown size={14} className="shrink-0 text-faint" />
        </button>
        <button
          type="button"
          onClick={() => setMembersOpen(true)}
          aria-label="Members"
          title="Members"
          className="shrink-0 rounded-[10px] border border-hairline p-2 text-faint transition-colors hover:text-ink"
        >
          <Users size={14} />
        </button>
      </div>

      <MembersDialog open={membersOpen} onClose={() => setMembersOpen(false)} />

      {open && (
        <div className="material-panel edge-light absolute inset-x-0 top-[calc(100%+4px)] z-20 rounded-card border border-hairline p-1 shadow-float">
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => {
                selectWorkspace(w.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12.5px] hover:bg-[color-mix(in_oklab,var(--c-ink)_6%,transparent)]"
            >
              <Check
                size={13}
                className={cx("shrink-0", w.id === workspace?.id ? "text-accent" : "text-transparent")}
              />
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              <span className="shrink-0 text-[11px] text-faint">{w.role}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setCreating(true);
            }}
            className="mt-0.5 flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12.5px] text-muted hover:bg-[color-mix(in_oklab,var(--c-ink)_6%,transparent)] hover:text-ink"
          >
            <Plus size={13} className="shrink-0" />
            New workspace
          </button>
        </div>
      )}
    </div>
  );
}

function AccountRow() {
  const { user, signOut } = useSession();
  if (!user) return null;
  return (
    <div className="edge-light flex items-center gap-2 border-t border-hairline px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium">{user.name}</span>
        <span className="block truncate text-[11px] text-faint">{user.email}</span>
      </span>
      <button
        type="button"
        onClick={() => void signOut()}
        aria-label="Sign out"
        title="Sign out"
        className="shrink-0 rounded-[8px] p-1.5 text-faint transition-colors hover:text-ink"
      >
        <LogOut size={14} />
      </button>
    </div>
  );
}

/**
 * GitHub, at last visible.
 *
 * It previously existed only as an unlabelled icon inside a project's top bar,
 * which made connecting effectively undiscoverable. Here it names the account
 * `gh` is acting as, so the answer to "who am I acting as?" is on screen rather
 * than implied.
 */
function GithubRow({ onChanged }: { onChanged: () => void }) {
  const [account, setAccount] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    listGithubAccounts()
      .then((list) => {
        setAccount(list.find((a) => a.active)?.login ?? null);
        setAvailable(true);
      })
      .catch(() => setAvailable(false));
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-[10px] border border-hairline px-2.5 py-2 text-left transition-colors hover:bg-[color-mix(in_oklab,var(--c-ink)_6%,transparent)]"
      >
        <Github size={14} className="shrink-0 text-faint" />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">GitHub</span>
        <span className="shrink-0 max-w-[110px] truncate text-[11px] text-faint">
          {available === false ? "unavailable" : (account ?? "—")}
        </span>
      </button>

      <GithubConnectDialog
        open={open}
        onClose={() => setOpen(false)}
        onChanged={onChanged}
      />
    </>
  );
}

/** The coding agent this workspace runs on, with the dialog to change it. */
function AgentRow() {
  const { workspace } = useSession();
  const [info, setInfo] = useState<AgentsInfo | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getAgents().then(setInfo).catch(() => setInfo(null));
  }, []);

  const id = workspace?.agent ?? info?.default ?? null;
  const status = info?.agents.find((a) => a.id === id) ?? null;
  const label = status ? status.label : "—";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-[10px] border border-hairline px-2.5 py-2 text-left transition-colors hover:bg-[color-mix(in_oklab,var(--c-ink)_6%,transparent)]"
      >
        <Bot size={14} className="shrink-0 text-faint" />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">Agent</span>
        <span
          className={cx(
            "shrink-0 max-w-[120px] truncate text-[11px]",
            status && !status.installed ? "text-danger" : "text-faint",
          )}
        >
          {label}
          {workspace?.agent ? "" : status ? " · default" : ""}
        </span>
      </button>

      <AgentDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** The ChatGPT account the agent runs as, with the dialog to change it. */
function CodexRow() {
  const [account, setAccount] = useState<CodexAccount | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getCodex().then(setAccount).catch(() => setAccount(null));
  }, []);

  const label = account === null ? "—" : account.connected ? (account.email ?? "connected") : "connect";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-[10px] border border-hairline px-2.5 py-2 text-left transition-colors hover:bg-[color-mix(in_oklab,var(--c-ink)_6%,transparent)]"
      >
        <KeyRound size={14} className="shrink-0 text-faint" />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">ChatGPT</span>
        <span
          className={cx(
            "shrink-0 max-w-[120px] truncate text-[11px]",
            account && !account.connected ? "text-danger" : "text-faint",
          )}
        >
          {label}
        </span>
      </button>

      <CodexDialog open={open} onClose={() => setOpen(false)} onChanged={setAccount} />
    </>
  );
}

export function Sidebar({
  projects,
  activeId,
  onNew,
  onNewMobile,
  onOpenRepo,
  onSelect,
  onProjectsChanged,
}: {
  projects: Project[];
  activeId?: string;
  onNew: () => void;
  /** Start an Expo app for iOS and Android. */
  onNewMobile?: () => void;
  /** Open an existing repository as a project. */
  onOpenRepo?: () => void;
  onSelect: (id: string) => void;
  onProjectsChanged?: () => void;
}) {
  const reduce = useReducedMotion();

  return (
    <aside className="material-chrome edge-light flex h-full w-[268px] shrink-0 flex-col border-r border-hairline">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <BrandMark />
        <span className="min-w-0">
          <span className="title block text-[15px] font-semibold leading-tight">
            Runner <span className="font-normal text-muted">Builder</span>
          </span>
          <a
            href="https://therunner.ai"
            target="_blank"
            rel="noreferrer"
            className="block text-[11px] leading-tight text-faint transition-colors hover:text-muted"
          >
            Powered by Runner AI
          </a>
        </span>
      </div>

      <div className="px-3 pb-2">
        <WorkspacePicker />
      </div>

      <div className="flex flex-col gap-1.5 px-3 pb-2">
        <GithubRow onChanged={() => onProjectsChanged?.()} />
        <AgentRow />
        <CodexRow />
      </div>

      <div className="flex flex-col gap-1.5 px-3 pb-2">
        {onOpenRepo && (
          <Button variant="primary" size="md" className="w-full" onClick={onOpenRepo}>
            <FolderOpen size={15} strokeWidth={2.4} />
            Work on a repository
          </Button>
        )}
        <Button variant={onOpenRepo ? "glass" : "primary"} size="md" className="w-full" onClick={onNew}>
          <Plus size={15} strokeWidth={2.6} />
          New web app
        </Button>
        {onNewMobile && (
          <Button variant="glass" size="md" className="w-full" onClick={onNewMobile}>
            <Smartphone size={15} strokeWidth={2.2} />
            New mobile app
          </Button>
        )}
      </div>

      <div className="mt-1 min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <p className="px-2 pt-3 pb-1.5 text-[11px] font-semibold tracking-wide text-faint uppercase">
          Projects
        </p>

        {projects.length === 0 && (
          <p className="px-2 py-3 text-[13px] text-faint">
            Nothing yet. Create your first project.
          </p>
        )}

        <nav className="flex flex-col gap-0.5">
          {projects.map((p) => {
            const active = p.id === activeId;
            return (
              <motion.button
                key={p.id}
                type="button"
                onClick={() => onSelect(p.id)}
                whileTap={reduce ? undefined : { scale: 0.985 }}
                transition={SPRING}
                className={cx(
                  "group flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left",
                  "transition-colors duration-150",
                  active
                    ? "bg-raised shadow-lift"
                    : "hover:bg-[color-mix(in_oklab,var(--c-ink)_6%,transparent)]",
                )}
              >
                {p.kind === "mobile" ? (
                  <Smartphone size={15} className={active ? "text-accent" : "text-faint"} strokeWidth={2} />
                ) : (
                  <FolderOpen size={15} className={active ? "text-accent" : "text-faint"} strokeWidth={2} />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{p.name}</span>
                  <span className="block truncate text-[11.5px] text-faint">
                    {relativeTime(p.updatedAt)}
                  </span>
                </span>
              </motion.button>
            );
          })}
        </nav>
      </div>

      <AccountRow />
    </aside>
  );
}
