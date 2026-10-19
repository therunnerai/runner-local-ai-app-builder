import { spawn, type ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import net from "node:net";
import path from "node:path";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { PREVIEW_ENV, PROJECT_LOG_DIR } from "./config.ts";
import { deviceUrlFor, expoBin } from "./expo.ts";

const pexec = promisify(execFile);

/**
 * One dev server per project: Vite for a web app, the Expo dev server for a
 * mobile app (which serves the web preview and the phone from the same port).
 *
 * These are spawned DETACHED and unref'd, so restarting the orchestrator does
 * not kill them — a restart used to leave every open preview pointed at a dead
 * port, which is exactly the failure a non-technical user cannot diagnose.
 * The port is persisted on the project row, and a live server is re-adopted on
 * boot and on demand.
 */

export type ProjectKind = "scaffold" | "repo" | "mobile";

type Running = {
  port: number;
  url: string;
  /** The Expo Go link for a mobile project; null otherwise. */
  device: string | null;
  /** null when this process adopted a server it did not spawn. */
  child: ChildProcess | null;
};

const running = new Map<string, Running>();
const starting = new Map<string, Promise<Running>>();

export const urlFor = (port: number) => `http://127.0.0.1:${port}/`;

export function previewUrlFor(projectId: string): string | null {
  const r = running.get(projectId);
  return r ? r.url : null;
}

export function deviceUrlOf(projectId: string): string | null {
  return running.get(projectId)?.device ?? null;
}

function deviceFor(kind: ProjectKind | undefined, port: number): string | null {
  return kind === "mobile" ? deviceUrlFor(port) : null;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** Is something answering HTTP on this port right now? */
export async function isPortAlive(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: "127.0.0.1" });
    const done = (alive: boolean) => {
      sock.destroy();
      resolve(alive);
    };
    sock.setTimeout(600);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      void isPortAlive(port).then((alive) => {
        if (alive) return resolve();
        if (Date.now() > deadline) return reject(new Error(`dev server did not start on :${port}`));
        setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

/**
 * Terminate whatever is *listening* on the port. The listen filter matters:
 * without it lsof also names every process with a connection to the port,
 * which includes the browser showing the preview.
 */
export async function killByPort(port: number): Promise<void> {
  try {
    const { stdout } = await pexec("lsof", ["-t", "-i", `tcp:${port}`, "-sTCP:LISTEN"]);
    for (const pid of stdout.split("\n").map((s) => s.trim()).filter(Boolean)) {
      try {
        process.kill(Number(pid), "SIGTERM");
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* nothing listening */
  }
}

export type EnsureResult = { url: string; port: number; adopted: boolean; device: string | null };

/**
 * The command that serves a project's preview.
 *
 * A mobile project runs its own Expo dev server: Metro serves the web build at
 * the port's root for the preview frame, and the same port is what Expo Go on
 * a phone connects to. The Expo CLI binds every interface for exactly that
 * reason, so the device link is the machine's LAN address.
 */
function devCommand(project: { dir: string; kind?: ProjectKind }, port: number): { cmd: string; args: string[] } {
  if (project.kind === "mobile") {
    const expo = expoBin(project.dir);
    if (!expo) throw new Error("This mobile project has no Expo CLI installed; run `npm run setup` in the builder once.");
    return { cmd: expo, args: ["start", "--port", String(port)] };
  }
  const bin = path.join(project.dir, "node_modules", ".bin", "vite");
  const useBin = existsSync(bin);
  // A scaffold can fall back to a downloaded Vite; an opened repository must
  // run its own, or the preview would not be that repository's app.
  if (!useBin && project.kind === "repo") {
    throw new Error(
      "This repository has no Vite dev server installed; previews currently need a Vite app with its dependencies installed.",
    );
  }
  const viteArgs = ["--port", String(port), "--strictPort", "--host", "127.0.0.1", "--clearScreen", "false"];
  return useBin ? { cmd: bin, args: viteArgs } : { cmd: "npx", args: ["--yes", "vite", ...viteArgs] };
}

export async function ensureDevServer(project: {
  id: string;
  dir: string;
  port?: number | null;
  kind?: ProjectKind;
}): Promise<EnsureResult> {
  const existing = running.get(project.id);
  if (existing && (await isPortAlive(existing.port))) {
    return { url: existing.url, port: existing.port, adopted: true, device: existing.device };
  }
  if (existing) running.delete(project.id);

  const inFlight = starting.get(project.id);
  if (inFlight) {
    const r = await inFlight;
    return { url: r.url, port: r.port, adopted: true, device: r.device };
  }

  const task = (async (): Promise<Running> => {
    // Adopt a server that outlived a previous orchestrator process.
    if (project.port && (await isPortAlive(project.port))) {
      const adopted: Running = {
        port: project.port,
        url: urlFor(project.port),
        device: deviceFor(project.kind, project.port),
        child: null,
      };
      running.set(project.id, adopted);
      return adopted;
    }

    const port = await freePort();
    const { cmd, args } = devCommand(project, port);

    // Log to a file rather than a pipe: a detached child must not hold the
    // parent's stdio open.
    const logDir = path.join(project.dir, PROJECT_LOG_DIR);
    mkdirSync(logDir, { recursive: true });
    const log = openSync(path.join(logDir, "dev-server.log"), "a");

    const child = spawn(cmd, args, {
      cwd: project.dir,
      env: {
        ...process.env,
        ...(project.kind === "repo" ? PREVIEW_ENV : {}),
        // Detached with stdin closed, the Expo CLI runs as a plain server. CI=1
        // would do the same but also switches Metro's file watching off, and a
        // preview that never reloads is no preview.
        ...(project.kind === "mobile" ? { EXPO_NO_TELEMETRY: "1" } : {}),
        BROWSER: "none",
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
      detached: true,
      stdio: ["ignore", log, log],
    });
    child.unref();
    child.on("exit", () => running.delete(project.id));

    const entry: Running = { port, url: urlFor(port), device: deviceFor(project.kind, port), child };
    running.set(project.id, entry);

    try {
      // Metro's first start bundles the runtime, which takes longer than Vite.
      await waitForPort(port, project.kind === "mobile" ? 120_000 : 45_000);
    } catch (err) {
      running.delete(project.id);
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      throw err;
    }
    return entry;
  })();

  starting.set(project.id, task);
  try {
    const r = await task;
    return { url: r.url, port: r.port, adopted: false, device: r.device };
  } finally {
    starting.delete(project.id);
  }
}

/** Adopt any dev servers that survived the last orchestrator process. */
export async function adoptRunning(
  projects: { id: string; port: number | null; kind?: ProjectKind }[],
): Promise<void> {
  for (const project of projects) {
    if (!project.port) continue;
    if (await isPortAlive(project.port)) {
      running.set(project.id, {
        port: project.port,
        url: urlFor(project.port),
        device: deviceFor(project.kind, project.port),
        child: null,
      });
    }
  }
}

export async function stopDevServer(projectId: string): Promise<void> {
  const r = running.get(projectId);
  if (!r) return;
  running.delete(projectId);
  if (r.child) {
    try {
      r.child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  } else {
    await killByPort(r.port);
  }
}

export function stopAll(): void {
  for (const id of [...running.keys()]) void stopDevServer(id);
}
