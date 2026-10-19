import { useEffect, useState } from "react";
import { ChevronRight, File as FileIcon, Folder, Loader2 } from "lucide-react";
import type { FileNode } from "@runner-builder/shared";
import { getFile } from "../lib/api";
import { cx } from "./ui";

/* ------------------------------------------------------------- file tree */

function Row({
  node,
  depth,
  activePath,
  onSelect,
  defaultOpen,
}: {
  node: FileNode;
  depth: number;
  activePath?: string | null;
  onSelect: (path: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? depth === 0);
  const isDir = node.type === "dir";
  const active = node.path === activePath;

  return (
    <div>
      <button
        type="button"
        onClick={() => (isDir ? setOpen((o) => !o) : onSelect(node.path))}
        className={cx(
          "flex w-full items-center gap-1.5 rounded-lg py-[5px] pr-2 text-left text-[13px]",
          "transition-colors duration-100",
          active
            ? "bg-[color-mix(in_oklab,var(--c-accent)_14%,transparent)] text-ink"
            : "text-muted hover:bg-[color-mix(in_oklab,var(--c-ink)_6%,transparent)] hover:text-ink",
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
      >
        {isDir ? (
          <>
            <ChevronRight
              size={13}
              className={cx("shrink-0 transition-transform duration-150", open && "rotate-90")}
            />
            <Folder size={13} className="shrink-0 text-faint" />
          </>
        ) : (
          <>
            <span className="w-[13px] shrink-0" />
            <FileIcon size={13} className="shrink-0 text-faint" />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </button>

      {isDir && open && node.children?.length ? (
        <div>
          {node.children.map((child) => (
            <Row
              key={child.path}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function FileTree({
  tree,
  activePath,
  onSelect,
}: {
  tree: FileNode[];
  activePath?: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {tree.map((node) => (
        <Row key={node.path} node={node} depth={0} activePath={activePath} onSelect={onSelect} />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- code view */

export function CodeTab({
  projectId,
  tree,
  path,
  onSelect,
}: {
  projectId: string;
  tree: FileNode[];
  path: string | null;
  onSelect: (path: string) => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path) return;
    setContent(null);
    setError(null);
    getFile(projectId, path)
      .then((r) => setContent(r.content))
      .catch((e: Error) => setError(e.message));
  }, [projectId, path]);

  const lines = content?.split("\n") ?? [];

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-h-0 w-[228px] shrink-0 overflow-y-auto border-r border-hairline px-2 py-2">
        <FileTree tree={tree} activePath={path} onSelect={onSelect} />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {!path && (
          <p className="p-5 text-[13.5px] text-faint">Pick a file to read it.</p>
        )}
        {error && <p className="p-5 text-[13.5px] text-danger">{error}</p>}
        {path && content === null && !error && (
          <p className="flex items-center gap-2 p-5 text-[13.5px] text-faint">
            <Loader2 size={14} className="animate-spin" />
            Loading {path}…
          </p>
        )}
        {content !== null && (
          <pre className="min-w-fit py-3 font-mono text-[12.5px] leading-[1.6]">
            {lines.map((line, i) => (
              <div key={i} className="flex hover:bg-[color-mix(in_oklab,var(--c-ink)_4%,transparent)]">
                <span className="w-11 shrink-0 pr-3 text-right text-faint select-none">
                  {i + 1}
                </span>
                <code className="pr-6 whitespace-pre">{line || " "}</code>
              </div>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- files only */

export function FilesTab({
  tree,
  onOpenFile,
}: {
  tree: FileNode[];
  onOpenFile: (path: string) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <div className="mx-auto max-w-md">
        <FileTree tree={tree} onSelect={onOpenFile} />
      </div>
    </div>
  );
}
