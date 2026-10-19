import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button, Spinner } from "../components/ui";
import { useSession } from "../lib/session";

const field =
  "w-full rounded-[10px] border border-hairline bg-surface px-3 py-2.5 text-[14px] text-ink " +
  "placeholder:text-faint outline-none transition-colors focus-visible:border-accent";

export default function Login() {
  const { status, user, needsBootstrap, signIn, claim } = useSession();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === "loading") {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }
  if (user) return <Navigate to="/" replace />;

  const first = needsBootstrap;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (first) await claim(email.trim(), name.trim(), password);
      else await signIn(email.trim(), password);
      navigate("/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-full place-items-center bg-canvas px-6">
      <div className="material-panel edge-light w-full max-w-[380px] rounded-panel p-7 shadow-float">
        <h1 className="display text-[22px] font-semibold">
          {first ? "Create your account" : "Sign in"}
        </h1>
        <p className="mt-1.5 text-[13px] text-muted">
          {first
            ? "This is the first account on this machine, so it becomes the owner."
            : "Runner Builder — your projects stay on this machine."}
        </p>

        <form className="mt-6 flex flex-col gap-3" onSubmit={submit}>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-muted">Email</span>
            <input
              className={field}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          {first && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-muted">Name</span>
              <input
                className={field}
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-muted">Password</span>
            <input
              className={field}
              type="password"
              autoComplete={first ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>

          {error && <p className="text-[12.5px] text-danger">{error}</p>}

          <Button
            type="submit"
            variant="primary"
            size="md"
            className="mt-1 w-full justify-center"
            disabled={busy}
          >
            {busy ? "Working…" : first ? "Create account" : "Sign in"}
          </Button>
        </form>

        {!first && (
          <p className="mt-5 text-[12px] leading-relaxed text-faint">
            Accounts are created by an existing workspace owner, not by self-signup.
          </p>
        )}
      </div>
    </div>
  );
}
