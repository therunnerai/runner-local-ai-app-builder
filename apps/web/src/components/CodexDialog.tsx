import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ExternalLink, KeyRound, LogOut, X } from "lucide-react";
import { Button, IconButton, SOFT_SPRING, Spinner, useToast } from "./ui";
import {
  cancelCodexLogin,
  getCodex,
  linkTerminalCodex,
  logoutCodex,
  startCodexLogin,
  type CodexAccount,
  type CodexLoginPrompt,
} from "../lib/api";

/**
 * Which ChatGPT account the agent runs as.
 *
 * Someone with several accounts needs to choose: the terminal's login, or an
 * account connected here by entering a one-time code on openai.com. The code
 * is shown here and the dialog watches for the login to complete.
 */
export function CodexDialog({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged?: (account: CodexAccount) => void;
}) {
  const toast = useToast();
  const reduce = useReducedMotion();
  const [account, setAccount] = useState<CodexAccount | null>(null);
  const [prompt, setPrompt] = useState<CodexLoginPrompt | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getCodex();
      setAccount(next);
      onChanged?.(next);
      return next;
    } catch (e) {
      toast((e as Error).message, "error");
      return null;
    }
  }, [toast, onChanged]);

  useEffect(() => {
    if (!open) return;
    setPrompt(null);
    void load();
  }, [open, load]);

  // While a code is outstanding, watch for the login to land.
  useEffect(() => {
    if (!open || !prompt) return;
    const timer = setInterval(() => {
      void load().then((next) => {
        if (next && next.connected && !next.loginInProgress) {
          setPrompt(null);
          toast(`Connected ${next.email ?? "ChatGPT"}`);
        }
      });
    }, 3_000);
    return () => clearInterval(timer);
  }, [open, prompt, load, toast]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function guard(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const connect = () =>
    guard("connect", async () => {
      const next = await startCodexLogin();
      setPrompt(next);
      window.open(next.url, "_blank", "noopener");
      await load();
    });

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
            aria-label="ChatGPT account"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 6 }}
            transition={SOFT_SPRING}
            className="material-panel edge-light relative z-10 w-full max-w-[460px] overflow-hidden rounded-panel border border-hairline shadow-float"
          >
            <header className="flex items-center gap-2.5 px-5 pt-4 pb-3">
              <KeyRound size={17} />
              <h2 className="title flex-1 text-[15px] font-semibold">ChatGPT account</h2>
              <IconButton label="Close" onClick={onClose}>
                <X size={16} />
              </IconButton>
            </header>

            <div className="max-h-[70vh] overflow-y-auto px-5 pt-1 pb-5">
              {account === null ? (
                <span className="grid h-16 place-items-center">
                  <Spinner />
                </span>
              ) : (
                <>
                  <p className="text-[13px] leading-relaxed text-muted">
                    The agent runs on this account's Codex subscription. It applies to everyone
                    using this builder.
                  </p>

                  <div className="material-chip edge-light mt-3 rounded-xl border border-hairline px-3 py-2.5">
                    {account.connected ? (
                      <>
                        <p className="text-[14px] font-medium">{account.email ?? account.name ?? "Connected"}</p>
                        <p className="mt-0.5 text-[12px] text-faint">
                          {account.mode === "api_key" ? "API key" : "ChatGPT"}
                          {account.plan ? ` · ${account.plan}` : ""}
                          {account.shared ? " · your terminal's login" : " · connected here"}
                        </p>
                      </>
                    ) : (
                      <p className="text-[13.5px] text-muted">Not connected. The agent cannot run until an account is connected.</p>
                    )}
                  </div>

                  {prompt && (
                    <div className="mt-3 rounded-xl border border-dashed border-hairline px-3 py-3">
                      <p className="text-[12.5px] text-muted">
                        Sign in on openai.com and enter this code. It expires in{" "}
                        {prompt.expiresInMinutes} minutes.
                      </p>
                      <p className="mt-2 font-mono text-[22px] font-semibold tracking-[0.12em]">
                        {prompt.code}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <a
                          href={prompt.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-[12.5px] text-accent hover:underline"
                        >
                          Open the sign-in page
                          <ExternalLink size={12} />
                        </a>
                        <span className="flex-1" />
                        <span className="flex items-center gap-1.5 text-[12px] text-faint">
                          <Spinner />
                          Waiting for you to finish
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    {account.connected && !prompt && (
                      <Button
                        variant="ghost"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          guard("logout", async () => {
                            setAccount(await logoutCodex());
                            toast(account.shared ? "Stopped using the terminal login" : "Disconnected");
                          })
                        }
                      >
                        {busy === "logout" ? <Spinner /> : <LogOut size={14} />}
                        {account.shared ? "Stop using it" : "Disconnect"}
                      </Button>
                    )}
                    {account.terminalLoginAvailable && !account.shared && !prompt && (
                      <Button
                        variant="glass"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          guard("link", async () => {
                            setAccount(await linkTerminalCodex());
                            toast("Using your terminal's login");
                          })
                        }
                      >
                        {busy === "link" ? <Spinner /> : null}
                        Use my terminal's login
                      </Button>
                    )}
                    {prompt ? (
                      <Button
                        variant="glass"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          guard("cancel", async () => {
                            setAccount(await cancelCodexLogin());
                            setPrompt(null);
                          })
                        }
                      >
                        Cancel sign-in
                      </Button>
                    ) : (
                      <Button variant="primary" disabled={Boolean(busy)} onClick={connect}>
                        {busy === "connect" ? <Spinner /> : <KeyRound size={14} />}
                        {account.connected ? "Connect another account" : "Connect ChatGPT"}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
