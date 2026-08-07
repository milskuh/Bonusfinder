import type { Metadata, Viewport } from "next";
import Image from "next/image";
import Link from "next/link";
import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";
import { Providers } from "./providers";
import { HeaderNav } from "@/components/header-nav";
import { LogoMarqueeBackground } from "@/components/logo-marquee-background";
import { APP_NAME, APP_DESCRIPTION, SITE_URL } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  // Absolute base for every relative URL Next emits (canonical, Open Graph,
  // Twitter) — without it those resolve to localhost and Google can't index a
  // canonical host.
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: "/" },
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

// Tint the mobile browser chrome to match the page background in each scheme
// (Next injects the matching <meta name="theme-color"> tags). The PWA install
// colour lives separately in the manifest (src/app/manifest.ts).
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

// Apply the saved theme — or the OS colour-scheme when it's "system"/unset —
// before first paint, so the design tokens (globals.css) and every `dark:`
// utility resolve without a light→dark flash. <ThemeProvider> (providers.tsx)
// keeps it in sync and drives the header toggle afterwards. Runs inline
// (pre-hydration); <html suppressHydrationWarning> keeps React from complaining
// about the class it can't see server-side.
const themeScript = `(function(){try{var s=localStorage.getItem('theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',s==='dark'||((s===null||s==='system')&&m))}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* Ambient, faded supermarket-logo backdrop. Fixed at z-index -10 and
            decorative, so it renders behind everything and shows through the
            transparent page chrome. Kept just after the pre-paint theme script
            (which must stay first) but before all rendered content. */}
        <LogoMarqueeBackground />
        <ClerkProvider appearance={{ theme: shadcn }}>
          <Providers>
            {/* Opaque background so the fixed logo backdrop doesn't show through
                the top bar — the logos stay in the gutters below it. */}
            <header className="flex items-center justify-between border-b bg-background px-4 py-3 sm:px-6">
              <Link
                href="/"
                aria-label={`${APP_NAME} — home`}
                className="inline-flex shrink-0 items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
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
