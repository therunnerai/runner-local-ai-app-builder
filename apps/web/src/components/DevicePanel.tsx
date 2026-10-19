import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { QrCode, Smartphone } from "lucide-react";
import QRCode from "qrcode";
import type { PreviewInfo } from "@runner-builder/shared";
import { SOFT_SPRING, cx } from "./ui";

/**
 * The phone is the real preview of a mobile app; the frame beside it is the
 * web build. This button opens the link Expo Go scans, with the one thing
 * that silently breaks it spelled out: the phone must be signed in to the
 * same Expo account as the dev server.
 */
export function DevicePanel({ device }: { device: PreviewInfo["device"] }) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const url = device?.url ?? null;

  useEffect(() => {
    if (!url) {
      setQr(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: "#000000", light: "#ffffff" } })
      .then((data) => {
        if (!cancelled) setQr(data);
      })
      .catch(() => setQr(null));
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cx(
          "material-chip edge-light inline-flex h-7 items-center gap-1.5 rounded-full border border-hairline px-2.5 text-[12.5px] font-medium",
          "transition-colors duration-150 hover:text-ink",
          open ? "text-ink" : "text-muted",
        )}
      >
        <Smartphone size={13} />
        Open on your phone
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            transition={SOFT_SPRING}
            className="material-panel edge-light absolute right-0 z-30 mt-2 w-[272px] rounded-panel border border-hairline p-4 shadow-float"
          >
            {url ? (
              <>
                <div className="grid place-items-center rounded-xl bg-white p-2">
                  {qr ? (
                    <img src={qr} alt="QR code for Expo Go" width={220} height={220} className="size-[220px]" />
                  ) : (
                    <span className="grid size-[220px] place-items-center text-faint">
                      <QrCode size={28} />
                    </span>
                  )}
                </div>
                <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
                  Install <span className="font-medium text-ink">Expo Go</span> from the App Store or
                  Play Store, sign in, then scan this with the phone's camera. Phone and Mac must be
                  on the same Wi-Fi.
                </p>
                {device?.sdk && (
                  <p className="mt-2 text-[12px] leading-relaxed text-faint">
                    This app runs on <span className="font-medium text-ink">Expo SDK {device.sdk}</span>, so Expo Go
                    on the phone must be version {device.sdk}. If Expo Go says the project needs a newer version,
                    update Expo Go; if it says the project is too old, the store has moved on. On iPhone only the App
                    Store version of Expo Go runs; on Android, Expo also offers older Expo Go builds for a matching
                    SDK. A development build from the Release panel works on either without Expo Go.
                  </p>
                )}
                <p className="mt-2 truncate font-mono text-[11.5px] text-faint" title={url}>
                  {url}
                </p>
                <p className="mt-2 text-[12px] leading-relaxed text-faint">
                  {device?.account ? (
                    <>
                      Dev server signed in as <span className="font-medium text-ink">{device.account}</span>; sign in to the
                      same account in Expo Go.
                    </>
                  ) : (
                    <>
                      Not signed in to Expo. Run <code className="font-mono">npx expo login</code> in a terminal,
                      then restart the preview; Expo Go only opens projects from the same account.
                    </>
                  )}
                </p>
              </>
            ) : (
              <p className="text-[12.5px] leading-relaxed text-muted">
                The dev server is starting, or this Mac has no network address a phone could reach.
                Connect to Wi-Fi and refresh the preview.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
