# Deploy ክብረ ጉግስ: free Render + free Supabase

Team chat uses Socket.IO on the same backend origin and port as Colyseus. Route `/socket.io/` polling and WebSocket upgrades to that backend. Apply migrations `005_team_chat.sql` and `006_social.sql` after the existing migrations. Notifications (`/notify`) and spectators (`/spectate`) use the same Socket.IO server. Set `WALLET_ORIGIN` to the actual frontend origin (including a same-origin Render frontend), and include separate frontend origins in `CORS_ORIGINS`. No separate chat service/key is required. Verify gameplay and chat with two devices and a reconnect after deployment.

One Render web service builds the web app and serves it together with the API and Colyseus WebSocket from the same origin. Supabase Postgres holds authoritative records, auth and private storage. SQLite is for local development. No Vercel, Railway, Neon or persistent disk is required.

**Quick path for a new deployment:**

1. Supabase SQL editor: apply the migrations (section 2).
2. Render: New → Blueprint (or Web Service → Docker) from this repository and set the variables in section 4. Because the web app is same-origin, leave VITE_API_URL, VITE_WS_URL and CORS_ORIGINS unset.
3. Open https://YOUR-SERVICE.onrender.com/api/health and check that it shows persistence "supabase" (section 5).
4. Supabase Authentication → URL Configuration: set the Site URL and a redirect to https://YOUR-SERVICE.onrender.com/ (section 6).
5. Play at https://YOUR-SERVICE.onrender.com/.

Sections 7 (Vercel) and CORS_ORIGINS only apply if you choose to host the frontend separately.

## 1. Back up and validate

Use Node 22 and pnpm 11.5.1. On Windows use pnpm.cmd if needed.

    pnpm install --frozen-lockfile
    pnpm typecheck
    pnpm test
    pnpm build
    node --import tsx scripts/backup.ts output/backups/before-render.sqlite

Preserve the old revision, database and active SESSION*SECRET privately. Without an environment override, the old generated secret is the session row in SQLite's secrets table. Transfer that value privately to Render; changing it invalidates existing guest sessions. Browser storage also holds guest tokens. Never put signing secrets, database passwords or privileged keys in VITE*\* variables.

Self-hosted vision runtime/model/OCR files and licenses are included under apps/web/public/vision. The optional node scripts/prepare-vision.mjs command refreshes runtime files from installed dependencies; it does not replace models. Commit these assets, the artwork and lockfile with the source.

## 2. Apply only pending Supabase migrations

In the existing project's SQL editor apply 002_campaign.sql if still pending, then 003_runtime.sql, 004_evidence_cleanup.sql, 005_team_chat.sql and 006_social.sql (friends, notifications and tournaments). With the GitHub integration, record already-applied versions in supabase_migrations.schema_migrations first so they are not rerun. For CLI-managed installations inspect supabase migration list first. Do not rerun 001, delete the project or use supabase db reset on production.

003 adds a private game_runtime schema and copies existing hosted records without overwriting runtime rows. Existing public tables remain as legacy records; all new game writes/reads use game_runtime. Do not expose this schema in the Data API. Canonical game IDs remain distinct from linked Supabase auth IDs. Distinct accounts are not automatically merged.

Keep gatherings and age-evidence storage buckets private. Do not add public read or client-upload policies for evidence.

## 3. Import existing SQLite records when applicable

Stop gameplay during migration. In your local process environment supply SUPABASE_DB_URL and the preserved SESSION_SECRET privately. Copy the **transaction pooler** PostgreSQL connection from Supabase Dashboard → Connect, usually port 6543. Use the database password, URL-encoded; this is different from an API key. Prepared statements are disabled and the server pool is limited to four connections.

    node --import tsx scripts/import-sqlite.ts --source=output/backups/before-render.sqlite
    node --import tsx scripts/import-sqlite.ts --source=output/backups/before-render.sqlite --apply

The first command is a dry run. Without a target URL it checks only source integrity/counts; with the URL it also detects target duplicates/conflicts. Apply uses one database transaction and creates a pre-import backup. Conflicts cause rollback; reconcile them deliberately rather than overwriting newer records. Identical repeated imports skip duplicates. Do not import a database still receiving writes.

If the old backend used an environment override instead of its generated SQLite secret, preserve that actual override and pass --external-secret. The tool does not print secrets.

## 4. Create a free Render Web Service

Push the reviewed source and assets to your repository. In Render choose New → Web Service, connect the repository, choose Docker, repository root, and the Free instance. Alternatively use render.yaml as a Blueprint. Use one instance and health path /api/health; no volume is needed.

