import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ExternalLink, RefreshCw, Rocket, Smartphone, X } from "lucide-react";
import type { Release, ReleaseConfig } from "@runner-builder/shared";
import { getReleaseConfig, listReleases, setReleaseIdentity, startRelease } from "../lib/api";
import { Button, IconButton, SOFT_SPRING, Spinner, cx, useToast } from "./ui";
import { relativeTime } from "../lib/format";

type Platform = "ios" | "android" | "all";
type Profile = "preview" | "production";

/** A bundle id the stores accept, suggested from the app's name. */
function suggestId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "app";
  return `com.yourcompany.${slug}`;
}

function statusTone(status: string): string {
  if (status === "FINISHED") return "text-ok";
  if (status === "ERRORED" || status === "CANCELED" || status === "CANCELLED") return "text-danger";
  return "text-muted";
}

function statusLabel(status: string): string {
  switch (status) {
    case "NEW":
    case "IN_QUEUE":
      return "Queued";
    case "IN_PROGRESS":
      return "Building";
    case "FINISHED":
      return "Built";
    case "ERRORED":
      return "Failed";
    case "CANCELED":
    case "CANCELLED":
      return "Cancelled";
    default:
      return status.toLowerCase();
  }
}

/**
 * Ship a mobile app: record its store identity once, queue EAS cloud builds,
 * and watch them land. Nothing here needs Xcode or Android Studio on this
 * machine; signing and the stores are handled by EAS with the credentials the
 * person keeps there. Store listings and App Review stay in their hands.
 */
