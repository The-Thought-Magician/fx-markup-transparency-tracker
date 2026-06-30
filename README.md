# FxMarkupTransparencyTracker

FxMarkupTransparencyTracker decomposes every cross-border payment a company makes into its true component parts: the mid-market reference rate at transaction time, the disclosed FX fee, and the embedded rate markup the bank or processor silently baked into the exchange rate. That hidden spread, typically 1-3% of notional, is invisible on the wire confirmation and recurring on every payment. The platform surfaces it as a quantified, recoverable cost, then arms treasury teams with per-corridor and per-provider leaderboards, annualized cost projections, and re-routing scenarios they can take into bank renegotiations.

The product is a deterministic analysis engine over uploaded bank confirmations, connected processor FX statements, and a built-in realistic sample-data seeder for instant demoability. Every payment is benchmarked against the captured mid-market rate to compute the implied all-in cost, the markup in basis points, and the dollar leakage.

See `docs/idea.md` for the full product specification, data model, and target users.

## Stack

- **Backend:** Hono (Node, TypeScript, ESM) running via `tsx`, with Drizzle ORM over Neon Postgres (`@neondatabase/serverless`). Zod for request validation.
- **Frontend:** Next.js 16, React 19, TypeScript (strict), Tailwind CSS 4, App Router. Authentication via `@neondatabase/auth` (Neon Auth).
- **Auth model:** The Next.js server resolves the session and proxies requests to the backend through `web/app/api/proxy/[...path]`, injecting an `X-User-Id` header that the backend trusts.
- **Package manager:** pnpm for all Node/JS/TS work.

## Local Development

Prerequisites: Node 22+, pnpm, and a Neon Postgres database (the backend does not create its own tables, so provision the Drizzle schema out-of-band first).

### Backend

```bash
cd backend
pnpm install
# create backend/.env with DATABASE_URL, PORT, FRONTEND_URL (see below)
pnpm dev          # runs node --import tsx/esm src/index.ts on PORT (default 3001)
```

The backend serves `/health` at the root and all domain endpoints under `/api/v1/...`. On boot it runs an idempotent `seedIfEmpty()` to populate realistic sample data for instant demoability.

### Frontend

```bash
cd web
pnpm install
# create web/.env.local with the NEON_AUTH_* and NEXT_PUBLIC_API_URL vars (see below)
pnpm dev          # runs Next.js dev server on http://localhost:3000
pnpm build        # production build (must pass)
```

### Docker

```bash
docker compose up --build
```

Brings up the backend on port 3001 and the web app on port 3000.

## Environment Variables

### Backend (`backend/.env`)

```
PORT=3001
DATABASE_URL=postgres://user:password@host/db?sslmode=require
FRONTEND_URL=http://localhost:3000
ADMIN_USER_IDS=
# Stripe billing is optional; endpoints return 503 when unset.
# STRIPE_SECRET_KEY=
# STRIPE_PRO_PRICE_ID=
# STRIPE_WEBHOOK_SECRET=
```

### Frontend (`web/.env.local`)

```
NEON_AUTH_BASE_URL=https://<endpoint>.neonauth.<region>.aws.neon.tech/<db>/auth
NEON_AUTH_COOKIE_SECRET=<random 32-byte hex>
NEXT_PUBLIC_API_URL=http://localhost:3001
```

`NEXT_PUBLIC_API_URL` is the only `NEXT_PUBLIC_*` variable (baked into the bundle at build time and read by the proxy route). `NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET` are server-only.

## Billing

All features are free for signed-in users. Stripe billing is wired but optional: checkout, portal, and webhook endpoints return `503` when `STRIPE_SECRET_KEY` is not configured, while `GET /billing/plan` always works.

## Deployment

- **Backend** deploys to Render via `render.yaml` (Node runtime, `cd backend && pnpm install` build, `cd backend && node --import tsx/esm src/index.ts` start). Set `DATABASE_URL` and `FRONTEND_URL` as Render env vars.
- **Frontend** deploys to Vercel with framework `nextjs`, root directory `web`, Node 22.x.
