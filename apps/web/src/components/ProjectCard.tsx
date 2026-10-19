import { motion, useReducedMotion } from "framer-motion";
import { MoreHorizontal, Smartphone, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Project } from "@runner-builder/shared";
import { SPRING, SOFT_SPRING, cx } from "./ui";
import { relativeTime } from "../lib/format";

export function ProjectCard({
  project,
  onOpen,
  onDelete,
}: {
  project: Project;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const reduce = useReducedMotion();
  const [menu, setMenu] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  return (
    <motion.div
      ref={wrap}
      layout
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
      transition={SOFT_SPRING}
      whileHover={reduce ? undefined : { y: -3 }}
      className="group material-panel edge-light relative flex h-[164px] flex-col justify-between rounded-card border border-hairline p-4 shadow-lift transition-shadow duration-200 hover:shadow-float"
    >
      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 rounded-card"
        aria-label={`Open ${project.name}`}
      />

      <div className="pointer-events-none relative flex items-start justify-between">
        <span className="grid size-9 place-items-center rounded-[11px] bg-[color-mix(in_oklab,var(--c-accent)_16%,transparent)] text-accent">
          {project.kind === "mobile" ? <Smartphone size={16} strokeWidth={2.2} /> : project.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="pointer-events-auto relative">
          <button
            type="button"
            aria-label="Project options"
            onClick={(e) => {
              e.stopPropagation();
              setMenu((m) => !m);
            }}
            className={cx(
              "grid size-7 place-items-center rounded-full text-faint transition-all duration-150",
              "opacity-0 group-hover:opacity-100 hover:bg-[color-mix(in_oklab,var(--c-ink)_8%,transparent)] hover:text-ink",
              menu && "opacity-100",
            )}
          >
            <MoreHorizontal size={16} />
          </button>

          {menu && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={SPRING}
              className="material-panel edge-light absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-xl border border-hairline shadow-float"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu(false);
                  onDelete();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-danger transition-colors hover:bg-[color-mix(in_oklab,var(--c-danger)_12%,transparent)]"
              >
                <Trash2 size={14} />
                Delete project
              </button>
            </motion.div>
          )}
        </div>
      </div>

      <div className="pointer-events-none relative">
        <p className="title truncate text-[15px] font-semibold">{project.name}</p>
        {project.kind === "repo" && project.repo && (
          <p className="mt-0.5 truncate font-mono text-[11.5px] text-muted">
            {project.repo} · {project.mirrorBranch} → {project.baseBranch}
          </p>
        )}
        {project.kind === "mobile" && (
          <p className="mt-0.5 truncate text-[11.5px] text-muted">iOS · Android · Expo</p>
        )}
        <p className="mt-0.5 text-[12.5px] text-faint">Edited {relativeTime(project.updatedAt)}</p>
      </div>
    </motion.div>
  );
}
