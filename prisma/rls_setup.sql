-- Row Level Security (RLS) — defence-in-depth for the Supabase database.
-- Addresses security-review finding F7.
--
-- WHY: this app talks to Postgres exclusively through Prisma, using the
-- privileged `postgres` connection role (DATABASE_URL / DIRECT_URL). That role is
-- the table owner and BYPASSES RLS, so enabling RLS here does NOT change how the
-- app reads/writes. What it DOES do is close Supabase's auto-generated REST/
-- GraphQL API (the `anon` and `authenticated` roles that ship with every Supabase
-- project): with RLS on and no permissive policy, those roles can read/write
-- nothing. Without this, anyone holding the project's public anon key could query
-- these tables directly, bypassing the app's per-user checks entirely.
--
-- SAFE BY DESIGN: we ENABLE (not FORCE) RLS, so the owner role Prisma uses keeps
-- bypassing it. We intentionally add NO policies — deny-by-default for anon/
-- authenticated is exactly what we want, since all access goes through Prisma.
--
-- HOW TO RUN (against the DIRECT connection, not the pooler):
--   psql "$DIRECT_URL" -f prisma/rls_setup.sql
-- Idempotent — safe to re-run. After running, smoke-test the app: every page and
-- API route should behave exactly as before (Prisma is unaffected).
--
-- TO ROLL BACK (if a non-owner connection role turns out to be in use and the app
-- starts returning empty results), disable it again:
--   ALTER TABLE "Supermarket"  DISABLE ROW LEVEL SECURITY;  -- (repeat per table)

ALTER TABLE "Supermarket"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Offer"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PriceHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Favorite"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BasketItem"   ENABLE ROW LEVEL SECURITY;