| Render variable                                  | Value                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| PERSISTENCE                                      | supabase                                                                      |
| SUPABASE_DB_URL                                  | Private transaction-pooler PostgreSQL URL including encoded database password |
| SUPABASE_DB_CA                                   | Supabase database CA certificate (PEM), see below                             |
| SESSION_SECRET                                   | Preserved active signing secret; strong random secret for a new installation  |
| SUPABASE_URL                                     | Existing project URL                                                          |
| SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY | Backend-only privileged Supabase key                                          |
| VITE_SUPABASE_URL                                | Existing project URL (public; baked into the web build)                       |
| VITE_SUPABASE_PUBLISHABLE_KEY                    | Frontend-safe publishable/anon key, never the service key                     |
| CORS_ORIGINS                                     | Unset for the single service; only for a separate frontend origin             |
| WALLET_ORIGIN                                    | Exact frontend origin used in ownership signatures                            |
| ENABLE_DEMO                                      | true                                                                          |
| ALLOW_CHAIN_BROADCAST                            | false until separately authorized                                             |
| AGE_REVIEWER_IDS                                 | Leave unset until cleanup and reviewer setup are verified                     |

The server connects to Postgres with full TLS certificate verification. Supabase signs its database and pooler certificates with its own root CA, which Node does not trust by default, so without SUPABASE_DB_CA startup fails with `SELF_SIGNED_CERT_IN_CHAIN` and the health check never passes. Download the certificate from Supabase Dashboard → Project Settings → Database → SSL Configuration and paste the whole PEM, including the BEGIN/END lines, as the value. Escaped `\n` newlines are accepted. The same variable is used by scripts/import-sqlite.ts.

The Docker build runs `pnpm build` and Render passes the service's environment variables to it as build arguments, so VITE*SUPABASE*\* changes require a redeploy (Manual Deploy → Deploy latest commit). If you do host a separate frontend, set CORS_ORIGINS to its exact https origins with no path or trailing slash; production startup refuses anything else.

Render supplies PORT. Copy the service's actual domain. If it is kibre-gugs-server-EXAMPLE.onrender.com, the API origin is https://kibre-gugs-server-EXAMPLE.onrender.com and WebSocket origin is wss://kibre-gugs-server-EXAMPLE.onrender.com. Replace the example domain. Append no /api or /matchmake to these environment values.

