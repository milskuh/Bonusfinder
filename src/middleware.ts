import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

// Attaches Clerk auth context to every request so `auth()` works in route
// handlers, and applies a best-effort rate limit to the API (finding F5). No
// routes are auth-protected here yet — the favorites/basket APIs enforce auth
// themselves by returning 401 when there's no signed-in user. Add
// `createRouteMatcher` + `auth.protect()` here once the UI has protected pages.
export default clerkMiddleware(async (auth, req) => {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/api/")) return;

  // Fail-open: a limiter must never be the reason a request fails, so any error
  // in here just lets the request continue to the handler.
  try {
    const isMutation = req.method !== "GET" && req.method !== "HEAD";
    // Prefer the signed-in user as the key (fair per-account limiting); fall back
    // to client IP for anonymous/public reads.
    const { userId } = await auth();
    const identity = userId ?? clientIp(req);
    // Coarse route family so, e.g., every /api/products/<id> shares one bucket
    // rather than each id getting its own allowance.
    const routeKey = pathname.split("/").slice(0, 3).join("/"); // "/api/offers", ...

    // Reads can legitimately burst (infinite-feed pagination); mutations are
    // per-user and cheaper to abuse. checkRateLimit prefers the global Upstash
    // limiter and falls back to the in-memory one when Redis isn't configured.
    const result = await checkRateLimit(
      `${routeKey}:${req.method}:${identity}`,
      isMutation ? "mutation" : "read",
    );

    if (!result.ok) {
      const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
      return NextResponse.json(
        { error: "Te veel verzoeken, probeer het zo weer." },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfter),
            "X-RateLimit-Limit": String(result.limit),
            "X-RateLimit-Remaining": String(result.remaining),
            "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
          },
        },
      );
    }
  } catch {
    // Swallow and allow — see fail-open note above.
  }
});

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
