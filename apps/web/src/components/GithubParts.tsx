import { Check, Lock, Search } from "lucide-react";
import type { GhAccountInfo, RepoSummary } from "../lib/api";
import { Spinner, cx } from "./ui";

/**
 * Pieces shared by the per-project GitHub dialog and the workspace-level one.
 *
 * These are presentational on purpose: each dialog owns its own query and
 * selection, because switching accounts invalidates both and the reset belongs
 * to whoever performed the switch.
 */

export function AccountRow({
  account,
  accounts,
  disabled,
  onSwitch,
}: {
  account: string | null;
  accounts: GhAccountInfo[];
  disabled: boolean;
  onSwitch: (login: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-[13px] text-muted">
      <span className="min-w-0 flex-1 truncate">
        Signed in as <span className="font-medium text-ink">{account ?? "—"}</span>
      </span>
      {accounts
        .filter((a) => !a.active)
        .map((a) => (
          <button
            key={a.login}
            type="button"
            disabled={disabled}
            title="Switches the active account for every gh command on this computer"
            onClick={() => onSwitch(a.login)}
            className="shrink-0 rounded-full border border-hairline px-2.5 py-1 text-[12px] hover:text-ink disabled:opacity-40"
          >
            Use {a.login}
          </button>
        ))}
    </div>
  );
}

export function RepoPicker({
  repos,
  error,
  query,
  onQueryChange,
  picked,
  onPick,
}: {
  repos: RepoSummary[] | null;
  /** Why the listing failed, when it did. Shown instead of an empty list. */
  error?: string | null;
  query: string;
  onQueryChange: (value: string) => void;
  picked: string | null;
  onPick: (nameWithOwner: string) => void;
}) {
  const needle = query.trim().toLowerCase();
  const filtered = (repos ?? []).filter((r) => r.nameWithOwner.toLowerCase().includes(needle));

  if (error) {
    return (
      <p className="rounded-xl border border-hairline bg-[color-mix(in_oklab,var(--c-danger)_10%,transparent)] px-3 py-3 text-[12.5px] leading-relaxed text-danger">
        Could not list repositories. {error}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search size={13} className="absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Filter your repositories…"
          className="h-9 w-full rounded-xl border border-hairline bg-transparent pr-3 pl-8 text-[13px] outline-none focus-visible:border-accent"
        />
      </div>

      {repos === null ? (
        <div className="grid h-24 place-items-center">
          <Spinner />
        </div>
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-hairline px-3 py-6 text-center text-[12.5px] text-faint">
          {repos.length === 0
            ? "No repositories are visible to this account."
            : "No repository matches that filter."}
        </p>
      ) : (
        <ul className="max-h-56 overflow-y-auto rounded-xl border border-hairline">
          {filtered.slice(0, 100).map((r) => (
            <li key={r.nameWithOwner}>
              <button
                type="button"
                onClick={() => onPick(r.nameWithOwner)}
                className={cx(
                  "flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors",
                  picked === r.nameWithOwner
                    ? "bg-[var(--c-accent-soft)] ring-1 ring-accent ring-inset"
                    : "hover:bg-[color-mix(in_oklab,var(--c-ink)_6%,transparent)]",
                )}
              >
                <Check
                  size={13}
                  className={cx(
                    "shrink-0",
                    picked === r.nameWithOwner ? "text-accent" : "text-transparent",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[12.5px]">
                    {r.nameWithOwner}
                  </span>
                  {r.description && (
                    <span className="block truncate text-[11.5px] text-faint">
                      {r.description}
                    </span>
                  )}
                </span>
                {r.isPrivate && <Lock size={12} className="shrink-0 text-faint" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Spelled out at the point of choosing, because the consequence is easy to
 * miss: picking an existing repository is exactly how a scratch project once
 * ended up pushing a branch into a real one.
 */
export function ConnectNotice({ repo, project }: { repo: string; project?: string }) {
  return (
    <p className="rounded-xl bg-[var(--c-accent-soft)] px-3 py-2 text-[12px] leading-relaxed text-ink">
      {project ? (
        <>
          Connecting <span className="font-medium">{project}</span> pushes{" "}
        </>
      ) : (
        <>Connecting pushes </>
      )}
      a branch named <code className="font-mono">builder/work</code> to{" "}
      <span className="font-mono">{repo}</span>. Its default branch is never touched, but this
      does create a branch in that repository.
    </p>
  );
}
