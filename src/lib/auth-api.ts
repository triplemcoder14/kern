export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  provider: "github" | "google";
}

export interface AuthSession {
  authenticated: boolean;
  user?: AuthUser;
}

function apiBase(): string {
  return import.meta.env.VITE_KERN_API_URL ?? "";
}

export async function fetchAuthSession(): Promise<AuthSession> {
  const response = await fetch(`${apiBase()}/api/auth/me`, {
    credentials: "include",
  });
  if (!response.ok) {
    return { authenticated: false };
  }
  return (await response.json()) as AuthSession;
}

export async function logout(): Promise<void> {
  await fetch(`${apiBase()}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}

export function authUrl(provider: "github" | "google", intent: "signup" | "signin"): string {
  return `${apiBase()}/api/auth/${provider}?intent=${intent}`;
}

export function authErrorMessage(code: string | null): string | null {
  if (!code) {
    return null;
  }

  switch (code) {
    case "github_not_configured":
      return "GitHub sign-in is not configured on this server yet.";
    case "google_not_configured":
      return "Google sign-in is not configured on this server yet.";
    case "invalid_state":
      return "Sign-in expired. Please try again.";
    case "missing_code":
      return "Sign-in was cancelled or incomplete.";
    default:
      return "Sign-in failed. Please try again.";
  }
}
