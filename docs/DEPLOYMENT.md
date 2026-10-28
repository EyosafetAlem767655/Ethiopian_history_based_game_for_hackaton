# Deploy ክብረ ጉግስ — Kibre Gugs

Keep your existing Vercel and Supabase projects. Add one Railway service for HTTP and Colyseus. SQLite on its volume remains the runtime authority. Supabase provides optional authenticated accounts, private gathering images, and queued hosted record mirrors. Do not delete existing data or rerun migration 001.

## 1. Back up before upgrading

Back up `data/knights.sqlite` with `node --import tsx scripts/backup.ts output/backups/knights.sqlite`. Preserve the existing backend volume and `SESSION_SECRET`. Installations without an environment override keep a generated signing secret inside SQLite. Changing the active secret invalidates guest sessions. Browser storage must also survive for guests to retain access.

Save the current deployment revision and environment settings privately. Never put a service-role key, signer key, or session secret in a `VITE_*` variable.

## 2. Check locally

Use Node 22.18+ and pnpm 11. Run `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. Windows users can use `pnpm.cmd`. `pnpm dev` starts the frontend at `http://localhost:5173` and backend at `http://localhost:2567`.

Only the Vite development server supplies an API proxy. Root `.env` belongs to the backend. Vite reads `apps/web/.env` or build-environment variables. See `.env.example`. Commit and push the updated source revision, including the new artwork, font/license, icons and migration, before deploying it from your connected repository. Keep secrets, runtime data and test output outside the commit.

## 3. Create the Railway backend

Create a Railway project/service from this repository, using repository root as the service root. Use the included `Dockerfile` and `railway.json`. Deploy **one instance**, with no sleeping/serverless mode for active games. Room memory and SQLite are single-instance by design.

Attach a persistent volume at **`/app/data` before production play**. Configure:

| Railway variable            | Value                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `DB_PATH`                   | `/app/data/knights.sqlite`                                                                                |
| `SESSION_SECRET`            | Preserve the existing value; for a new installation generate at least 32 random bytes and store privately |
| `CORS_ORIGINS`              | `https://ethiopian-history-based-game-for-ha.vercel.app`                                                  |
| `ENABLE_DEMO`               | `true`                                                                                                    |
| `ALLOW_CHAIN_BROADCAST`     | `false` until separately authorized                                                                       |
| `SUPABASE_URL`              | Existing Supabase project URL, if enabling hosted accounts                                                |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret service-role key, backend only                                                                     |

Railway provides `PORT`. Generate a public HTTPS domain for this service. Your API endpoint becomes `https://YOUR-ACTUAL-RAILWAY-DOMAIN`; WebSocket endpoint is `wss://YOUR-ACTUAL-RAILWAY-DOMAIN`. These are the backend domain, without `/api`, `/matchmake`, or a Vercel URL. When migrating a database that uses its generated internal signing secret, leave `SESSION_SECRET` unset so that same secret remains active; do not override it with a new value.

