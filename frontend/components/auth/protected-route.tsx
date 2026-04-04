import { useRouter } from "next/router";
import { useEffect } from "react";
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

  useEffect(() => {
    if (!loading && !session) {
      router.replace(redirectTo);
    }
  }, [loading, session, router, redirectTo]);

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center justify-center px-6">
        <p className="text-sm text-muted-foreground">Checking your session...</p>
      </main>
    );
  }

  if (!session) {
    return null;
  }

  return <>{children}</>;
}
