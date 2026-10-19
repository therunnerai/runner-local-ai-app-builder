import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Monitor, RefreshCw, Smartphone } from "lucide-react";
import type { PickPayload, PreviewInfo, Project } from "@runner-builder/shared";
import { DevicePanel } from "./DevicePanel";
import { IconButton, SPRING, cx } from "./ui";

type Frame = "desktop" | "mobile";

/** Message prefix used by overlay scripts scaffolded before the rename. */
const LEGACY_PREFIX = "lovable:";

export function PreviewPanel({
  url,
  kind = "scaffold",
  device = null,
  pickMode,
  onPick,
  onReloadRequested,
}: {
  url: string | null;
  /** A mobile app previews in a phone frame and offers the phone itself. */
  kind?: Project["kind"];
  device?: PreviewInfo["device"];
  pickMode: boolean;
  onPick: (payload: PickPayload) => void;
  onReloadRequested: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const reduce = useReducedMotion();
  const mobileApp = kind === "mobile";
  const [shape, setShape] = useState<Frame>(mobileApp ? "mobile" : "desktop");
  const [ready, setReady] = useState(false);
  const [nonce, setNonce] = useState(0);

  // The overlay announces itself; picking state is pushed into the frame.
  //
  // A project carries the overlay script it was scaffolded with. Projects
  // created before the rename still speak the old message prefix, so both
  // are accepted and the enable message is sent under both names.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data || typeof data !== "object" || typeof data.type !== "string") return;
      const kind = data.type.replace(LEGACY_PREFIX, "builder:");
      if (kind === "builder:ready") setReady(true);
      if (kind === "builder:pick") onPick({ ...data, type: "builder:pick" } as PickPayload);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onPick]);

  useEffect(() => {
    const target = frame.current?.contentWindow;
    target?.postMessage({ type: "builder:overlay", enabled: pickMode }, "*");
    target?.postMessage({ type: `${LEGACY_PREFIX}overlay`, enabled: pickMode }, "*");
  }, [pickMode, ready, nonce]);

  const reload = () => {
    setReady(false);
    setNonce((n) => n + 1);
  };

  useEffect(() => {
    if (nonce > 0) onReloadRequested();
  }, [nonce, onReloadRequested]);

  const width = shape === "mobile" ? 390 : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-3 py-2">
        <IconButton label="Refresh preview" onClick={reload}>
          <RefreshCw size={15} />
        </IconButton>
        <span className="flex-1" />
        {mobileApp && (
          <div className="mr-2">
            <DevicePanel device={device} />
          </div>
        )}
        <div className="material-chip edge-light flex items-center gap-0.5 rounded-full border border-hairline p-0.5">
          <FrameButton active={shape === "desktop"} onClick={() => setShape("desktop")} label="Desktop">
            <Monitor size={14} />
          </FrameButton>
          <FrameButton active={shape === "mobile"} onClick={() => setShape("mobile")} label="Mobile">
            <Smartphone size={14} />
          </FrameButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 px-3 pb-3">
        <div
          className={cx(
            "relative mx-auto h-full overflow-hidden rounded-card border border-hairline bg-raised",
            "transition-[max-width] duration-300 ease-out",
            shape === "mobile" && mobileApp && "rounded-[36px] border-[6px] border-ink/80 shadow-float",
            pickMode && "ring-2 ring-accent",
          )}
          style={{ maxWidth: width }}
        >
          {url ? (
            <iframe
              ref={frame}
              key={`${url}#${nonce}`}
              src={url}
              title="App preview"
              className="size-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            />
          ) : (
            <div className="grid size-full place-items-center text-center">
              <div className="max-w-xs px-6">
                <p className="text-[14px] font-medium">Starting the dev server…</p>
                <p className="mt-1 text-[13px] text-muted">
                  {mobileApp
                    ? "The first start of a mobile app bundles its runtime and can take a minute."
                    : "The first boot for a project takes a few seconds."}
                </p>
              </div>
            </div>
          )}

          <AnimatePresence>
            {pickMode && (
              <motion.div
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={SPRING}
                className="material-panel edge-light pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full border border-hairline px-3 py-1.5 text-[12.5px] shadow-float"
              >
                Click an element to mention it
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <p className="flex items-center gap-1.5 px-4 pb-3 text-[11.5px] text-faint">
        <AlertTriangle size={12} />
        {mobileApp
          ? "This is the web build of your native app. Open it on your phone for the real thing."
          : "Preview is your own code running locally on your machine."}
      </p>
    </div>
  );
}

function FrameButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cx(
        "grid size-7 place-items-center rounded-full transition-colors duration-150",
        active ? "bg-raised text-ink shadow-lift" : "text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
