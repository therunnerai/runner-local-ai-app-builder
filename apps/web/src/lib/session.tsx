import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { User, Workspace } from "@runner-builder/shared";
import * as api from "./api";
import { Spinner } from "../components/ui";

/**
 * Who is signed in, and which workspace they are looking at.
 *
 * The selected workspace is a UI convenience only: the server decides access from
 * the session cookie on every request, so a tampered localStorage value changes
 * what is *shown*, never what is *allowed*.
 */

type SessionValue = {
  status: "loading" | "ready";
  user: User | null;
  needsBootstrap: boolean;
  workspaces: Workspace[];
  workspace: Workspace | null;
  signIn: (email: string, password: string) => Promise<void>;
  claim: (email: string, name: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  selectWorkspace: (id: string) => void;
  addWorkspace: (name: string) => Promise<Workspace>;
  reloadWorkspaces: () => Promise<void>;
};

const Ctx = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}

const WORKSPACE_KEY = "rb.workspace";

function readStoredWorkspace(): string | null {
  try {
    return localStorage.getItem(WORKSPACE_KEY);
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [user, setUser] = useState<User | null>(null);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(readStoredWorkspace);

  const reloadWorkspaces = useCallback(async () => {
    const list = await api.listWorkspaces();
    setWorkspaces(list);
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const state = await api.me();
      setUser(state.user);
      setNeedsBootstrap(state.needsBootstrap);
      if (state.user) await reloadWorkspaces();
      else setWorkspaces([]);
    } catch {
      setUser(null);
    } finally {
      setStatus("ready");
    }
  }, [reloadWorkspaces]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  // A 401 from anywhere in the app drops the session; the guard then redirects.
  useEffect(() => {
    api.setUnauthorizedHandler(() => setUser(null));
    return () => api.setUnauthorizedHandler(null);
  }, []);

  const workspace = useMemo(() => {
    if (workspaces.length === 0) return null;
    return workspaces.find((w) => w.id === workspaceId) ?? workspaces[0];
  }, [workspaces, workspaceId]);

  // Keep the stored id valid: it may point at a workspace the user left.
  useEffect(() => {
    if (!workspace || workspace.id === workspaceId) return;
    setWorkspaceId(workspace.id);
    try {
      localStorage.setItem(WORKSPACE_KEY, workspace.id);
    } catch {
      /* storage is optional */
    }
  }, [workspace, workspaceId]);

  const selectWorkspace = useCallback((id: string) => {
    setWorkspaceId(id);
    try {
      localStorage.setItem(WORKSPACE_KEY, id);
    } catch {
      /* storage is optional */
    }
  }, []);

  const value: SessionValue = {
    status,
    user,
    needsBootstrap,
    workspaces,
    workspace,
    signIn: async (email, password) => {
      setUser((await api.login({ email, password })).user);
      await refreshSession();
    },
    claim: async (email, name, password) => {
      setUser((await api.bootstrap({ email, name, password })).user);
      await refreshSession();
    },
    signOut: async () => {
      await api.logout();
      setUser(null);
      setWorkspaces([]);
    },
    selectWorkspace,
    addWorkspace: async (name) => {
      const created = await api.createWorkspace(name);
      await reloadWorkspaces();
      selectWorkspace(created.id);
      return created;
    },
    reloadWorkspaces,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Layout route: blocks the app chrome until a session exists. */
export function RequireAuth() {
  const { status, user } = useSession();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return <Outlet />;
}
