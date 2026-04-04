import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect } from "react";

import { useAuth } from "@/hooks/use-auth";

export default function HomePage() {
  const router = useRouter();
  const { session, loading } = useAuth();

  useEffect(() => {
    if (loading) {
      return;
    }

    void router.replace(session ? "/dashboard" : "/login");
  }, [loading, router, session]);

  return (
    <>
      <Head>
        <title>CV Forge</title>
      </Head>
      <main className="mx-auto flex min-h-screen max-w-md items-center justify-center px-6">
        <p className="text-sm text-muted-foreground">Loading CV Forge...</p>
      </main>
    </>
  );
}
