import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { HOST, PORT, PROJECT_LOG_DIR, WEB_DIST } from "./config.ts";
import { registerRoutes } from "./routes.ts";
import { adoptRunning, killByPort, stopAll } from "./devservers.ts";
import { listProjects, setPort } from "./projects.ts";
import { pruneSessions } from "./auth.ts";
import { backfillOrphanProjects } from "./accounts.ts";
import { legacyHomeAdopted } from "./db.ts";
import { ensureExcluded } from "./git.ts";

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  bodyLimit: 8 * 1024 * 1024,
});

await registerRoutes(app);

// Opening the database is what performs the one-time data-directory adoption,
// so it must happen before the adoption flag below is consulted.
const projects = await listProjects();

// A dev server that outlived the data-directory move still serves the old
// path: it answers, but with 404s and a dead watcher. Retire those so the next
// preview request starts a fresh one under the new path.
if (legacyHomeAdopted) {
  for (const project of projects) {
    if (!project.port) continue;
    await killByPort(project.port);
    await setPort(project.id, null);
  }
}

// The agent log directory must never ride along in a turn's commit. Projects
// scaffolded before it was renamed only ignore the old name, so the exclusion
// is kept in each repository's local exclude file rather than its .gitignore.
for (const project of projects) {
  await ensureExcluded(project.dir, `${PROJECT_LOG_DIR}/`).catch(() => {});
}

// Dev servers are detached, so they outlive this process. Re-adopt any that are
// still serving instead of starting a second one on a new port — otherwise a
// restart silently breaks every preview a user has open.
await adoptRunning(await listProjects());

// Housekeeping: drop expired sessions, and attach any project that predates
// accounts to the first user's workspace so it does not vanish from a scoped
// project list.
await pruneSessions();
await backfillOrphanProjects();

// Serve the built builder UI when it exists (production mode).
if (existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, { root: WEB_DIST, prefix: "/", wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api")) return reply.code(404).send({ error: "not found" });
    return reply.sendFile("index.html");
  });
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopAll();
    app.close().finally(() => process.exit(0));
  });
}

await app.listen({ port: PORT, host: HOST });
console.log(`\n  Runner Builder orchestrator → http://${HOST}:${PORT}\n`);
