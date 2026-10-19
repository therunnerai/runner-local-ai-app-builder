import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const pexec = promisify(execFile);

/**
 * The address a phone on the same Wi-Fi reaches this machine at. Expo Go
 * loads the app from the dev server over LAN, so a loopback address is of no
 * use to it. The first non-internal IPv4 wins, with the usual Wi-Fi interface
 * preferred when it is up.
 */
export function lanAddress(): string | null {
  const all = os.networkInterfaces();
  const candidates: { name: string; address: string }[] = [];
  for (const [name, entries] of Object.entries(all)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      candidates.push({ name, address: entry.address });
    }
  }
  if (candidates.length === 0) return null;
  const preferred = candidates.find((c) => c.name === "en0") ?? candidates[0];
  return preferred.address;
}

/** The Expo Go link for a dev server on `port`, or null when the machine has no LAN address. */
export function deviceUrlFor(port: number): string | null {
  const ip = lanAddress();
  return ip ? `exp://${ip}:${port}` : null;
}

/** The project's own Expo CLI, when its dependencies are installed. */
export function expoBin(dir: string): string | null {
  const bin = path.join(dir, "node_modules", ".bin", "expo");
  return existsSync(bin) ? bin : null;
}

export function easBin(dir: string): string | null {
  const bin = path.join(dir, "node_modules", ".bin", "eas");
  return existsSync(bin) ? bin : null;
}

/**
 * The Expo SDK major the project's installed `expo` package belongs to. Expo
 * Go runs exactly one SDK, so the phone can only open the project when its
 * Expo Go is this version; the UI names the number so a mismatch is
 * explained rather than guessed at.
 */
export function expoSdkMajor(dir: string): number | null {
  try {
    const pkg = JSON.parse(readFileSync(path.join(dir, "node_modules", "expo", "package.json"), "utf8"));
    const major = Number(String(pkg.version ?? "").split(".")[0]);
    return Number.isFinite(major) && major > 0 ? major : null;
  } catch {
    return null;
  }
}

type Cached = { at: number; value: string | null };
let whoami: Cached | null = null;
const WHOAMI_TTL_MS = 60_000;

/**
 * The Expo account the CLI is signed in as, or null. Expo Go loads a project
 * only when the phone is signed in to the same account as the dev server, so
 * the UI names it next to the device link. Cached briefly: the CLI takes a
 * second to answer and the answer rarely changes.
 */
export async function expoAccount(dir: string): Promise<string | null> {
  if (whoami && Date.now() - whoami.at < WHOAMI_TTL_MS) return whoami.value;
  const bin = expoBin(dir);
  let value: string | null = null;
  if (bin) {
    try {
      const { stdout } = await pexec(bin, ["whoami"], {
        cwd: dir,
        timeout: 15_000,
        env: { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1", NO_COLOR: "1", FORCE_COLOR: "0" },
      });
      const line = stdout.trim().split("\n").pop()?.trim() ?? "";
      value = line && !/not logged in/i.test(line) ? line : null;
    } catch {
      value = null;
    }
  }
  whoami = { at: Date.now(), value };
  return value;
}

/** Forget the cached account, e.g. after the person signs in from a terminal. */
export function forgetExpoAccount(): void {
  whoami = null;
}
