"use client";

// Client-side providers. Currently just TanStack Query; add more (theme, etc.)
// by nesting them here. The QueryClient lives in state so it isn't recreated on
// re-render, and is created per-request on the server to avoid cross-request
// data leaks.
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LanguageProvider } from "@/components/language-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // offers change only on ingest — cache generously
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>{children}</LanguageProvider>
    </QueryClientProvider>
  );
}
