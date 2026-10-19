import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUp, Check, Gauge, Paperclip, Square, Wand2 } from "lucide-react";
import { SOFT_SPRING, SPRING, cx, Spinner } from "./ui";

/** How hard the agent thinks on this project: the levels its CLI accepts, and the default when none is chosen. */
export type EffortChoice = {
  value: string | null;
  options: string[];
  /** The level used when `value` is null; null when the CLI has no default to name. */
  fallback: string | null;
  onChange: (value: string | null) => void;
};

const EFFORT_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
  ultra: "Ultra",
};

const effortLabel = (level: string) => EFFORT_LABELS[level] ?? level;

/**
 * A chip that names the current effort and opens the list to change it. The
 * trade is spelled out once: higher levels think longer and cost more per
 * turn; the default is what the builder found right for this kind of app.
 */
function EffortMenu({ effort, disabled }: { effort: EffortChoice; disabled?: boolean }) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const current = effort.value ?? effort.fallback;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (value: string | null) => {
    setOpen(false);
    if (value !== effort.value) effort.onChange(value);
  };

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="How hard the agent thinks on this project"
        className={cx(
          "inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-[12.5px] transition-colors",
          open
            ? "bg-[color-mix(in_oklab,var(--c-ink)_8%,transparent)] text-ink"
            : "text-muted hover:bg-[color-mix(in_oklab,var(--c-ink)_8%,transparent)] hover:text-ink",
          "disabled:opacity-40",
        )}
      >
        <Gauge size={14} />
        {current ? effortLabel(current) : "Effort"}
        {effort.value === null && current ? <span className="text-faint">· default</span> : null}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.98 }}
            transition={SOFT_SPRING}
            className="material-panel edge-light absolute bottom-[calc(100%+6px)] left-0 z-30 w-[232px] rounded-card border border-hairline p-1 shadow-float"
          >
            <p className="px-2 pt-1.5 pb-1 text-[11px] leading-snug text-faint">
              Higher levels think longer and cost more per change.
            </p>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={effort.value === null}
              onClick={() => pick(null)}
              className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12.5px] hover:bg-[color-mix(in_oklab,var(--c-ink)_6%,transparent)]"
            >
              <Check size={13} className={cx("shrink-0", effort.value === null ? "text-accent" : "text-transparent")} />
              <span className="min-w-0 flex-1 truncate">
                Default{effort.fallback ? ` · ${effortLabel(effort.fallback)}` : ""}
              </span>
            </button>
            {effort.options.map((level) => (
              <button
                key={level}
                type="button"
                role="menuitemradio"
                aria-checked={effort.value === level}
                onClick={() => pick(level)}
                className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12.5px] hover:bg-[color-mix(in_oklab,var(--c-ink)_6%,transparent)]"
              >
                <Check size={13} className={cx("shrink-0", effort.value === level ? "text-accent" : "text-transparent")} />
                <span className="min-w-0 flex-1 truncate">{effortLabel(level)}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The composer. Feedback is continuous and immediate (Apple: feedback on
 * pointer-down, never only at the end) — a stop control appears the instant a
 * turn starts. With `queueWhileBusy`, typing is never blocked: a submit during
 * a turn is queued and runs next, so the person can keep thinking ahead.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  queueWhileBusy,
  size = "chat",
  placeholder,
  autoFocus,
  pickMode,
  onTogglePick,
  effort,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  busy?: boolean;
  /** Accept submits while busy; the owner queues them. */
  queueWhileBusy?: boolean;
  size?: "chat" | "hero";
  placeholder?: string;
  autoFocus?: boolean;
  pickMode?: boolean;
  onTogglePick?: () => void;
  /** The project's effort level, when its agent has levels to choose from. */
  effort?: EffortChoice;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const reduce = useReducedMotion();
  const hero = size === "hero";
  const queueing = Boolean(busy && queueWhileBusy);

  // Grow with content, up to a ceiling.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, hero ? 200 : 168)}px`;
  }, [value, hero]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const canSend = value.trim().length > 0 && (!busy || queueing);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSubmit();
    }
  };

  const sendButton = (
    <motion.button
      type="button"
      onClick={onSubmit}
      disabled={!canSend}
      whileTap={reduce ? undefined : { scale: 0.9 }}
      transition={SPRING}
      aria-label={queueing ? "Add to queue" : "Send"}
      title={queueing ? "Runs after the current change" : undefined}
      className={cx(
        "grid size-8 place-items-center rounded-full transition-colors duration-150",
        canSend
          ? "bg-accent text-accent-ink shadow-lift"
          : "bg-[color-mix(in_oklab,var(--c-ink)_10%,transparent)] text-faint",
      )}
    >
      <ArrowUp size={16} strokeWidth={2.6} />
    </motion.button>
  );

  const stopButton = (
    <motion.button
      type="button"
      onClick={onStop}
      whileTap={reduce ? undefined : { scale: 0.9 }}
      transition={SPRING}
      aria-label="Stop"
      title="Stop the current change"
      className="grid size-8 place-items-center rounded-full bg-ink text-canvas transition-colors duration-150"
    >
      {onStop ? <Square size={13} strokeWidth={2.6} fill="currentColor" /> : <Spinner />}
    </motion.button>
  );

  return (
    <motion.div
      layout
      transition={reduce ? { duration: 0 } : SPRING}
      className={cx(
        "material-panel edge-light flex flex-col rounded-panel border border-hairline shadow-float",
        hero ? "p-3" : "p-2.5",
      )}
    >
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={queueing ? "Add a follow-up; it runs next" : (placeholder ?? "Ask for a change…")}
        className={cx(
          "w-full resize-none bg-transparent px-2 outline-none placeholder:text-faint",
          hero ? "py-2 text-[15px]" : "py-1.5 text-[14px]",
        )}
      />

      <div className="mt-1 flex items-center gap-1">
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-[12.5px] text-muted transition-colors hover:bg-[color-mix(in_oklab,var(--c-ink)_8%,transparent)] hover:text-ink"
          title="Attachments are not wired up yet"
        >
          <Paperclip size={14} />
          Attach
        </button>

        {onTogglePick && (
          <button
            type="button"
            onClick={onTogglePick}
            className={cx(
              "inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-[12.5px] transition-colors",
              pickMode
                ? "bg-accent text-accent-ink"
                : "text-muted hover:bg-[color-mix(in_oklab,var(--c-ink)_8%,transparent)] hover:text-ink",
            )}
            title="Click an element in the preview to mention it"
          >
            <Wand2 size={14} />
            {pickMode ? "Pick an element…" : "Select element"}
          </button>
        )}

        {effort && <EffortMenu effort={effort} />}

        <span className="flex-1" />

        {busy ? (
          <div className="flex items-center gap-1.5">
            {stopButton}
            {queueing && sendButton}
          </div>
        ) : (
          sendButton
        )}
      </div>
    </motion.div>
  );
}
