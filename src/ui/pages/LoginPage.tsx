import { type FormEvent, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { KernWordmark } from "../components/KernWordmark";
import { useAuth } from "../hooks/useAuth";

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const redirectTo = (location.state as { from?: string } | null)?.from ?? "/app";

  if (!loading && user) {
    return <Navigate to={redirectTo} replace />;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const ok = await login(username, password);
    setSubmitting(false);

    if (!ok) {
      setError("Invalid username or password.");
      return;
    }

    navigate(redirectTo, { replace: true });
  };

  return (
    <div className="admin-login">
      <div className="admin-login-card">
        <Link to="/" className="admin-login-brand">
          <KernWordmark />
        </Link>
        <p className="admin-login-eyebrow">Self-hosted</p>
        <h1 className="admin-login-title">Sign in to KERN</h1>
        <p className="admin-login-lede">
          Use the username and password you set when installing this KERN instance.
        </p>

        <form className="login-form" onSubmit={(event) => void handleSubmit(event)}>
          <label className="login-field">
            <span>Username</span>
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>
          <label className="login-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error ? <div className="admin-alert">{error}</div> : null}
          <button type="submit" className="landing-btn landing-btn-primary admin-login-btn" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <Link to="/" className="admin-login-back">
          Back to website
        </Link>
      </div>
    </div>
  );
}
