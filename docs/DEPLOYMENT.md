# Deployment checklist

## Local

Use Node 22.18+ and pnpm 11. `pnpm install`, then `pnpm dev`. On Windows with script execution restrictions, use `pnpm.cmd`. The web client runs at http://localhost:5173 and the persistent Colyseus/HTTP server at http://localhost:2567. The frontend development proxy forwards `/api`. Copy `.env.example` to `.env` only when overriding defaults. The server reads root `.env`; Vite reads `apps/web/.env`, or environment variables supplied by the hosting platform.

## Frontend / Vercel

Deploy from the repository root. Build command: `pnpm build`. Output directory: `apps/web/dist`. Configure `VITE_API_URL=https://<railway-domain>` and `VITE_WS_URL=wss://<railway-domain>`. Optional public Supabase variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Rebuild after changes. Use the root `vercel.json`; the app-level copy is informational for alternate monorepo configuration. Test the published site from a different device; no production URL should contain localhost.

## Backend / Railway

Use the root Dockerfile and railway.json. Mount a persistent volume at `/app/data`, set `DB_PATH=/app/data/knights.sqlite`, `SESSION_SECRET` to a strong random value, `CORS_ORIGINS` to the exact frontend HTTPS origin, and `ENABLE_DEMO=true` for judging. Railway supplies PORT. Health endpoint: `/api/health`. Use one instance for this prototype. Confirm WebSocket connections use WSS. Back up SQLite and the session secret together; changing the secret invalidates sessions.

## Supabase

Create a project and apply `supabase/migrations/001_royal_trials.sql` through the SQL editor or CLI migration workflow. Enable email authentication and add the deployed frontend to the allowed redirect URLs; configure Google OAuth only if desired. The migration creates the private `gatherings` bucket, restricted image types, RLS and server-only writes. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only on the backend; set the public URL and anon key on the frontend. Confirm four distinct authenticated accounts can form a squad, complete qualification, upload a consented photo and approve the same session. Verify an unprivileged browser cannot write results or progression directly.

## Base Sepolia

Follow packages/contracts/README.md. Run contract tests before deployment. Use a funded dedicated testnet signer. Explicitly authorize the deployment command and live broadcasts. Configure RPC, deployed contract and attestor key on the backend. Never commit keys. Watch the outbox status; pending and failed results remain visible independently of gameplay. Keep demo submissions simulated. Expose explorer URLs only for actual transaction hashes. Badges remain off-chain until the minting workflow is extended.

## Final checks

Run typecheck, unit/integration/contract tests, browser tests and the 20-client load test. Test two separate browser sessions on the deployed server; restart the backend and confirm result persistence. Verify private image deletion. Review the limitations document before judging. This repository prepares deployment; it does not provision accounts or publish without configured service access.
