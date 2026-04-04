import Head from "next/head";
import { useRouter } from "next/router";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { ResumeDashboard } from "@/components/dashboard/resume-dashboard";
import { useAuth } from "@/hooks/use-auth";

export default function DashboardPage() {
  const router = useRouter();
  const { session, user, signOut, getAccessToken } = useAuth();

  async function onLogout() {
    await signOut();
    await router.replace("/login");
  }

  return (
    <>
      <Head>
        <title>Dashboard | CV Forge</title>
      </Head>
      <ProtectedRoute>
        {session ? (
          <ResumeDashboard
            accessToken={getAccessToken() ?? ""}
            userEmail={user?.email ?? null}
            onLogout={onLogout}
          />
        ) : null}
      </ProtectedRoute>
    </>
  );
}
