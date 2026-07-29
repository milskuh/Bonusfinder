import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";
import { Providers } from "./providers";
import { HeaderNav } from "@/components/header-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aanbiedingscraper",
  description: "Vergelijk supermarktaanbiedingen en vind de beste deals.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ClerkProvider appearance={{ theme: shadcn }}>
          <Providers>
            <header className="flex items-center justify-between border-b px-6 py-3">
              <a href="/" className="font-semibold tracking-tight">
                Aanbiedingscraper
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
