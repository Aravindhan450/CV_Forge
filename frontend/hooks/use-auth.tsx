import {
  type Session,
  type User,
  type AuthError,
  type SignInWithPasswordCredentials,
  type SignUpWithPasswordCredentials,
} from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { getSupabaseClient } from "@/lib/supabase";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (credentials: SignInWithPasswordCredentials) => Promise<{ error: AuthError | null }>;
  signUp: (credentials: SignUpWithPasswordCredentials) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
  getAccessToken: () => string | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | null = null;
    const fallbackTimer = window.setTimeout(() => {
      if (!mounted) {
        return;
      }
      // Avoid an infinite spinner if session retrieval hangs.
      setLoading(false);
    }, 8000);

    try {
      const supabase = getSupabaseClient();

      supabase.auth
        .getSession()
        .then(({ data }) => {
          if (!mounted) {
            return;
          }
          setSession(data.session ?? null);
          setLoading(false);
        })
        .catch(() => {
          if (!mounted) {
            return;
          }
          setSession(null);
          setLoading(false);
        });

      const listener = supabase.auth.onAuthStateChange((_event, nextSession) => {
        setSession(nextSession ?? null);
        setLoading(false);
      });
      unsubscribe = () => listener.data.subscription.unsubscribe();
    } catch {
      if (mounted) {
        setSession(null);
        setLoading(false);
      }
    }

    return () => {
      mounted = false;
      window.clearTimeout(fallbackTimer);
      unsubscribe?.();
    };
  }, []);

  const signIn = useCallback(async (credentials: SignInWithPasswordCredentials) => {
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword(credentials);
    return { error };
  }, []);

  const signUp = useCallback(async (credentials: SignUpWithPasswordCredentials) => {
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.signUp(credentials);
    return { error };
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
  }, []);

  const getAccessToken = useCallback(() => session?.access_token ?? null, [session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      loading,
      signIn,
      signUp,
      signOut,
      getAccessToken,
    }),
    [session, loading, signIn, signUp, signOut, getAccessToken]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
