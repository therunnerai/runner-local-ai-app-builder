import { useEffect, useRef, type KeyboardEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowUp, Paperclip, Square, Wand2 } from "lucide-react";
import { SPRING, cx, Spinner } from "./ui";

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
