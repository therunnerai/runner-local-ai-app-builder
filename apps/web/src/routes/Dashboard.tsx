import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { Monitor, Smartphone } from "lucide-react";
import type { Project } from "@runner-builder/shared";
import { Sidebar } from "../components/Sidebar";
import { OpenRepoDialog } from "../components/OpenRepoDialog";
import { Composer } from "../components/Composer";
import { ProjectCard } from "../components/ProjectCard";
import { GradientBackdrop } from "../components/GradientBackdrop";
import { Segmented, Spinner, useToast } from "../components/ui";
import { createProject, deleteProject, listProjects } from "../lib/api";
import { useSession } from "../lib/session";
import { MOBILE_SUGGESTIONS, SUGGESTIONS, greeting } from "../lib/format";

type NewKind = "scaffold" | "mobile";

function nameFromPrompt(s: string): string {
  const clean = s.trim().replace(/\s+/g, " ");
  if (!clean) return "Untitled";
  const words = clean.split(" ").slice(0, 6).join(" ");
  const clipped = words.length > 34 ? words.slice(0, 34).trim() : words;
  return clipped.charAt(0).toUpperCase() + clipped.slice(1);
}

export default function Dashboard() {
  const navigate = useNavigate();
  const toast = useToast();
  const { workspace } = useSession();
  const workspaceId = workspace?.id ?? null;
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [repoOpen, setRepoOpen] = useState(false);
  // What the hero composer starts: a web app, or an Expo app for the phone.
  const [kind, setKind] = useState<NewKind>("scaffold");

  // The project list is workspace-scoped: switching workspace re-fetches, and
  // the previous list is cleared so stale rows cannot flash in.
  const refresh = useCallback(() => {
    if (!workspaceId) {
      setProjects([]);
      return;
    }
    listProjects(workspaceId)
      .then(setProjects)
      .catch((e: Error) => toast(e.message, "error"));
  }, [toast, workspaceId]);

  useEffect(() => {
    setProjects(null);
    refresh();
  }, [refresh]);

  const create = async (name: string, initialPrompt?: string, projectKind: NewKind = kind) => {
    if (creating) return;
    if (!workspaceId) {
      toast("Create a workspace first", "error");
      return;
    }
    setCreating(true);
    try {
      const project = await createProject(name, workspaceId, projectKind);
      navigate(`/p/${project.id}`, {
        state: initialPrompt ? { initialPrompt } : undefined,
      });
    } catch (e) {
      toast((e as Error).message, "error");
      setCreating(false);
    }
  };

  const remove = async (project: Project) => {
    try {
      await deleteProject(project.id);
      setProjects((p) => (p ?? []).filter((x) => x.id !== project.id));
      toast(`Deleted “${project.name}”`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div className="flex h-full">
      <Sidebar
        projects={projects ?? []}
        onNew={() => create("Untitled", undefined, "scaffold")}
        onNewMobile={() => create("Untitled app", undefined, "mobile")}
        onOpenRepo={() => setRepoOpen(true)}
        onSelect={(id) => navigate(`/p/${id}`)}
        onProjectsChanged={refresh}
      />

      <OpenRepoDialog
        open={repoOpen}
        onClose={() => setRepoOpen(false)}
        onOpened={(project) => navigate(`/p/${project.id}`)}
      />

      <main className="relative min-w-0 flex-1 overflow-y-auto">
        <GradientBackdrop className="pointer-events-none absolute inset-0" />

        <div className="relative mx-auto flex min-h-full max-w-3xl flex-col px-6">
          <section className="flex flex-1 flex-col items-center justify-center py-16">
            <h1 className="display text-center text-[clamp(1.9rem,4.4vw,2.75rem)] font-semibold">
              {greeting()}. What should we build?
            </h1>

            <div className="mt-6">
              <Segmented<NewKind>
                value={kind}
                onChange={setKind}
                options={[
                  { value: "scaffold", label: "Web app", icon: <Monitor size={13} /> },
                  { value: "mobile", label: "Mobile app", icon: <Smartphone size={13} /> },
                ]}
              />
            </div>

            <div className="mt-5 w-full">
              <Composer
                size="hero"
                value={prompt}
                onChange={setPrompt}
                onSubmit={() => {
                  const text = prompt.trim();
                  if (!text) return;
                  create(nameFromPrompt(text), text);
                }}
                busy={creating}
                autoFocus
                placeholder={
                  kind === "mobile"
                    ? "Describe the app you want on your phone…"
                    : "Describe the app you want, or ask for a change…"
                }
              />
            </div>

            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {(kind === "mobile" ? MOBILE_SUGGESTIONS : SUGGESTIONS).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setPrompt(s)}
                  className="material-chip edge-light rounded-full border border-hairline px-3.5 py-1.5 text-[12.5px] text-muted transition-all duration-150 hover:text-ink hover:shadow-lift"
                >
                  {s}
                </button>
              ))}
            </div>

            {creating && (
              <p className="mt-5 flex items-center gap-2 text-[13px] text-muted">
                <Spinner />
                Creating your project…
              </p>
            )}
          </section>

          <section className="pb-14">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="title text-[15px] font-semibold">Your projects</h2>
              {projects && projects.length > 0 && (
                <span className="text-[12.5px] text-faint">
                  {projects.length} {projects.length === 1 ? "project" : "projects"}
                </span>
              )}
            </div>

            {projects === null ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton h-[164px] rounded-card" />
                ))}
              </div>
            ) : projects.length === 0 ? (
              <p className="rounded-card border border-dashed border-hairline px-4 py-8 text-center text-[13.5px] text-faint">
                No projects yet — describe something above and it will appear here.
              </p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                <AnimatePresence mode="popLayout">
                  {projects.map((p) => (
                    <ProjectCard
                      key={p.id}
                      project={p}
                      onOpen={() => navigate(`/p/${p.id}`)}
                      onDelete={() => remove(p)}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
