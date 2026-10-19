import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type HTMLMotionProps,
} from "framer-motion";
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ");

/**
 * Springs, per Apple's fluid-interface guidance: interruptible and
 * velocity-aware. Response ≈ 0.32s, critically damped (no overshoot) by default.
 */
export const SPRING = { type: "spring", stiffness: 520, damping: 40, mass: 0.9 } as const;
export const SOFT_SPRING = { type: "spring", stiffness: 300, damping: 32 } as const;
export const BOUNCY = { type: "spring", stiffness: 480, damping: 28, mass: 0.7 } as const;

type ButtonVariant = "primary" | "glass" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-110 shadow-lift",
  glass:
    "material-chip text-ink edge-light border border-hairline hover:bg-[color-mix(in_oklab,var(--c-ink)_7%,transparent)]",
  ghost: "text-muted hover:text-ink hover:bg-[color-mix(in_oklab,var(--c-ink)_6%,transparent)]",
  danger: "bg-danger text-white hover:brightness-110",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-full",
  md: "h-9 px-3.5 text-[13.5px] gap-2 rounded-full",
  lg: "h-11 px-5 text-[15px] gap-2 rounded-pill",
};

export function Button({
  variant = "glass",
  size = "md",
  className,
  children,
  ...rest
}: { variant?: ButtonVariant; size?: ButtonSize } & HTMLMotionProps<"button">) {
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="button"
      whileTap={reduce ? undefined : { scale: 0.97 }}
      transition={SPRING}
      className={cx(
        "inline-flex select-none items-center justify-center font-medium",
        "transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none",
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: { label: string } & HTMLMotionProps<"button">) {
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      whileTap={reduce ? undefined : { scale: 0.92 }}
      transition={SPRING}
      className={cx(
        "inline-flex h-8 w-8 items-center justify-center rounded-full text-muted",
        "transition-colors duration-150 hover:text-ink hover:bg-[color-mix(in_oklab,var(--c-ink)_8%,transparent)]",
        "disabled:opacity-40 disabled:pointer-events-none",
        className,
      )}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
}) {
  const id = useId();
  const reduce = useReducedMotion();
  return (
    <div className="material-chip edge-light relative flex items-center gap-0.5 rounded-full border border-hairline p-0.5">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cx(
              "relative z-10 inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium",
              "transition-colors duration-150",
              active ? "text-ink" : "text-muted hover:text-ink",
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                transition={reduce ? { duration: 0 } : SOFT_SPRING}
                className="absolute inset-0 -z-10 rounded-full bg-raised shadow-lift"
              />
            )}
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- toasts */

type Toast = { id: number; text: string; tone: "info" | "error" };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const reduce = useReducedMotion();

  const push = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
              transition={SOFT_SPRING}
              className="material-panel edge-light pointer-events-auto max-w-md rounded-card border border-hairline px-4 py-2.5 text-[13.5px] shadow-float"
            >
              <span className={t.tone === "error" ? "text-danger" : "text-ink"}>{t.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
