import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Bot, Check, X } from "lucide-react";
import type { AgentProvider, AgentStatus, AgentsInfo } from "@runner-builder/shared";
import { IconButton, SOFT_SPRING, Spinner, cx, useToast } from "./ui";
import { getAgents, setWorkspaceAgent } from "../lib/api";
import { useSession } from "../lib/session";

/**
 * Which coding agent a workspace's turns run on. Every option is a CLI the
 * person already has and has signed in to on this machine; the builder adds no
 * account of its own. Only an owner changes it, and the change applies to
 * every project in the workspace from its next turn.
 */
export function AgentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const reduce = useReducedMotion();
  const { workspace, reloadWorkspaces } = useSession();
  const [info, setInfo] = useState<AgentsInfo | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setInfo(null);
    getAgents()
      .then(setInfo)
      .catch((e: Error) => toast(e.message, "error"));
  }, [open, toast]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, busy]);

  const owner = workspace?.role === "owner";
  const chosen = workspace?.agent ?? null;

  const choose = useCallback(
    async (agent: AgentProvider | null, label: string) => {
      if (!workspace || agent === chosen) return;
      setBusy(true);
      try {
        await setWorkspaceAgent(workspace.id, agent);
        await reloadWorkspaces();
        toast(agent ? `${workspace.name} now runs on ${label}` : `${workspace.name} is back on the default agent`);
      } catch (e) {
        toast((e as Error).message, "error");
      } finally {
        setBusy(false);
      }
    },
    [workspace, chosen, reloadWorkspaces, toast],
  );

  const fallback = info?.agents.find((a) => a.id === info.default) ?? null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !busy && onClose()}
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Coding agent"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 6 }}
            transition={SOFT_SPRING}
            className="material-panel edge-light relative z-10 w-full max-w-[500px] overflow-hidden rounded-panel border border-hairline shadow-float"
          >
            <header className="flex items-center gap-2.5 px-5 pt-4 pb-3">
              <Bot size={17} />
              <h2 className="title flex-1 text-[15px] font-semibold">Coding agent</h2>
              <IconButton label="Close" onClick={onClose} disabled={busy}>
                <X size={16} />
              </IconButton>
            </header>

            <div className="max-h-[72vh] overflow-y-auto px-5 pt-1 pb-5">
              <p className="text-[13px] leading-relaxed text-muted">
                The CLI that writes the code for every project in{" "}
                <span className="font-medium text-ink">{workspace?.name ?? "this workspace"}</span>. Each
                one runs on your own subscription, signed in on this Mac; the builder holds no key.
                {!owner && " Only a workspace owner can change it."}
              </p>

              {info === null ? (
                <span className="grid h-24 place-items-center">
                  <Spinner />
                </span>
              ) : (
                <div className="mt-3 flex flex-col gap-2" role="radiogroup" aria-label="Coding agent">
                  <Option
                    checked={chosen === null}
                    disabled={!owner || busy}
                    title={`Default${fallback ? ` · ${fallback.label}` : ""}`}
                    detail="Whatever the builder is set to run; follows the builder's configuration."
                    onPick={() => void choose(null, fallback?.label ?? "the default")}
                  />
                  {info.agents.map((agent) => (
                    <AgentOption
                      key={agent.id}
                      agent={agent}
                      checked={chosen === agent.id}
                      disabled={!owner || busy || !agent.installed}
                      onPick={() => void choose(agent.id, agent.label)}
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function AgentOption({
  agent,
  checked,
  disabled,
  onPick,
}: {
  agent: AgentStatus;
  checked: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  const state = !agent.installed ? "Not installed" : agent.account ? agent.account : "Installed";
  const efforts = agent.efforts.length ? `Effort levels: ${agent.efforts.join(", ")}.` : "No effort levels.";
  return (
    <Option
      checked={checked}
      disabled={disabled}
      title={agent.label}
      meta={`${state}${agent.model ? ` · ${agent.model}` : ""}`}
      detail={[agent.note, efforts].filter(Boolean).join(" ")}
      onPick={onPick}
    />
  );
}

function Option({
  checked,
  disabled,
  title,
  meta,
  detail,
  onPick,
}: {
  checked: boolean;
  disabled: boolean;
  title: string;
  meta?: string;
  detail: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onPick}
      className={cx(
        "material-chip edge-light flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
        checked ? "border-accent" : "border-hairline hover:bg-[color-mix(in_oklab,var(--c-ink)_5%,transparent)]",
        "disabled:cursor-default disabled:opacity-60",
      )}
    >
      <Check size={14} className={cx("mt-0.5 shrink-0", checked ? "text-accent" : "text-transparent")} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="text-[13.5px] font-medium">{title}</span>
          {meta && <span className="min-w-0 truncate text-[11.5px] text-faint">{meta}</span>}
        </span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{detail}</span>
      </span>
    </button>
  );
}
