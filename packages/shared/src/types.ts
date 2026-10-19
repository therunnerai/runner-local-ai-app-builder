/** Shared contracts between the orchestrator and the builder UI. */

export type Project = {
  id: string;
  name: string;
  /** Absolute path on disk. */
  dir: string;
  /** Dev-server port, or null when not running. */
  port: number | null;
  createdAt: number;
  updatedAt: number;
  /** "owner/name" when connected to GitHub, else null. */
  repo: string | null;
  /** Branch the mirror pull request targets. */
  baseBranch: string | null;
  /** When publishing, also land the state on the default branch. */
  pushOnPublish: boolean;
  /** The workspace (tenant) this project belongs to; null for pre-accounts rows. */
  workspaceId: string | null;
  /** The account that created it. */
  createdBy: string | null;
  /**
   * A web scaffold made here, a mobile (Expo) app made here, or an existing
   * repository opened here.
   */
  kind: "scaffold" | "repo" | "mobile";
  /**
   * The branch this project's turns are pushed to. A repository project is
   * checked out on it from creation; a scaffold gets the default mirror branch
   * once connected.
   */
  mirrorBranch: string | null;
};

export type GithubState = {
  available: boolean;
  account: string | null;
  connected: boolean;
  repo?: string;
  url?: string;
  mirrorBranch?: string;
  baseBranch?: string;
  pushedAt?: number;
  ahead?: number;
  openPr?: { number: number; url: string; title: string } | null;
  pushOnPublish: boolean;
};

export type Edit = {
  id: string;
  projectId: string;
  /** Git commit produced by this agent turn, if any. */
  commitSha: string | null;
  summary: string;
  createdAt: number;
};

export type Role = "user" | "agent" | "system";

export type Message = {
  id: string;
  projectId: string;
  role: Role;
  content: string;
  createdAt: number;
  /** The edit (agent turn) this message belongs to. */
  editId: string | null;
};

/** One agent turn = one row in `edits` = one git commit. */
export type TurnEvent =
  | { type: "turn.started"; projectId: string; turnId: string }
  /** Another turn holds this project; this one runs when `ahead` turns finish. */
  | { type: "turn.queued"; projectId: string; turnId: string; ahead: number }
  | { type: "agent.delta"; text: string }
  | { type: "agent.tool"; name: string; detail: string }
  | { type: "files.changed"; paths: string[] }
  | { type: "turn.completed"; turnId: string; editId: string; commit: string | null }
  | { type: "turn.failed"; turnId: string; error: string };

export type ProjectDetail = {
  project: Project;
  previewUrl: string | null;
  messages: Message[];
  edits: Edit[];
};

/** What the preview endpoint answers: the frame's URL, plus the phone's link for a mobile app. */
export type PreviewInfo = {
  url: string;
  device: {
    /** exp://<lan address>:<port>, what Expo Go opens. */
    url: string | null;
    /** The Expo account the dev server runs as; Expo Go must be signed in to the same one. */
    account: string | null;
  } | null;
};

/* --------------------------------------------------------------- releases */

export type ReleasePlatform = "ios" | "android";
export type ReleaseProfile = "preview" | "production";

/** One EAS cloud build queued from the builder, as last read from EAS. */
export type Release = {
  id: string;
  projectId: string;
  buildId: string;
  platform: ReleasePlatform;
  profile: ReleaseProfile;
  /** EAS's own words: NEW, IN_QUEUE, IN_PROGRESS, FINISHED, ERRORED, CANCELED. */
  status: string;
  /** Whether EAS submits this build to its store when it finishes. */
  submit: boolean;
  artifactUrl: string | null;
  logUrl: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
};

/** The store identity of a mobile project and the accounts a release depends on. */
export type ReleaseConfig = {
  name: string;
  slug: string;
  bundleId: string | null;
  packageName: string | null;
  /** Set once the project is linked to EAS. */
  projectId: string | null;
  /** The Expo account the CLI is signed in as; null means `npx expo login` is still needed. */
  account: string | null;
};

export type FileNode = {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileNode[];
};

export type PickPayload = {
  type: "builder:pick";
  selector: string;
  text: string;
  html: string;
  tag: string;
  rect: { x: number; y: number; width: number; height: number };
};

/* ------------------------------------------------------- accounts (local) */

/** The account that leaves the process. `password_hash` never does. */
export type User = {
  id: string;
  email: string;
  name: string;
  createdAt: number;
};

/** Permission within one workspace. Distinct from `Role`, which is a message author. */
export type WorkspaceRole = "viewer" | "editor" | "owner";

export type Workspace = {
  id: string;
  name: string;
  createdBy: string;
  createdAt: number;
  /** The calling user's role in this workspace. */
  role: WorkspaceRole | null;
};

export type WorkspaceMember = {
  id: string;
  email: string;
  name: string;
  role: WorkspaceRole;
  createdAt: number;
};

/** `needsBootstrap` is true until the very first account is created. */
export type AuthState = {
  user: User | null;
  needsBootstrap: boolean;
};
