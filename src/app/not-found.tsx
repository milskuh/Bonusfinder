import Link from "next/link";
import { APP_NAME } from "@/lib/config";

// Custom 404, rendered inside RootLayout (so the app header is present). The app
// default language is Dutch, so the copy is Dutch — matching the rest of the UI
// rather than Next's default English "This page could not be found."
export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col items-center px-4 py-20 text-center sm:py-28">
      <p className="text-6xl font-extrabold tracking-tight text-brand sm:text-7xl">404</p>
      <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        Pagina niet gevonden
      </h1>
      <p className="mt-3 max-w-md text-sm text-muted-foreground sm:text-base">
        Deze pagina bestaat niet (meer). Misschien is de aanbieding verlopen of
        klopt de link niet.
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex items-center rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        Terug naar alle aanbiedingen
      </Link>
      <p className="mt-6 text-xs text-muted-foreground">{APP_NAME}</p>
    </main>
  );
}
