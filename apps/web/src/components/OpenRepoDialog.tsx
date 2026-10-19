import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { FolderGit2, X } from "lucide-react";
import type { Project } from "@runner-builder/shared";
import { Button, IconButton, SOFT_SPRING, Spinner, useToast } from "./ui";
import { AccountRow, RepoPicker } from "./GithubParts";
import {
  listGithubAccounts,
  listGithubRepos,
  listRepoBranches,
  openRepository,
  switchGithubAccount,
  type GhAccountInfo,
  type RepoSummary,
} from "../lib/api";
import { useSession } from "../lib/session";

/** The branch Runner repositories take their work on; offered first when present. */
const PREFERRED_BASE = "staging";

/**
 * Open an existing repository as a project: pick the repository, the branch
 * the work will be merged into, and name the feature. The project is cloned at
 * that branch and put on its own branch named after the feature; the agent
 * then works inside the real codebase and the pull request lands on the base.
 */
export function OpenRepoDialog({
  open,
  onClose,
  onOpened,
}: {
  open: boolean;
  onClose: () => void;
  onOpened: (project: Project) => void;
}) {
  const toast = useToast();
  const reduce = useReducedMotion();
  const { workspace } = useSession();

  const [accounts, setAccounts] = useState<GhAccountInfo[]>([]);
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[] | null>(null);
  const [base, setBase] = useState("");
  const [name, setName] = useState("");
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
      setRepos([]);
      setRepoError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setQuery("");
    setBranches(null);
    setBase("");
    setName("");
    setPressed(false);
    void loadAccountsAndRepos();
  }, [open, loadAccountsAndRepos]);

  // The base branch is the repository's choice to make, not ours: list its
  // branches and lead with the one Runner repositories merge into.
  useEffect(() => {
    if (!picked) return;
    let cancelled = false;
    setBranches(null);
    setBase("");
    listRepoBranches(picked)
      .then((list) => {
        if (cancelled) return;
        setBranches(list);
        setBase(list.includes(PREFERRED_BASE) ? PREFERRED_BASE : (list[0] ?? ""));
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setBranches([]);
        toast(err.message, "error");
      });
    return () => {
      cancelled = true;
    };
  }, [picked, toast]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, busy]);

  const activeAccount = accounts.find((a) => a.active)?.login ?? null;

  const missing = !workspace
    ? "Create a workspace first."
    : !picked
      ? "Choose a repository."
      : !base
        ? "Choose the branch to merge into."
        : !name.trim()
          ? "Name the feature you are about to work on."
          : null;

  const openIt = async () => {
    if (missing || !workspace || !picked) {
      setPressed(true);
      return;
    }
    setBusy(true);
    try {
      const project = await openRepository({
        name: name.trim(),
        workspaceId: workspace.id,
        repo: picked,
        baseBranch: base,
      });
      toast(`Opened ${picked} on ${project.mirrorBranch}`);
      onOpened(project);
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
            onClick={() => !busy && onClose()}
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Open a repository"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 6 }}
            transition={SOFT_SPRING}
            className="material-panel edge-light relative z-10 w-full max-w-[520px] overflow-hidden rounded-panel border border-hairline shadow-float"
          >
            <header className="flex items-center gap-2.5 px-5 pt-4 pb-3">
              <FolderGit2 size={17} />
              <h2 className="title flex-1 text-[15px] font-semibold">Work on a repository</h2>
              <IconButton label="Close" onClick={onClose} disabled={busy}>
                <X size={16} />
              </IconButton>
            </header>

            <div className="max-h-[72vh] overflow-y-auto px-5 pt-1 pb-5">
              <p className="mb-3 text-[13px] leading-relaxed text-muted">
                The repository is cloned at the branch you choose, the preview is its own dev
                server, and the agent works on a branch named after your feature. Pull requests
                go back into that branch.
              </p>

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

              <div className="mt-4">
                <span className="text-[11.5px] font-medium tracking-wide text-faint uppercase">
                  Repository
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
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11.5px] font-medium tracking-wide text-faint uppercase">
                      Merge into
                    </span>
                    {branches === null ? (
                      <span className="grid h-9 place-items-center">
                        <Spinner />
                      </span>
                    ) : (
                      <select
                        value={base}
                        disabled={busy}
                        onChange={(e) => setBase(e.target.value)}
                        className="h-9 rounded-xl border border-hairline bg-surface px-3 font-mono text-[13px] outline-none focus-visible:border-accent"
                      >
                        {branches.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </select>
                    )}
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[11.5px] font-medium tracking-wide text-faint uppercase">
                      Feature
                    </span>
                    <input
                      value={name}
                      disabled={busy}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="TikTok publishing"
                      className="h-9 rounded-xl border border-hairline bg-surface px-3 text-[13px] outline-none placeholder:text-faint focus-visible:border-accent"
                    />
                  </label>
                </div>
              )}

              <div className="mt-4 flex items-center gap-2">
                <span
                  className={`mr-auto text-[12px] ${pressed && missing ? "text-danger" : "text-faint"}`}
                >
                  {busy ? "Cloning and installing. This takes a minute or two." : (missing ?? "")}
                </span>
                <Button variant="ghost" onClick={onClose} disabled={busy}>
                  Cancel
                </Button>
                <Button variant="primary" disabled={busy} onClick={openIt}>
                  {busy ? <Spinner /> : <FolderGit2 size={14} />}
                  Open
                </Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
