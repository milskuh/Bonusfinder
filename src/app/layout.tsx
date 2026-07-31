import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";
import { Providers } from "./providers";
import { HeaderNav } from "@/components/header-nav";
import { APP_NAME, APP_DESCRIPTION } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  manifest: "/manifest.json",
  openGraph: {
    title: APP_NAME,
    description: APP_DESCRIPTION,
    siteName: APP_NAME,
    type: "website",
    locale: "nl_NL",
  },
  twitter: {
    card: "summary_large_image",
    title: APP_NAME,
    description: APP_DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ClerkProvider appearance={{ theme: shadcn }}>
          <Providers>
            <header className="flex items-center justify-between border-b px-6 py-3">
              <a href="/" className="font-semibold tracking-tight">
                {APP_NAME}
              </a>
              <HeaderNav />
            </header>
            {children}
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