export function ReleaseDialog({
  projectId,
  projectName,
  onClose,
}: {
  projectId: string;
  projectName: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const reduce = useReducedMotion();
  const [config, setConfig] = useState<ReleaseConfig | null>(null);
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [bundleId, setBundleId] = useState("");
  const [packageName, setPackageName] = useState("");
  const [platform, setPlatform] = useState<Platform>("all");
  const [profile, setProfile] = useState<Profile>("preview");
  const [submit, setSubmit] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([getReleaseConfig(projectId), listReleases(projectId, true)]);
      setConfig(c);
      setReleases(r);
      setBundleId((v) => v || c.bundleId || suggestId(projectName));
      setPackageName((v) => v || c.packageName || c.bundleId || suggestId(projectName));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [projectId, projectName, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Builds take minutes; while any is unfinished, keep asking EAS.
  useEffect(() => {
    if (!releases?.some((r) => !["FINISHED", "ERRORED", "CANCELED", "CANCELLED"].includes(r.status))) return;
    const timer = setInterval(() => {
      listReleases(projectId, true).then(setReleases).catch(() => {});
    }, 20_000);
    return () => clearInterval(timer);
  }, [projectId, releases]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const identitySet = Boolean(config?.bundleId && config?.packageName);

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => !busy && onClose()}
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
      />

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Release"
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 6 }}
        transition={SOFT_SPRING}
        className="material-panel edge-light relative z-10 w-full max-w-[520px] overflow-hidden rounded-panel border border-hairline shadow-float"
      >
        <header className="flex items-center gap-2.5 px-5 pt-4 pb-3">
          <Smartphone size={17} />
          <h2 className="title flex-1 text-[15px] font-semibold">Release to the stores</h2>
          <IconButton label="Close" onClick={onClose} disabled={Boolean(busy)}>
            <X size={16} />
          </IconButton>
        </header>

        <div className="max-h-[72vh] overflow-y-auto px-5 pt-1 pb-5">
          {!config ? (
            <div className="grid h-32 place-items-center">
              <Spinner />
            </div>
          ) : (
            <>
              <p className="text-[13px] leading-relaxed text-muted">
                Builds run in Expo's cloud and are signed with the credentials kept in your Expo
                account. Nothing is compiled on this Mac.
                {config.account ? (
                  <>
                    {" "}
                    Signed in to Expo as <span className="font-medium text-ink">{config.account}</span>.
                  </>
                ) : (
                  <>
                    {" "}
                    <span className="text-danger">Not signed in to Expo.</span> Run{" "}
                    <code className="font-mono">npx expo login</code> in a terminal first.
                  </>
                )}
              </p>

              <section className="mt-4">
                <h3 className="text-[11.5px] font-medium tracking-wide text-faint uppercase">App identity</h3>
                {identitySet ? (
                  <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12.5px]">
                    <dt className="text-faint">iOS bundle id</dt>
                    <dd className="truncate font-mono text-ink">{config.bundleId}</dd>
                    <dt className="text-faint">Android package</dt>
                    <dd className="truncate font-mono text-ink">{config.packageName}</dd>
                    <dt className="text-faint">EAS project</dt>
                    <dd className="truncate font-mono text-ink">{config.projectId ?? "linked on first build"}</dd>
                  </dl>
                ) : (
                  <div className="mt-2 flex flex-col gap-2.5">
                    <Field label="iOS bundle id">
                      <input
                        value={bundleId}
                        onChange={(e) => {
                          setBundleId(e.target.value);
                          if (packageName === "" || packageName === bundleId) setPackageName(e.target.value);
                        }}
                        spellCheck={false}
                        className="h-9 w-full rounded-xl border border-hairline bg-transparent px-3 font-mono text-[13px] outline-none focus-visible:border-accent"
                      />
                    </Field>
                    <Field label="Android package">
                      <input
                        value={packageName}
                        onChange={(e) => setPackageName(e.target.value)}
                        spellCheck={false}
                        className="h-9 w-full rounded-xl border border-hairline bg-transparent px-3 font-mono text-[13px] outline-none focus-visible:border-accent"
                      />
                    </Field>
                    <p className="text-[12px] leading-relaxed text-faint">
                      Reverse-DNS, unique in each store, and permanent once an app is published. Use a
                      domain you own.
                    </p>
                    <div className="flex justify-end">
                      <Button
                        variant="glass"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          guard("identity", async () => {
                            setConfig(await setReleaseIdentity(projectId, { bundleId: bundleId.trim(), packageName: packageName.trim() }));
                            toast("Store identifiers saved");
                          })
                        }
                      >
                        {busy === "identity" ? <Spinner /> : null}
                        Save identifiers
                      </Button>
                    </div>
                  </div>
                )}
              </section>

              <section className="mt-5">
                <h3 className="text-[11.5px] font-medium tracking-wide text-faint uppercase">Build</h3>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <Field label="Platform">
                    <select
                      value={platform}
                      disabled={Boolean(busy)}
                      onChange={(e) => setPlatform(e.target.value as Platform)}
                      className="h-9 rounded-xl border border-hairline bg-surface px-3 text-[13px] outline-none focus-visible:border-accent"
                    >
                      <option value="all">iOS and Android</option>
                      <option value="ios">iOS</option>
                      <option value="android">Android</option>
                    </select>
                  </Field>
                  <Field label="Profile">
                    <select
                      value={profile}
                      disabled={Boolean(busy)}
                      onChange={(e) => setProfile(e.target.value as Profile)}
                      className="h-9 rounded-xl border border-hairline bg-surface px-3 text-[13px] outline-none focus-visible:border-accent"
                    >
                      <option value="preview">Preview (install on test phones)</option>
                      <option value="production">Production (store-ready)</option>
                    </select>
                  </Field>
                </div>
                <label className="mt-3 flex items-start gap-2 text-[12.5px] text-muted">
                  <input
                    type="checkbox"
                    checked={submit}
                    disabled={profile !== "production" || Boolean(busy)}
                    onChange={(e) => setSubmit(e.target.checked)}
                    className="mt-0.5 accent-[var(--c-accent)]"
                  />
                  <span>
                    Submit to TestFlight and the Play internal track when the build finishes. Needs an App
                    Store Connect key and a Play service account saved in EAS (
                    <code className="font-mono">npx eas-cli credentials</code>). Public release and App
                    Review stay yours.
                  </span>
                </label>
                <p className="mt-2 text-[12px] leading-relaxed text-faint">
                  The first build of a new app also creates its signing credentials in EAS. If EAS asks
                  for them, run <code className="font-mono">npx eas-cli credentials</code> in the project
                  once, then build again from here.
                </p>
                <div className="mt-3 flex justify-end">
                  <Button
                    variant="primary"
                    disabled={Boolean(busy) || !identitySet || !config.account}
                    onClick={() =>
                      guard("build", async () => {
                        setReleases(await startRelease(projectId, { platform, profile, submit: submit && profile === "production" }));
                        toast("Builds queued on EAS");
                        setConfig(await getReleaseConfig(projectId));
                      })
                    }
                  >
                    {busy === "build" ? <Spinner /> : <Rocket size={14} />}
                    Build{submit && profile === "production" ? " and submit" : ""}
                  </Button>
                </div>
              </section>

              <section className="mt-5">
                <div className="flex items-center">
                  <h3 className="flex-1 text-[11.5px] font-medium tracking-wide text-faint uppercase">Builds</h3>
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => guard("refresh", async () => setReleases(await listReleases(projectId, true)))}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] text-muted hover:text-ink"
                  >
                    {busy === "refresh" ? <Spinner /> : <RefreshCw size={12} />}
                    Refresh
                  </button>
                </div>
                {!releases || releases.length === 0 ? (
                  <p className="mt-2 rounded-xl border border-dashed border-hairline px-3 py-5 text-center text-[12.5px] text-faint">
                    No builds yet.
                  </p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {releases.map((r) => (
                      <li
                        key={r.id}
                        className="material-chip edge-light flex items-center gap-3 rounded-xl border border-hairline px-3 py-2 text-[12.5px]"
                      >
                        <span className="w-16 shrink-0 font-medium">{r.platform === "ios" ? "iOS" : "Android"}</span>
                        <span className={cx("w-20 shrink-0", statusTone(r.status))}>{statusLabel(r.status)}</span>
                        <span className="min-w-0 flex-1 truncate text-faint">
                          {r.profile}
                          {r.submit ? " · submits" : ""} · {relativeTime(r.createdAt)}
                          {r.error ? ` · ${r.error}` : ""}
                        </span>
                        {r.artifactUrl && (
                          <a href={r.artifactUrl} target="_blank" rel="noreferrer" className="shrink-0 text-accent hover:underline">
                            Download
                          </a>
                        )}
                        {r.logUrl && (
                          <a href={r.logUrl} target="_blank" rel="noreferrer" aria-label="Open on EAS" className="shrink-0 text-faint hover:text-ink">
                            <ExternalLink size={13} />
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11.5px] font-medium tracking-wide text-faint uppercase">{label}</span>
      {children}
    </label>
  );
}