Free Render sleeps after 15 idle minutes, takes about a minute to wake, and may restart. The frontend shows a bounded wake-up screen before account/match requests. Active rooms are in memory; interrupted missions restart from their last saved clear. Confirmed results, squads and progression persist in Supabase. No artificial keepalive is included. See [free limits](https://render.com/docs/free) and [WebSockets](https://render.com/docs/websocket).

## 5. Verify backend health first

Open https://YOUR-ACTUAL-RENDER-DOMAIN/api/health. Require successful JSON containing ok: true, persistence: "supabase", protocol: 2 and tickRate: 30. Blockchain is simulated by default. Repair missing migrations, pooler credentials or startup configuration using Render logs before proceeding.

HTML, an empty body or a provider error page is not game API success. Cold startup takes longer than normal requests. Request IDs help diagnose backend errors.

## 6. Configure existing Supabase authentication

Under Authentication → URL Configuration:

| Setting                       | Value                                                   |
| ----------------------------- | ------------------------------------------------------- |
| Site URL                      | https://ethiopian-history-based-game-for-ha.vercel.app/ |
| Production redirect           | https://ethiopian-history-based-game-for-ha.vercel.app/ |
| Optional development redirect | http://localhost:5173/                                  |

Keep email authentication enabled. Add only intentional preview redirects. A guest remains a guest; selecting an authenticated account does not silently merge a different guest's progress.

Main link is the render one, vercel is deprecated.

## 7. Optional: host the frontend on Vercel instead

Skip this section for the single Render service.

Use repository root (leave Root Directory empty), and let the root vercel.json supply the install command, build command pnpm build and output directory apps/web/dist. There is no apps/web/vercel.json; the web package has no dependencies of its own.

| Vercel Production variable                              | Value                             |
| ------------------------------------------------------- | --------------------------------- |
| ENABLE_EXPERIMENTAL_COREPACK                            | 1 (uses the pinned pnpm 11.5.1)   |
| VITE_API_URL                                            | https://YOUR-ACTUAL-RENDER-DOMAIN |
| VITE_WS_URL                                             | wss://YOUR-ACTUAL-RENDER-DOMAIN   |
| VITE_SUPABASE_URL                                       | Existing project URL              |
| VITE_SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_ANON_KEY | Frontend-safe public key          |

**Redeploy Vercel after saving these values.** Vite embeds them at build time. Vercel variables do not configure Render. All server secrets belong on Render/Supabase, never in VITE\_\* variables.

The SPA fallback excludes /api/\*. Browsers call Render directly: /api/health on the Vercel domain is not the backend endpoint. CORS uses the exact frontend origin without a path or trailing slash; add preview origins explicitly.

## 8. Enable scheduled evidence deletion before accepting IDs

Create a private random AGE_CLEANUP_SECRET and set it in Supabase Edge Function secrets. Deploy:

    supabase functions deploy age-cleanup --no-verify-jwt

supabase/config.toml also sets `verify_jwt = false` for this function, so a redeploy without the flag does not start rejecting the scheduler with 401. The function checks its private X-Cleanup-Secret instead of a user JWT; public keys do not authorize cleanup. In the SQL editor run supabase/age-cleanup-schedule.sql after privately replacing its project URL and secret placeholders. It stores the secret in Vault and installs an hourly Cron job. Update named Vault entries rather than duplicating them on upgrades. See [Supabase scheduling](https://supabase.com/docs/guides/functions/schedule-functions).

Verify with a **synthetic image**, not a real ID: upload it privately, create an expired synthetic review row, invoke cleanup, and confirm object deletion plus the row's cleared path. Calls without the cleanup secret must return 403. Check Cron history and Edge logs. Pending submissions become inaccessible after 24 hours; physical deletion occurs on the next successful hourly run. Failed deletions retain their path for retry.

## 9. Configure reviewers and age matching

Sign in to the game using the designated reviewer's Supabase email account. Find its UUID under Authentication → Users. Set comma-separated reviewer UUIDs in Render's AGE_REVIEWER_IDS and redeploy only after cleanup works.

While signed in, visit https://ethiopian-history-based-game-for-ha.vercel.app/?review=1. Choose Set up / unlock reviewer MFA, scan the QR code with an authenticator, and enter a current code. Every reviewer API call requires both the server allowlist and a validated MFA session.

Players consent, select a Fayda image and confirm its complete birth date/calendar. OCR only suggests a date. Reviewers inspect the image and date before approval, rejection or resubmission. Unclear/incomplete dates require resubmission. This is manual age review, not government document authentication, liveness or proof that the ID belongs to the submitter.

All human duels, squads and private invitations require reviewed adults in the same band: 18–24, 25–34, 35–44 or 45+. Birthdays use Addis Ababa dates. Solo, bots and demo require no ID. Sparse pools use bots, never silently wider age bands.

Evidence is deleted after a decision/withdrawal. Approved birth dates remain private for band calculation; withdrawal removes them and future human eligibility. Do not include evidence or birth dates in analytics, public results, chain records, screenshots or support logs.

## 10. Verify with two browsers

1. Check HTTPS JSON health and a successful WSS connection to Render in DevTools.
2. Create a guest, save an avatar and play solo. Camera tracks must stop after capture/close.
3. Check articulated movement, flame swings, ambient music, mute and separate volume controls.
4. Open Hall of Legends and finish a mission. Wait for RESULT SAVED before continuing.
5. Restart Render; verify identity, history, avatar and cleared mission survive.
6. With two genuinely reviewed authenticated test accounts in the same band, share an invite and fight in one room. Verify cross-band and unverified joins are denied.
7. Drop a browser connection and reconnect within 30 seconds while the server remains running. A server restart requires a new room.
8. Test withdrawal, expiry, reviewer denial and actual deletion using synthetic evidence.
9. Complete the solo demo. Genuine Gathering still requires four authenticated eligible humans and separate approvals. Demo gathering remains visibly simulated.

## 11. Backups, monitoring and rollback

Free Supabase has quotas and inactivity pausing; paid automatic backups are not included. Arrange private database exports, monitor usage and test restoration. Exclude temporary evidence objects from backups. See [Supabase plan details](https://supabase.com/pricing).

Retain the SQLite snapshot, active signing secret and a verified Supabase export. Monitor Render health/restarts, result-save retries, database usage and cleanup history. Free tiers provide no 24/7 availability guarantee.

Rollback to a tested revision supporting the new persistence adapter while keeping additive schemas and secrets. An old SQLite-only backend on free Render is not a safe rollback. Do not restore stale data over newer results; restore into an isolated project first, compare counts/hashes and schedule a deliberate cutover.

Public verification requires the deployed Render URL and owner configuration. Base Sepolia remains simulated unless separately configured/authorized; this upgrade broadcasts no public transaction.
