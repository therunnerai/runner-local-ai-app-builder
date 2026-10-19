import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ExternalLink,
  GitPullRequest,
  Github,
  Link2,
  RefreshCw,
  Unlink,
  X,
} from "lucide-react";
import type { GithubState } from "@runner-builder/shared";
import {
  connectGithub,
  createGithubPr,
  disconnectGithub,
  getGithub,
  listGithubAccounts,
  listGithubBranches,
  listGithubRepos,
  setGithubSettings,
  switchGithubAccount,
  syncGithub,
  type GhAccountInfo,
  type RepoSummary,
} from "../lib/api";
import { Button, IconButton, SOFT_SPRING, Spinner, cx, useToast } from "./ui";
import { AccountRow, ConnectNotice, RepoPicker } from "./GithubParts";
import { relativeTime } from "../lib/format";

export function GithubDialog({
  projectId,
  projectName,
  onClose,
  onChanged,
}: {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onChanged: (state: GithubState) => void;
}) {
  const toast = useToast();
  const reduce = useReducedMotion();
  const [state, setState] = useState<GithubState | null>(null);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [name, setName] = useState(projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  const [isPrivate, setIsPrivate] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [pressed, setPressed] = useState(false);
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<GhAccountInfo[]>([]);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[] | null>(null);

  const apply = useCallback(
    (next: GithubState) => {
      setState(next);
      onChanged(next);
    },
    [onChanged],
  );

  const load = useCallback(async () => {
    try {
      apply(await getGithub(projectId));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [projectId, toast, apply]);

  useEffect(() => {
    load();
  }, [load]);

  // The picker is only reachable once the project turns out to be unconnected,
  // so the repository and account listings load at that point rather than on
  // every open — they shell out to `gh` and are not free.
  useEffect(() => {
    if (!state?.available || state.connected) return;
    let cancelled = false;
    setRepoError(null);
    Promise.all([
      listGithubRepos(),
      listGithubAccounts().catch(() => [] as GhAccountInfo[]),
    ])
      .then(([nextRepos, nextAccounts]) => {
        if (cancelled) return;
        setRepos(nextRepos);
        setAccounts(nextAccounts);
      })
      .catch((err: Error) => {
        // A refused listing and an account with no repositories are not the
        // same thing, so the failure is shown rather than rendered as absence.
        if (cancelled) return;
        setRepos([]);
        setRepoError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [state?.available, state?.connected]);

  // Once connected, the base-branch picker needs the repository's branches.
  // A failed listing leaves the current base selectable on its own.
  useEffect(() => {
    if (!state?.connected || !state.repo) return;
    let cancelled = false;
    listGithubBranches(projectId)
      .then((names) => {
        if (!cancelled) setBranches(names);
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, state?.connected, state?.repo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function guard(label: string, fn: () => Promise<GithubState | void>) {
    setBusy(label);
    try {
      const result = await fn();
      if (result) apply(result);
      else await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const connected = Boolean(state?.connected);

  // A disabled button that does not say what it is waiting for is
  // indistinguishable from a broken one.
  const missingConnect =
    mode === "new"
      ? name.trim()
        ? null
        : "Enter a repository name."
      : picked
        ? null
        : "Choose a repository from the list.";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
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
        aria-label="GitHub"
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 6 }}
        transition={SOFT_SPRING}
        className="material-panel edge-light relative z-10 w-full max-w-[480px] overflow-hidden rounded-panel border border-hairline shadow-float"
      >
        <header className="flex items-center gap-2.5 px-5 pt-4 pb-3">
          <Github size={17} />
          <h2 className="title flex-1 text-[15px] font-semibold">GitHub</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>

        {!state ? (
          <div className="grid h-32 place-items-center text-[13.5px] text-muted">
            <Spinner />
          </div>
        ) : !state.available ? (
          <Body>
            <p className="text-[13.5px] leading-relaxed text-muted">
              The <code className="font-mono text-[12.5px]">gh</code> CLI was not found on
              PATH. Install GitHub CLI and run{" "}
              <code className="font-mono text-[12.5px]">gh auth login</code> to connect
              projects.
            </p>
          </Body>
        ) : !connected ? (
          <Body>
            <AccountRow
              account={state.account ?? null}
              accounts={accounts}
              disabled={Boolean(busy)}
              onSwitch={(login) =>
                guard("account", async () => {
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
                })
              }
            />
            <p className="mt-1.5 text-[12px] leading-relaxed text-faint">
              The preview keeps running throughout — connecting never moves the working tree.
            </p>

            <div className="material-chip edge-light mt-3 flex gap-0.5 rounded-full border border-hairline p-0.5">
              {(["new", "existing"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cx(
                    "flex-1 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                    mode === m ? "bg-raised text-ink shadow-lift" : "text-muted hover:text-ink",
                  )}
                >
                  {m === "new" ? "Create a repository" : "Use an existing one"}
                </button>
              ))}
            </div>

            {mode === "new" ? (
              <div className="mt-3 flex flex-col gap-2.5">
                <Field label="Repository name">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-9 w-full rounded-xl border border-hairline bg-transparent px-3 text-[13.5px] outline-none"
                  />
                </Field>
                <label className="flex items-center gap-2 text-[13px] text-muted">
                  <input
                    type="checkbox"
                    checked={isPrivate}
                    onChange={(e) => setIsPrivate(e.target.checked)}
                    className="accent-[var(--c-accent)]"
                  />
                  Private repository
                </label>
                <p className="text-[12px] leading-relaxed text-faint">
                  The current state is imported as the first commit on the default branch, and
                  the agent's work mirrors to <code className="font-mono">builder/work</code>.
                </p>
              </div>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                <RepoPicker
                  repos={repos}
                  error={repoError}
                  query={query}
                  onQueryChange={setQuery}
                  picked={picked}
                  onPick={setPicked}
                />
                <p className="text-[12px] leading-relaxed text-faint">
                  Its default branch is left untouched; work mirrors to{" "}
                  <code className="font-mono">builder/work</code> so pull requests have a base.
                </p>
                {picked && <ConnectNotice repo={picked} />}
              </div>
            )}

            <div className="mt-4 flex items-center gap-2">
              <span
                className={`mr-auto text-[12px] ${pressed && missingConnect ? "text-danger" : "text-faint"}`}
              >
                {busy ? "" : (missingConnect ?? "")}
              </span>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={Boolean(busy)}
                onClick={() => {
                  // Pressable even when unsatisfied, so it can say why rather
                  // than sit inert and look broken.
                  if (missingConnect) {
                    setPressed(true);
                    return;
                  }
                  void guard("connect", () =>
                    connectGithub(projectId, {
                      mode,
                      name: name.trim(),
                      private: isPrivate,
                      remote: picked ?? "",
                    }),
                  );
                }}
              >
                {busy === "connect" ? <Spinner /> : <Link2 size={14} />}
                Connect
              </Button>
            </div>
          </Body>
        ) : (
          <Body>
            <div className="flex items-center gap-2">
              <a
                href={`https://github.com/${state.repo}`}
                target="_blank"
                rel="noreferrer"
                className="title inline-flex items-center gap-1.5 text-[14.5px] font-semibold hover:underline"
              >
                {state.repo}
                <ExternalLink size={13} className="text-faint" />
              </a>
            </div>

            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
              <Row label="Mirror branch">
                <code className="font-mono">{state.mirrorBranch}</code>
              </Row>
              <Row label="Pull requests into">
                <select
                  value={state.baseBranch ?? ""}
                  disabled={Boolean(busy) || branches === null}
                  aria-label="Branch pull requests target"
                  onChange={(e) =>
                    guard("base", async () => {
                      await setGithubSettings(projectId, { baseBranch: e.target.value });
                      await load();
                    })
                  }
                  className="material-chip edge-light rounded-md border border-hairline bg-transparent px-1.5 py-0.5 font-mono text-[12px] text-ink disabled:opacity-60"
                >
                  {[...new Set([state.baseBranch ?? "", ...(branches ?? [])])]
                    .filter(Boolean)
                    .map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                </select>
              </Row>
              <Row label="Last sync">
                {state.pushedAt ? relativeTime(state.pushedAt) : "not yet pushed"}
              </Row>
              <Row label="Unsynced commits">
                {state.ahead === undefined ? "—" : state.ahead === 0 ? "none" : state.ahead}
              </Row>
            </dl>

            {state.openPr && (
              <a
                href={state.openPr.url}
                target="_blank"
                rel="noreferrer"
                className="material-chip edge-light mt-3 flex items-center gap-2 rounded-xl border border-hairline px-3 py-2 text-[12.5px] hover:text-ink"
              >
                <GitPullRequest size={14} className="text-ok" />
                <span className="min-w-0 flex-1 truncate">
                  #{state.openPr.number} {state.openPr.title}
                </span>
                <ExternalLink size={12} className="text-faint" />
              </a>
            )}

            <label className="mt-3 flex items-start gap-2 text-[12.5px] text-muted">
              <input
                type="checkbox"
                checked={state.pushOnPublish}
                onChange={(e) =>
                  guard("settings", async () => {
                    await setGithubSettings(projectId, { pushOnPublish: e.target.checked });
                    await load();
                  })
                }
                className="mt-0.5 accent-[var(--c-accent)]"
              />
              <span>
                Also push to <code className="font-mono">{state.baseBranch}</code> when
                publishing — the one-button path for a non-technical user. Leave off to keep
                everything behind review.
              </span>
            </label>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                disabled={Boolean(busy)}
                onClick={() => guard("disconnect", async () => {
                  await disconnectGithub(projectId);
                  toast("Disconnected. The repository was left untouched.");
                })}
              >
                {busy === "disconnect" ? <Spinner /> : <Unlink size={14} />}
                Disconnect
              </Button>
              <Button
                variant="glass"
                disabled={Boolean(busy)}
                onClick={() => guard("sync", () => syncGithub(projectId))}
              >
                {busy === "sync" ? <Spinner /> : <RefreshCw size={14} />}
                Sync now
              </Button>
              <Button
                variant="primary"
                disabled={Boolean(busy)}
                onClick={() =>
                  guard("pr", async () => {
                    const pr = await createGithubPr(projectId);
                    toast(pr.existing ? `Pull request #${pr.number} is already open` : "Pull request opened");
                    window.open(pr.url, "_blank");
                  })
                }
              >
                {busy === "pr" ? <Spinner /> : <GitPullRequest size={14} />}
                {state.openPr ? "Open pull request" : `Create pull request into ${state.baseBranch}`}
              </Button>
            </div>
          </Body>
        )}
      </motion.div>
    </div>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  // The panel clips its overflow, so without a cap and a scroll the repo list
  // and the actions below it fall off the bottom of a short window with no way
  // to reach them. The dialog grew when the picker replaced the URL field.
  return <div className="max-h-[70vh] overflow-y-auto px-5 pt-1 pb-5">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11.5px] font-medium tracking-wide text-faint uppercase">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-faint">{label}</dt>
      <dd className="min-w-0 truncate text-ink">{children}</dd>
    </>
  );
}
