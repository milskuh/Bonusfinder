import { clerkMiddleware } from "@clerk/nextjs/server";

// Attaches Clerk auth context to every request so `auth()` works in route
// handlers. No routes are protected here yet — the favorites API enforces auth
// itself by returning 401 when there's no signed-in user. Add
// `createRouteMatcher` + `auth.protect()` here once the UI has protected pages.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next internals and static files, unless found in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
    // Clerk auto-proxy path.
    "/__clerk/:path*",
  ],
};
