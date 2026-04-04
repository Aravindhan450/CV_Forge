import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { type ReactNode } from "react";

import { useAuth } from "@/hooks/use-auth";

export function ProtectedRoute({
  children,
  redirectTo = "/login",
}: {
  children: ReactNode;
  redirectTo?: string;
}) {
  const router = useRouter();
  const { session, loading } = useAuth();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!loading) {
      setTimedOut(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setTimedOut(true);
    }, 10000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [loading]);

  useEffect(() => {
    if (!loading && !session) {
      router.replace(redirectTo);
    }
    if (loading && timedOut) {
      router.replace(redirectTo);
    }
  }, [loading, session, router, redirectTo, timedOut]);

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center justify-center px-6">
        <p className="text-sm text-muted-foreground">
          {timedOut ? "Session check timed out. Redirecting to login..." : "Checking your session..."}
        </p>
      </main>
    );
  }

  if (!session) {
    return null;
  }

  return <>{children}</>;
}
