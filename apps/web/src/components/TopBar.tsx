import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Braces, Eye, Files, Github, Rocket, ExternalLink, Smartphone } from "lucide-react";
import { Button, IconButton, Segmented, SPRING, Spinner } from "./ui";

export type Tab = "preview" | "code" | "files";

export function TopBar({
  name,
  tab,
  onTab,
  onBack,
  previewUrl,
  onPublish,
  publishing,
  onGithub,
  githubConnected,
  mobile = false,
  onRelease,
}: {
  name: string;
  tab: Tab;
  onTab: (t: Tab) => void;
  onBack: () => void;
  previewUrl: string | null;
  onPublish: () => void;
  publishing: boolean;
  onGithub: () => void;
  githubConnected: boolean;
  /** A mobile app ships through EAS and the stores, not a static build. */
  mobile?: boolean;
  onRelease?: () => void;
}) {
  const reduce = useReducedMotion();

  return (
    <header className="material-chrome edge-light flex h-13 shrink-0 items-center gap-2 border-b border-hairline px-2.5 py-2">
      <IconButton label="Back to dashboard" onClick={onBack}>
        <ArrowLeft size={16} />
      </IconButton>

      <motion.h1
        layout
        transition={reduce ? { duration: 0 } : SPRING}
        className="title max-w-[220px] truncate text-[14.5px] font-semibold"
      >
        {name}
      </motion.h1>

      <div className="mx-auto">
        <Segmented<Tab>
          value={tab}
          onChange={onTab}
          options={[
            { value: "preview", label: "Preview", icon: <Eye size={13} /> },
            { value: "code", label: "Code", icon: <Braces size={13} /> },
            { value: "files", label: "Files", icon: <Files size={13} /> },
          ]}
        />
      </div>

      <IconButton label="GitHub" onClick={onGithub} className="relative">
        <Github size={16} />
        {githubConnected && (
          <span className="absolute top-1 right-1 size-1.5 rounded-full bg-ok" />
        )}
      </IconButton>

      <IconButton
        label="Open preview in a new tab"
        disabled={!previewUrl}
        onClick={() => previewUrl && window.open(previewUrl, "_blank")}
      >
        <ExternalLink size={15} />
      </IconButton>

      {mobile ? (
        <Button variant="primary" size="md" onClick={onRelease}>
          <Smartphone size={14} />
          Release
        </Button>
      ) : (
        <Button variant="primary" size="md" onClick={onPublish} disabled={publishing}>
          {publishing ? <Spinner /> : <Rocket size={14} />}
          Publish
        </Button>
      )}
    </header>
  );
}