Volumes are mounted at runtime, not build time, and have deployment/replica constraints. Review [Railway volume documentation](https://docs.railway.com/volumes/reference). SQLite and live room memory are the reasons for this persistent service architecture.

To migrate existing local records, stop gameplay, create a coherent SQLite backup, transfer it to the volume as `knights.sqlite`, and preserve the active signing secret. Do this before creating new production records. Do not overwrite an active production database with an old local copy.

## 4. Verify backend health first

Open `https://YOUR-ACTUAL-RAILWAY-DOMAIN/api/health`. Require `Content-Type: application/json` and:

```json
{
  "ok": true,
  "identity": "local-guest",
  "persistence": "sqlite",
  "blockchain": "simulated",
  "protocol": 2,
  "tickRate": 30
}
```

An HTML page, blank body, Railway error page, or 404 is a deployment failure. Inspect Railway logs and the configured `/api/health` health check. CORS must contain the exact frontend HTTPS origin with no path or trailing slash. Add permitted preview origins explicitly, comma separated.

## 5. Upgrade the existing Supabase project additively

In your current project's SQL editor apply **only `supabase/migrations/002_campaign.sql`** if 001 was previously applied. It adds campaign progress, own-account reads, and a trusted atomic campaign-result RPC. It does not clear profiles, ratings, matches, images, or legacy unlocks.

If using CLI migration tracking, inspect `supabase migration list` first and apply only pending migrations to the linked existing project. Never run `supabase db reset` on production. For a completely new project only, apply 001 once, then 002. Keep the existing `gatherings` bucket private.

Under Authentication → URL Configuration set:

| Setting                   | Exact value                                               |
| ------------------------- | --------------------------------------------------------- |
| Site URL                  | `https://ethiopian-history-based-game-for-ha.vercel.app/` |
| Additional redirect URL   | `https://ethiopian-history-based-game-for-ha.vercel.app/` |
| Local redirect, if needed | `http://localhost:5173/`                                  |

Add only intentional preview redirects. Keep email authentication enabled. See [Supabase redirect URL documentation](https://supabase.com/docs/guides/auth/redirect-urls). Guests remain guests; genuine gathering requires four separate authenticated human accounts, completed Chapter II or valid legacy qualification, a consented private image, and all four approvals. Test image deletion. The lunch pass remains a prototype without real-world redemption.

## 6. Configure and redeploy existing Vercel

Your production origin is **`https://ethiopian-history-based-game-for-ha.vercel.app`**.

Use repository root as Root Directory, `pnpm build` as Build Command, and `apps/web/dist` as Output Directory. Root `vercel.json` is canonical. If the project currently uses `apps/web` as root, change it to repository root to match this monorepo build.

Set these **Vercel Production** environment variables:

| Vercel variable          | Value                                                       |
| ------------------------ | ----------------------------------------------------------- |
| `VITE_API_URL`           | `https://YOUR-ACTUAL-RAILWAY-DOMAIN`                        |
| `VITE_WS_URL`            | `wss://YOUR-ACTUAL-RAILWAY-DOMAIN`                          |
| `VITE_SUPABASE_URL`      | Existing project URL, if enabling hosted authentication     |
| `VITE_SUPABASE_ANON_KEY` | Existing public anon key, if enabling hosted authentication |

**Redeploy Vercel after saving the variables.** Vite embeds them at build time. Dashboard changes alone cannot repair an already-built frontend. Deploy the new source revision, then hard-refresh.

The SPA rewrite excludes `/api/*`, assets, fonts, and icons. The browser calls Railway directly. `/api/health` on the Vercel domain is not the backend health endpoint and should not return a successful frontend HTML fallback. See [Vercel rewrite documentation](https://vercel.com/docs/routing/rewrites).

## 7. Verify production behavior

1. Open two independent browser profiles. Confirm Amharic text and favicon load, and Network requests use Railway HTTPS/WSS with no localhost address.
2. Use distinct guest names. Complete training and queue Royal Arena duels within five seconds of each other. Confirm both humans share real attacks and authoritative health changes.
3. Open Hall of Legends. It must load records without the old SQLite JSON-path failure. Failed requests expose `X-Request-ID`; quote this when examining backend logs.
4. Clear a campaign mission, reload, and confirm its checkpoint persists. Campaign clears must not alter duel wins or rating.
5. Disconnect one browser briefly and reconnect within 30 seconds. Confirm the same room and warrior return.
6. Restart Railway and verify identities, ratings, achievements, and campaign clears survive. Active matches must be retried after a process restart; the reconnection grace covers network loss while the process stays alive.
7. Invite a second human into a persistent squad, ready both players, and verify Conquest. Test the isolated solo demo, simulated gathering, and cooperative finale separately.
8. When hosted auth is enabled, test four accounts, private upload, all approvals, and deletion. Ordinary authenticated clients must not write result/progression tables directly.

## 8. Backups and rollback

The included backup script uses SQLite's online backup API, including committed WAL data. Locally run `node --import tsx scripts/backup.ts output/backups/knights.sqlite`. In the Railway service container use a destination under `/app/data/backups/`. Download backups to a separate protected location. Enable Railway volume backups as an additional safeguard. Preserve the active session secret in the recovery plan.

For code rollback, redeploy the previous Railway revision and matching Vercel revision while retaining the volume, domain, and secret. Campaign schema changes are additive and can remain. Do not delete or replace your Supabase project. If restoring data is necessary, stop the service, restore a coherent backup, preserve its secret, restart, and verify health/identity/history. A restore removes records newer than its recovery point.

## 9. Optional chain activation and handoff status

Contract deployment and broadcasts still require explicit authorization and a dedicated funded Base Sepolia signer. Follow `packages/contracts/README.md`. Configure backend-only `BASE_SEPOLIA_RPC`, `RECORDS_ADDRESS`, and `ATTESTOR_PRIVATE_KEY`; enable `ALLOW_CHAIN_BROADCAST` only after authorization. Demo records stay simulated. Pending/failed outbox entries retry independently of gameplay. Explorer links require actual transaction hashes. Automatic ERC-1155 inventory minting and thirdweb onboarding remain unavailable.

This repository does not provision Railway or modify hosted projects. Local checks do not establish that the production backend, Supabase migration, genuine gathering, or live chain adapter has been deployed. Record each integration separately as configured, verified, simulated, or unavailable.
