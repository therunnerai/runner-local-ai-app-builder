import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import type { WorkspaceMember, WorkspaceRole } from "@runner-builder/shared";
import { Button, Spinner, useToast } from "./ui";
import {
  addMember,
  createAccount,
  listMembers,
  removeMember as removeMemberApi,
  setMemberRole,
} from "../lib/api";
import { useSession } from "../lib/session";

const ROLES: WorkspaceRole[] = ["viewer", "editor", "owner"];
const field =
  "w-full rounded-[10px] border border-hairline bg-surface px-3 py-2 text-[13px] outline-none " +
  "focus-visible:border-accent";

/**
 * Who can reach this workspace.
 *
 * Every action here is also enforced server-side; hiding a control for a
 * non-owner is convenience, not the boundary.
 */
export function MembersDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { workspace, user } = useSession();
  const toast = useToast();
  const reduce = useReducedMotion();
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("editor");
  const [busy, setBusy] = useState(false);
  const [newAccount, setNewAccount] = useState<{ email: string; name: string; password: string } | null>(
    null,
  );

  const isOwner = workspace?.role === "owner";

  const reload = useCallback(async () => {
    if (!workspace) return;
    try {
      setMembers(await listMembers(workspace.id));
    } catch {
      setMembers([]);
    }
  }, [workspace]);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  const guard = async (label: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await reload();
    } catch (e) {
      toast(`${label}: ${(e as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  if (!workspace) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_oklab,var(--c-ink)_38%,transparent)] p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.15 }}
          onClick={onClose}
        >
          <motion.div
            className="material-panel edge-light max-h-[80vh] w-full max-w-[440px] overflow-y-auto rounded-panel p-6 shadow-float"
            initial={reduce ? undefined : { opacity: 0, scale: 0.97 }}
            animate={reduce ? undefined : { opacity: 1, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 480, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="title text-[16px] font-semibold">{workspace.name}</h2>
                <p className="mt-0.5 text-[12.5px] text-muted">Members and their access</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-[8px] p-1.5 text-faint hover:text-ink"
              >
                <X size={15} />
              </button>
            </div>

            <div className="mt-5">
              {members === null ? (
                <Spinner />
              ) : (
                <ul className="flex flex-col gap-1">
                  {members.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center gap-3 rounded-[10px] border border-hairline px-3 py-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">
                          {m.name}
                          {m.id === user?.id && <span className="text-faint"> (you)</span>}
                        </span>
                        <span className="block truncate text-[11.5px] text-faint">{m.email}</span>
                      </span>

                      {isOwner ? (
                        <select
                          value={m.role}
                          disabled={busy}
                          onChange={(e) =>
                            guard("Could not change role", () =>
                              setMemberRole(workspace.id, m.id, e.target.value as WorkspaceRole),
                            )
                          }
                          className="rounded-[8px] border border-hairline bg-surface px-2 py-1 text-[12px]"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-[12px] text-faint">{m.role}</span>
                      )}

                      {isOwner && m.id !== user?.id && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            guard("Could not remove member", () =>
                              removeMemberApi(workspace.id, m.id),
                            )
                          }
                          className="rounded-[8px] p-1 text-faint hover:text-danger"
                          aria-label={`Remove ${m.name}`}
                        >
                          <X size={13} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {isOwner && (
              <div className="mt-5 border-t border-hairline pt-5">
                {/* Two separate forms on purpose: "add" and "create account" take
                    different fields, and one shared form would make Enter in the
                    new-account inputs fire the add-member submit. */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const value = email.trim();
                    if (!value) return;
                    void guard("Could not add member", async () => {
                      await addMember(workspace.id, value, role);
                      setEmail("");
                    });
                  }}
                >
                  <p className="text-[12px] font-medium text-muted">Add someone</p>
                  <div className="mt-2 flex gap-2">
                    <input
                      className={field}
                      type="email"
                      placeholder="their@email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value as WorkspaceRole)}
                      className="rounded-[10px] border border-hairline bg-surface px-2 text-[12.5px]"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" variant="primary" size="md" disabled={busy}>
                      Add
                    </Button>
                  </div>
                </form>

                {/* Adding needs an account that already exists, and there is no
                    self-signup, so an owner creates one here. */}
                <div className="mt-3">
                  {newAccount === null ? (
                    <button
                      type="button"
                      onClick={() => setNewAccount({ email: "", name: "", password: "" })}
                      className="text-[12px] text-muted underline-offset-2 hover:text-ink hover:underline"
                    >
                      …or create a new account
                    </button>
                  ) : (
                    <form
                      className="flex flex-col gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void guard("Could not create account", async () => {
                          await createAccount(newAccount);
                          setNewAccount(null);
                        });
                      }}
                    >
                      <input
                        className={field}
                        placeholder="name"
                        value={newAccount.name}
                        onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                      />
                      <input
                        className={field}
                        type="email"
                        placeholder="email"
                        value={newAccount.email}
                        onChange={(e) => setNewAccount({ ...newAccount, email: e.target.value })}
                      />
                      <input
                        className={field}
                        type="password"
                        placeholder="password (8+ characters)"
                        value={newAccount.password}
                        onChange={(e) => setNewAccount({ ...newAccount, password: e.target.value })}
                      />
                      <div className="flex gap-2">
                        <Button type="submit" variant="primary" size="md" disabled={busy}>
                          Create account
                        </Button>
                        <Button variant="ghost" size="md" onClick={() => setNewAccount(null)}>
                          Cancel
                        </Button>
                      </div>
                    </form>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
