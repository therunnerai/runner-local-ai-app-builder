import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type {
  FileNode,
  GithubState,
  Message,
  PickPayload,
  PreviewInfo,
  ProjectDetail,
  TurnEvent,
} from "@runner-builder/shared";
import { TopBar, type Tab } from "../components/TopBar";
import { ChatPanel, type LiveTurn, type QueuedPrompt } from "../components/ChatPanel";
import { PreviewPanel } from "../components/PreviewPanel";
import { CodeTab, FilesTab } from "../components/CodePanel";
import { Composer } from "../components/Composer";
import { GithubDialog } from "../components/GithubDialog";
import { ReleaseDialog } from "../components/ReleaseDialog";
import { Spinner, useToast } from "../components/ui";
import {
  ensurePreview,
  getFiles,
  getGithub,
  getProject,
  publishProject,
  revertTo,
  streamTurn,
} from "../lib/api";

const MIN_CHAT = 320;
const MAX_CHAT = 760;

export default function Builder() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const reduce = useReducedMotion();

  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("preview");
  const [prompt, setPrompt] = useState("");
  const [live, setLive] = useState<LiveTurn>(null);
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<QueuedPrompt[]>([]);
  const [pickMode, setPickMode] = useState(false);
  const [codePath, setCodePath] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [github, setGithub] = useState<GithubState | null>(null);
  const [ghOpen, setGhOpen] = useState(false);
  const [device, setDevice] = useState<PreviewInfo["device"]>(null);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(() => {
    const saved = Number(localStorage.getItem("builder.chatWidth"));
    return saved >= MIN_CHAT && saved <= MAX_CHAT ? saved : 420;
  });

  const abortRef = useRef<AbortController | null>(null);
  // Mirrors `busy` synchronously, so a submit decided inside the same tick as
  // the turn start still sees the right answer.
  const busyRef = useRef(false);
  const bootstrapped = useRef(false);

  const reload = useCallback(async () => {
    if (!id) return;
    try {
      const [d, f] = await Promise.all([getProject(id), getFiles(id)]);
      setDetail(d);
      setTree(f);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [id, toast]);

  useEffect(() => {
    reload();
  }, [reload]);

  // The code tab opens on the file a person most wants to see first, which
  // depends on what kind of app this is.
  useEffect(() => {
    if (!detail || codePath !== null) return;
    setCodePath(detail.project.kind === "mobile" ? "src/app/index.tsx" : "src/App.tsx");
  }, [detail, codePath]);

  // GitHub connection state — drives the status dot in the top bar.
  useEffect(() => {
    if (!id) return;
    getGithub(id)
      .then(setGithub)
      .catch(() => setGithub(null));
  }, [id]);

  // Boot the project's dev server once.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    ensurePreview(id)
      .then((r) => {
        if (cancelled) return;
        setPreviewUrl(`${r.url}?t=${Date.now()}`);
        setDevice(r.device);
      })
      .catch((e: Error) => toast(`Preview: ${e.message}`, "error"));
    return () => {
      cancelled = true;
    };
  }, [id, toast]);

  // A dev server can be replaced, or re-adopted on a different port, after the
  // orchestrator restarts. Re-check on focus AND on a timer so the preview
  // heals itself instead of silently showing a dead page.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const check = () => {
      ensurePreview(id)
        .then((r) => {
          if (cancelled) return;
          setPreviewUrl((u) => (u?.startsWith(r.url) ? u : `${r.url}?t=${Date.now()}`));
          setDevice(r.device);
        })
        .catch(() => {});
    };

    const timer = setInterval(check, 15_000);
    window.addEventListener("focus", check);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [id]);

  const runTurn = useCallback(
    async (text: string) => {
      if (!id) return;
      busyRef.current = true;
      setBusy(true);
      setLive({ text: "", tools: [] });

      const optimistic: Message = {
        id: `optimistic-${Date.now()}`,
        projectId: id,
        role: "user",
        content: text,
        createdAt: Date.now(),
        editId: null,
      };
      setDetail((d) => (d ? { ...d, messages: [...d.messages, optimistic] } : d));

      const controller = new AbortController();
      abortRef.current = controller;

      const onEvent = (event: TurnEvent) => {
        switch (event.type) {
          case "turn.queued":
            setLive((l) => ({
              text: l?.text ?? "",
              tools: [
                ...(l?.tools ?? []),
                {
                  name: "queue",
                  detail:
                    event.ahead === 1
                      ? "Waiting for the current change to finish"
                      : `Waiting for ${event.ahead} changes ahead of this one`,
                },
              ],
            }));
            break;
          case "agent.delta":
            setLive((l) => ({
              text: l?.text ? `${l.text}\n\n${event.text}` : event.text,
              tools: l?.tools ?? [],
            }));
            break;
          case "agent.tool":
            setLive((l) => ({
              text: l?.text ?? "",
              tools: [...(l?.tools ?? []), { name: event.name, detail: event.detail }].slice(-24),
            }));
            break;
          case "files.changed":
            getFiles(id).then(setTree).catch(() => {});
            break;
          case "turn.completed":
            toast("Change applied");
            break;
          case "turn.failed":
            toast(event.error, "error");
            break;
        }
      };

      try {
        await streamTurn(id, text, onEvent, controller.signal);
      } catch (e) {
        if ((e as Error).name !== "AbortError") toast((e as Error).message, "error");
      } finally {
        abortRef.current = null;
        setLive(null);
        await reload();
        getFiles(id).then(setTree).catch(() => {});
        getGithub(id).then(setGithub).catch(() => {});
        busyRef.current = false;
        setBusy(false);
      }
    },
    [id, reload, toast],
  );

  // Submitting during a turn queues the prompt instead of refusing it; the
  // queue drains in order, one turn at a time, as each turn ends.
  const send = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!id || !clean) return;
      setPrompt("");
      setPickMode(false);
      if (busyRef.current) {
        setQueue((q) => [...q, { id: crypto.randomUUID(), text: clean }]);
        return;
      }
      void runTurn(clean);
    },
    [id, runTurn],
  );

  useEffect(() => {
    if (busy || queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    void runTurn(next.text);
  }, [busy, queue, runTurn]);

  // Stop means stop: end the running turn and drop whatever was lined up
  // behind it, since those prompts assumed the turn had completed.
  const stop = useCallback(() => {
    setQueue([]);
    abortRef.current?.abort();
  }, []);

  // A prompt handed over from the dashboard starts immediately.
  useEffect(() => {
    if (bootstrapped.current || !id) return;
    const initial = (location.state as { initialPrompt?: string } | null)?.initialPrompt;
    if (!initial) return;
    bootstrapped.current = true;
    navigate(location.pathname, { replace: true, state: null });
    void send(initial);
  }, [id, location, navigate, send]);

  useEffect(() => {
    localStorage.setItem("builder.chatWidth", String(chatWidth));
  }, [chatWidth]);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = chatWidth;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const next = Math.min(MAX_CHAT, Math.max(MIN_CHAT, startWidth + (ev.clientX - startX)));
      setChatWidth(next);
    };
    const up = () => {
      el.releasePointerCapture?.(e.pointerId);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onPick = useCallback((payload: PickPayload) => {
    setPickMode(false);
    const target = payload.text
      ? `the <${payload.tag}> showing “${payload.text}”`
      : `the <${payload.tag}> element \`${payload.selector}\``;
    setPrompt((prev) => `${prev}${prev ? "\n\n" : ""}Change ${target} to `);
  }, []);

  const revert = async (editId: string) => {
    if (!id) return;
    try {
      await revertTo(id, editId);
      toast("Reverted to that version");
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const publish = async () => {
    if (!id) return;
    setPublishing(true);
    try {
      const r = await publishProject(id);
      toast(`Built successfully → ${r.output}`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setPublishing(false);
    }
  };

  if (!detail) {
    return (
      <div className="grid h-full place-items-center">
        <p className="flex items-center gap-2 text-[13.5px] text-muted">
          <Spinner />
          Loading project…
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar
        name={detail.project.name}
        tab={tab}
        onTab={setTab}
        onBack={() => navigate("/")}
        previewUrl={previewUrl}
        onPublish={publish}
        publishing={publishing}
        onGithub={() => setGhOpen(true)}
        githubConnected={Boolean(github?.connected)}
        mobile={detail.project.kind === "mobile"}
        onRelease={() => setReleaseOpen(true)}
      />

      <div className="flex min-h-0 flex-1">
        <section
          className="flex shrink-0 flex-col border-r border-hairline"
          style={{ width: chatWidth }}
        >
          <ChatPanel
            messages={detail.messages}
            live={live}
            queued={queue}
            onRemoveQueued={(qid) => setQueue((q) => q.filter((x) => x.id !== qid))}
            onRevert={revert}
            title={detail.project.name}
          />
          <div className="px-3 pb-3">
            <Composer
              value={prompt}
              onChange={setPrompt}
              onSubmit={() => send(prompt)}
              onStop={stop}
              busy={busy}
              queueWhileBusy
              placeholder="Ask for a change…"
              pickMode={pickMode}
              // Element picking rides on the web scaffold's overlay script; a
              // native app's web build has no such hook.
              onTogglePick={
                detail.project.kind === "mobile"
                  ? undefined
                  : () => {
                      setPickMode((p) => !p);
                      setTab("preview");
                    }
              }
            />
          </div>
        </section>

        <div
          onPointerDown={startResize}
          role="separator"
          aria-orientation="vertical"
          className="group relative w-px shrink-0 cursor-col-resize bg-hairline"
        >
          <span className="absolute inset-y-0 -left-1 -right-1" />
          <span className="absolute top-1/2 left-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-transparent transition-colors duration-150 group-hover:bg-accent" />
        </div>

        <section className="flex min-w-0 flex-1 flex-col">
          {tab === "preview" && (
            <PreviewPanel
              url={previewUrl}
              kind={detail.project.kind}
              device={device}
              pickMode={pickMode}
              onPick={onPick}
              onReloadRequested={() => {
                if (id) ensurePreview(id).then((r) => setPreviewUrl(`${r.url}?t=${Date.now()}`)).catch(() => {});
              }}
            />
          )}
          {tab === "code" && (
            <CodeTab projectId={detail.project.id} tree={tree} path={codePath} onSelect={setCodePath} />
          )}
          {tab === "files" && (
            <FilesTab
              tree={tree}
              onOpenFile={(p) => {
                setCodePath(p);
                setTab("code");
              }}
            />
          )}
        </section>
      </div>

      {busy && (
        <motion.div
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="pointer-events-none fixed bottom-5 left-1/2 -translate-x-1/2"
        >
          <span className="material-panel edge-light flex items-center gap-2 rounded-full border border-hairline px-3.5 py-2 text-[12.5px] shadow-float">
            <Spinner />
            Agent is working
          </span>
        </motion.div>
      )}

      <AnimatePresence>
        {ghOpen && (
          <GithubDialog
            projectId={detail.project.id}
            projectName={detail.project.name}
            onClose={() => setGhOpen(false)}
            onChanged={setGithub}
          />
        )}
        {releaseOpen && (
          <ReleaseDialog
            projectId={detail.project.id}
            projectName={detail.project.name}
            onClose={() => {
              setReleaseOpen(false);
              void reload();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
