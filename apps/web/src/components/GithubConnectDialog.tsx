import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Github, X } from "lucide-react";
import type { Project } from "@runner-builder/shared";
import { Button, IconButton, SOFT_SPRING, Spinner, useToast } from "./ui";
import { AccountRow, ConnectNotice, RepoPicker } from "./GithubParts";
import {
  connectGithub,
  listGithubAccounts,
  listGithubRepos,
  listProjects,
  switchGithubAccount,
  type GhAccountInfo,
  type RepoSummary,
} from "../lib/api";
import { useSession } from "../lib/session";

/**
 * Connect a project to a repository without opening that project.
 *
 * The per-project dialog only exists inside the Builder, which made connecting
 * effectively undiscoverable — you had to already know an unlabelled icon was
 * there. This is the same operation reached from the dashboard, with the
 * project as an explicit choice rather than an implicit one.
 */
export function GithubConnectDialog({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const toast = useToast();
  const reduce = useReducedMotion();
  const { workspace } = useSession();

  const [accounts, setAccounts] = useState<GhAccountInfo[]>([]);
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pressed, setPressed] = useState(false);

  const loadAccountsAndRepos = useCallback(async () => {
    setRepoError(null);
    try {
      const [nextRepos, nextAccounts] = await Promise.all([
        listGithubRepos(),
        listGithubAccounts().catch(() => [] as GhAccountInfo[]),
      ]);
      setRepos(nextRepos);
      setAccounts(nextAccounts);
    } catch (err) {
      // A refused listing and an account that genuinely has no repositories look
      // identical in an empty list, and only one of them is the truth.
      setRepos([]);
      setRepoError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setQuery("");
    setProjectId("");
    void loadAccountsAndRepos();
    // Only unconnected projects are offered: connecting an already-connected one
    // is a different operation (disconnect first), and offering it here would
    // silently do nothing useful.
    // Asking someone to pick from a list with exactly one valid answer is a step
    // that exists only to be obeyed; select it and let them change it if they want.
    listProjects(workspace?.id)
      .then((list) => {
        const unconnected = list.filter((p) => !p.repo);
        setProjects(unconnected);
        setProjectId((current) => current || unconnected[0]?.id || "");
      })
      .catch(() => setProjects([]));
  }, [open, loadAccountsAndRepos, workspace?.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const activeAccount = accounts.find((a) => a.active)?.login ?? null;
  const project = (projects ?? []).find((p) => p.id === projectId) ?? null;

  // What Connect is still waiting for. Shown beside the button, and pressed into
  // view if the button is used while it is unsatisfied.
  const missing = !project
    ? picked
      ? "Choose which project to connect."
      : "Choose a project and a repository."
    : !picked
      ? "Choose a repository to connect it to."
      : null;

  const connect = async () => {
    // Deliberately pressable even when unsatisfied: a primary action that is
    // inert without explanation is indistinguishable from a broken one, which is
    // how this was reported four times.
    if (!project || !picked) {
      setPressed(true);
      return;
    }
    setBusy(true);
    try {
      await connectGithub(project.id, { mode: "existing", remote: picked });
      toast(`Connected “${project.name}” to ${picked}`);
      onChanged?.();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Connect GitHub"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 6 }}
            transition={SOFT_SPRING}
            className="material-panel edge-light relative z-10 w-full max-w-[480px] overflow-hidden rounded-panel border border-hairline shadow-float"
          >
            <header className="flex items-center gap-2.5 px-5 pt-4 pb-3">
              <Github size={17} />
              <h2 className="title flex-1 text-[15px] font-semibold">Connect GitHub</h2>
              <IconButton label="Close" onClick={onClose}>
                <X size={16} />
              </IconButton>
            </header>

            {/* The panel clips its overflow, so the body caps its height and
                scrolls; otherwise the repo list and the Connect button sit
                below the fold in a short window with no way to reach them. */}
            <div className="max-h-[70vh] overflow-y-auto px-5 pt-1 pb-5">
              <AccountRow
                account={activeAccount}
                accounts={accounts}
                disabled={busy}
                onSwitch={(login) =>
                  (async () => {
                    setBusy(true);
                    try {
                      const result = await switchGithubAccount(login);
                      setAccounts(result.accounts);
                      setPicked(null);
                      setQuery("");
                      setRepoError(null);
                      try {
                        setRepos(await listGithubRepos());
                      } catch (err) {
                        setRepos([]);
                        setRepoError((err as Error).message);
                      }
                    } catch (e) {
                      toast((e as Error).message, "error");
                    } finally {
                      setBusy(false);
                    }
                  })()
                }
              />

              <label className="mt-4 flex flex-col gap-1">
                <span className="text-[11.5px] font-medium tracking-wide text-faint uppercase">
                  Project
                </span>
                {projects === null ? (
                  <span className="grid h-9 place-items-center">
                    <Spinner />
                  </span>
                ) : projects.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-hairline px-3 py-3 text-[12.5px] text-faint">
                    Every project in this workspace is already connected, or there are none yet.
                  </p>
                ) : (
                  <select
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    className="h-9 rounded-xl border border-hairline bg-surface px-3 text-[13px] outline-none focus-visible:border-accent"
                  >
                    <option value="">Choose a project…</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </label>

              <div className="mt-4">
                <span className="text-[11.5px] font-medium tracking-wide text-faint uppercase">
                  Repository
                  {/* Stating the count makes an empty listing visible as a fact
                      rather than something the user has to infer from absence. */}
                  {repos && (
                    <span className="ml-2 font-normal tracking-normal normal-case">
                      {repos.length} available
                    </span>
                  )}
                </span>
                <div className="mt-1">
                  <RepoPicker
                    repos={repos}
                    error={repoError}
                    query={query}
                    onQueryChange={setQuery}
                    picked={picked}
                    onPick={setPicked}
                  />
                </div>
              </div>

              {picked && (
                <div className="mt-3">
                  <ConnectNotice repo={picked} project={project?.name} />
                </div>
              )}

              <div className="mt-4 flex items-center gap-2">
                <span
                  className={`mr-auto text-[12px] ${pressed && missing ? "text-danger" : "text-faint"}`}
                >
                  {busy ? "" : (missing ?? "")}
                </span>
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button variant="primary" disabled={busy} onClick={connect}>
                  {busy ? <Spinner /> : <Github size={14} />}
                  Connect
                </Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
