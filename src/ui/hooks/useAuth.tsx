import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  authUrl,
  fetchAuthSession,
  logout as logoutRequest,
  type AuthUser,
} from "../../lib/auth-api";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  signUpWithGitHub: () => void;
  signInWithGoogle: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const session = await fetchAuthSession();
    setUser(session.authenticated ? (session.user ?? null) : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await logoutRequest();
    setUser(null);
  }, []);

  const signUpWithGitHub = useCallback(() => {
    window.location.href = authUrl("github", "signup");
  }, []);

  const signInWithGoogle = useCallback(() => {
    window.location.href = authUrl("google", "signin");
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      refresh,
      logout,
      signUpWithGitHub,
      signInWithGoogle,
    }),
    [user, loading, refresh, logout, signUpWithGitHub, signInWithGoogle],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
