import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
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
  // Favicon (src/app/icon.svg), apple-icon.png and the PWA manifest
  // (src/app/manifest.ts) are wired via App Router file conventions, so Next
  // injects their <link> tags automatically — none are declared here. The
  // manifest carries the 192/512 install icons + brand theme colour.
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
              <Link
                href="/"
                aria-label={`${APP_NAME} — home`}
                className="inline-flex items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
              >
                {/* Below sm: icon only (its green tile reads on any background). */}
                <Image
                  src="/brand/bonusfinder-icon.svg"
                  alt=""
                  width={36}
                  height={36}
                  priority
                  unoptimized
                  className="block h-9 w-9 sm:hidden"
                />
                {/* sm+ light: full lockup. */}
                <Image
                  src="/brand/bonusfinder-logo.svg"
                  alt=""
                  width={168}
                  height={36}
                  priority
                  unoptimized
                  className="hidden h-9 w-auto sm:block dark:hidden"
                />
                {/* sm+ dark: reversed lockup (white "bonus", light-green "finder"). */}
                <Image
                  src="/brand/bonusfinder-logo-reversed.svg"
                  alt=""
                  width={168}
                  height={36}
                  unoptimized
                  className="hidden h-9 w-auto dark:sm:block"
                />
              </Link>
              <HeaderNav />
            </header>
            {children}
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
