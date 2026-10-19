import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronRight, FileCode2, RotateCcw, Terminal } from "lucide-react";
import type { Message } from "@runner-builder/shared";
import { SOFT_SPRING, SPRING, cx } from "./ui";

export type LiveTurn = {
  text: string;
  tools: { name: string; detail: string }[];
} | null;

/** A prompt sent while a turn was running; it starts when the turn before it ends. */
export type QueuedPrompt = { id: string; text: string };

/**
 * Translate agent activity into plain language.
 *
 * This panel is read by a non-technical person, so a raw
 * `sed -n '1,240p' src/App.tsx` must never be the headline. The command is
 * kept, but one disclosure away for anyone who wants the detail.
 */
const COMMAND_RULES: [RegExp, string][] = [
  [/\b(npm run build|vite build|tsc\b)/, "Checked everything still builds"],
  [/\b(npm (install|add|i)\b|pnpm (add|install)\b|yarn add\b)/, "Installed a package"],
  [/\bgh\b/, "Talked to GitHub"],
  [/\bgit (diff|status|log|show|add|commit)\b/, "Checked the history"],
  [/\brg\b|\bfind\b|\bls\b|\btree\b|\brg --files\b/, "Looked through the project"],
  [/\b(cat|sed -n|head|tail|less|bat)\b/, "Read a file"],
  [/\bcurl\b|\bwget\b/, "Fetched something"],
  [/\bmkdir\b|\bmv\b|\brm\b|\bcp\b/, "Tidied up files"],
];

function humanize(name: string, detail: string): { label: string; raw?: string; tone: string } {
  switch (name) {
    case "edit":
      return { label: `Updated ${detail}`, tone: "text-muted" };
    case "error":
      // Mid-turn, a command can fail and the agent simply adapts (reading a
      // file that isn't there is normal exploration). Alarm belongs to a turn
      // that actually fails, which arrives as its own system message.
      return { label: "Took a different route", raw: detail, tone: "text-faint" };
    case "agent":
    case "github":
    case "preview":
    case "queue":
    case "usage":
      return { label: detail, tone: "text-faint" };
    case "check":
      return { label: detail, tone: detail.includes("fail") ? "text-danger" : "text-faint" };
    default:
      break;
  }

  const command = detail
    .replace(/^\/bin\/zsh -lc\s*/, "")
    .replace(/^["']|["']$/g, "")
    .trim();

  for (const [pattern, label] of COMMAND_RULES) {
    if (pattern.test(command)) return { label, raw: command, tone: "text-muted" };
  }
  return { label: "Ran a command", raw: command, tone: "text-muted" };
}

function ToolChip({ name, detail }: { name: string; detail: string }) {
  const { label, raw, tone } = humanize(name, detail);
  const icon =
    name === "edit" ? <FileCode2 size={12} /> : name === "command" ? <Terminal size={12} /> : null;

  const line = (
    <span className="flex items-center gap-1.5">
      {icon}
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );

  // No command to reveal (or a short label) — render plainly.
  if (!raw || raw === label) {
    return <div className={cx("text-[12px] leading-5", tone)}>{line}</div>;
  }

  return (
    <details className="group">
      <summary
        className={cx(
          "flex cursor-pointer list-none items-center gap-1.5 rounded-md text-[12px] leading-5",
          "transition-colors hover:text-ink [&::-webkit-details-marker]:hidden",
          tone,
        )}
      >
        {line}
        <ChevronRight
          size={11}
          className="shrink-0 opacity-0 transition-transform duration-150 group-hover:opacity-60 group-open:rotate-90 group-open:opacity-60"
        />
      </summary>
      <pre className="mt-0.5 mb-1 overflow-x-auto rounded-md bg-[color-mix(in_oklab,var(--c-ink)_6%,transparent)] px-2 py-1.5 font-mono text-[11px] leading-4 text-muted">
        {raw}
      </pre>
    </details>
  );
}

export function ChatPanel({
  messages,
  live,
  queued = [],
  onRemoveQueued,
  onRevert,
  title,
}: {
  messages: Message[];
  live: LiveTurn;
  queued?: QueuedPrompt[];
  onRemoveQueued?: (id: string) => void;
  onRevert: (editId: string) => void;
  title: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "end",
    });
  }, [messages.length, live?.text, live?.tools.length, queued.length, reduce]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {messages.length === 0 && !live && (
          <div className="mx-auto max-w-md py-10 text-center">
            <p className="title text-[15px] font-semibold">Describe what you want</p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
              The agent edits the project on disk and the preview updates as it works.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-5">
          {messages.map((m) => (
            <MessageRow key={m.id} message={m} onRevert={onRevert} />
          ))}

          <AnimatePresence>
            {live && (
              <motion.div
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={SOFT_SPRING}
                className="flex flex-col gap-2"
              >
                {live.tools.length > 0 && (
                  <div className="material-chip edge-light flex flex-col gap-1 rounded-xl border border-hairline px-3 py-2">
                    {live.tools.slice(-6).map((t, i) => (
                      <ToolChip key={i} {...t} />
                    ))}
                  </div>
                )}
                {live.text ? (
                  <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{live.text}</p>
                ) : (
                  <div className="flex items-center gap-2 text-[13.5px] text-muted">
                    <motion.span
                      className="inline-block size-1.5 rounded-full bg-accent"
                      animate={reduce ? undefined : { opacity: [0.25, 1, 0.25] }}
                      transition={{ duration: 1.2, repeat: Infinity }}
                    />
                    Working…
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Queued prompts sit where they will land: after the running turn, in order. */}
          <AnimatePresence initial={false}>
            {queued.map((q, i) => (
              <motion.div
                key={q.id}
                layout
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={SOFT_SPRING}
                className="flex justify-end"
              >
                <div className="max-w-[85%] rounded-[18px] rounded-br-[6px] border border-dashed border-hairline px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap text-muted">
                  {q.text}
                  <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-faint">
                    <span>{i === 0 ? "Up next" : `Queued · ${i + 1}`}</span>
                    {onRemoveQueued && (
                      <button
                        type="button"
                        onClick={() => onRemoveQueued(q.id)}
                        className="rounded-full px-1.5 transition-colors hover:bg-[color-mix(in_oklab,var(--c-ink)_8%,transparent)] hover:text-ink"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <div ref={endRef} className="h-2" />
      </div>
    </div>
  );
}

function MessageRow({
  message,
  onRevert,
}: {
  message: Message;
  onRevert: (editId: string) => void;
}) {
  const reduce = useReducedMotion();

  if (message.role === "system") {
    return (
      <p className="mx-auto max-w-md text-center text-[12.5px] text-faint">{message.content}</p>
    );
  }

  if (message.role === "user") {
    return (
      <motion.div
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING}
        className="flex justify-end"
      >
        <div className="max-w-[85%] rounded-[18px] rounded-br-[6px] bg-[color-mix(in_oklab,var(--c-accent)_16%,transparent)] px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap">
          {message.content}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING}
      className="group flex flex-col gap-1.5"
    >
      <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{message.content}</p>
      {message.editId && (
        <button
          type="button"
          onClick={() => onRevert(message.editId!)}
          className="inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-1 text-[12px] text-faint opacity-0 transition-all duration-150 group-hover:opacity-100 hover:bg-[color-mix(in_oklab,var(--c-ink)_8%,transparent)] hover:text-ink"
        >
          <RotateCcw size={12} />
          Revert to this version
        </button>
      )}
    </motion.div>
  );
}
