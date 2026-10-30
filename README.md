# ክብረ ጉግስ — Kibre Gugs

A playable, server-authoritative Ethiopian-inspired fantasy action game with an illustrated isometric battlefield, articulated warriors and mounts, fifteen mission mechanics, persistent checkpoints, a separate story demo, rated duels and four-banner squad combat.

The kingdom of Aksumara and its story are fictional. Artwork draws respectfully from Ethiopian textiles, metalwork, architecture and landscapes; the fantasy is not presented as history.

## Start locally

For Sam's separate feature commits, current-main integration work, and remaining hackathon gaps, read the [review handoff](docs/SAM-REVIEW-HANDOFF.md). This feature branch integrates `main` through `addddb5`, retaining its database, hosting, avatar and age-review changes alongside Sam's additions.

Requirements: Node.js 22.x (22.18 or newer within that major) and pnpm 11.

```sh
pnpm install
npm run dev
```

Keep that terminal open while playing. The command starts both the browser app on port 5173 and the game server on port 2567. Closing the terminal or pressing Ctrl+C stops them; a page already loaded in your browser can remain visible even though its server has stopped. Run `npm run dev` again to restart both. This is local development, not a permanently hosted game.

On Windows with restricted PowerShell scripts, use `pnpm.cmd` in place of `pnpm`. Open **http://localhost:5173**. The API and Colyseus server use port **2567**. No API keys, Docker, wallet, payment, or external database is required for local play. Profiles, signing secret, results and progression persist in `data/knights.sqlite` using SQLite WAL. Keep this directory to retain progress.

Choose **Play the Story Demo** for the condensed seven-mission journey. Normal campaign progression is mission-based, with a 45–60 minute first-play target; the demo targets 8–12 minutes. These targets still need human playtesting. Competitive qualification remains separate: ten qualifying duel wins, then two squad wins and 1100 squad rating. Every third duel loss removes one qualifying victory; historical wins and legacy unlocks remain. Genuine Royal Gathering requires four authenticated Supabase accounts; demo fellowship is explicitly simulated. See [campaign mechanics](docs/CAMPAIGN.md).

## Controls

| Input         | Action                                                        |
| ------------- | ------------------------------------------------------------- |
| WASD / arrows | Screen-relative movement                                      |
| Mouse         | Aim                                                           |
| Left mouse    | Strike / assigned role attack                                 |
| Right mouse   | Directional block                                             |
| Space         | Dodge                                                         |
| Q             | Role ability                                                  |
| E             | Interact / hold to rescue or revive                           |
| Wheel / + / − | Zoom                                                          |
| F             | Fullscreen                                                    |
| Tab           | Battle contributions                                          |
| Escape        | Release controls / settings overlay; the live match continues |

Warrior selection is cosmetic. Duels and training use equal sword/shield rules. Squad and quest roles are assigned by the server. Matchmaking waits five seconds for humans, then uses labeled AI. For human play, use two authenticated, manually reviewed adult accounts in the same age band, complete training, then enter the arena together. Unverified guests play solo with bots. For squads, share the six-character invite code; connected members ready up together in the lobby.

## Commands

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:load          # requires the local server to be running
pnpm exec tsx scripts/contracts.ts
```

Tests cover API failures, legacy SQLite records, projection, mounted steering/wind, mission gates/puzzles/rescues, transactional rewards, canonical hashing, contracts, two-client combat and reconnection. Playwright uses real keyboard/mouse input and a dedicated in-memory backend on 2570 with a test frontend on 5174. Prior-mission fixtures support individual normal-mechanic tests; the complete demo advances without injected victories. Screenshots go to `output/playwright/`. The load script exercises nineteen input clients plus one rendered browser, with combat, monsters and projectiles over thirty seconds, writing tick and FPS measurements to `output/load-expanded.json`. It needs both local dev servers and installed Chromium.

## Real, simulated, and optional

- **Real locally:** network rooms, authoritative combat, bots, progression, SQLite persistence, squad invites/readiness/chat, banner conquest, puzzle and boss encounters, canonical Keccak-256 result hashes, browser-wallet ownership signatures and off-chain achievements.
- **Explicitly simulated by default:** blockchain anchoring and the demo fellowship approval. Demo records, leaderboards and achievements stay separate from normal records. Reset Demo creates a fresh demo identity.
- **Implemented, requires external configuration:** Supabase email login, Supabase-authoritative persistence, reviewed-age matchmaking, editable avatars, private gathering photo upload/approval/deletion, and Base Sepolia result submission. These require live-service acceptance testing with your project credentials.
- **Contract tested locally:** authorized match attestation, replay protection and ERC-1155 badge issuance. Gameplay badge inventory is currently off-chain; automatic minting and thirdweb embedded onboarding are not enabled.
- **Prepared, not published:** Vercel/Render deployment configuration, Supabase migration and Base Sepolia deployment script. No public deployment or testnet transaction was performed during implementation.

Local guest IDs are not blockchain identities. The browser-wallet link proves possession through a single-use signed challenge. A result hash proves payload integrity; a simulated submission is not an on-chain proof. Explorer links are shown only for real wallet addresses or actual transactions.

Wallet linking uses a five-minute SIWE challenge scoped to the website, network, address and authenticated player. The profile displays a wallet account ID (`eip155:84532:<address>`) and explicitly labels the link off-chain. Existing links cannot be silently replaced. Read [Lesson 1: wallet identity](docs/LESSON-01-WALLET-IDENTITY.md) for the implementation walkthrough and focused tests. Set `WALLET_ORIGIN` to the public frontend origin when deploying.

New version 3 results snapshot participant names and wallet/profile/AI identities at finish. In **Your legacy → Battle chronicles**, expand a match and choose **Verify result** to recompute its hash in the browser. For real records, the verifier independently reads the configured Base Sepolia contract and checks both the result hash and winners; simulated results are explicitly labeled. Versions 1 and 2 retain their historical proof format. Read [Lesson 2: match proofs](docs/LESSON-02-MATCH-PROOFS.md).

**Team room** in the sidebar opens private Socket.IO text chat without requiring training or a wallet. Share the six-character team code with another player. Chat persists across menus, matches and reconnects, with the latest 100 saved messages restored. Colyseus continues to run gameplay and battle readiness; both protocols share the backend port. **Battle arena** explicitly separates training, 1v1 and 4v4, and the match banner identifies its room, matchmaking state and human/AI control. Read the [beginner walkthrough and missing-feature list](docs/PROJECT-WALKTHROUGH.md).

## Configuration and deployment

See [`.env.example`](.env.example). The server reads root `.env`; Vite reads `apps/web/.env` or platform-provided build variables. Never place service-role keys or attestor keys in `VITE_*` variables. See [deployment instructions](docs/DEPLOYMENT.md) for Vercel, free Render, free Supabase and Base Sepolia. No Neon or Cloudflare service is required.

Local development uses SQLite. Production uses asynchronous Supabase Postgres transactions through its private pooler; free Render hosts one persistent Node process without depending on durable local files. Do not deploy the Colyseus backend as a stateless frontend function.

## Project map

- `apps/web`: React overlays, Zustand state, Phaser battlefield, generated artwork.
- `apps/server`: Colyseus rooms, guest/hosted identity, SQLite/Supabase transactions, private age review, hosted storage, attestation adapters.
- `packages/shared`: validated input types, simulation, AI and progression rules.
- `packages/contracts`: Solidity attestation and achievement contract.
- `supabase/migrations`: PostgreSQL tables, RLS, private storage and transactional result RPC.
- `tests`: unit, real-network, contract and browser acceptance tests.

Read [architecture](docs/ARCHITECTURE.md), [demo walkthrough and three-minute presentation](docs/DEMO.md), [art pipeline](docs/ART.md), and [known limitations](docs/LIMITATIONS.md).

See [actual validation results](docs/VALIDATION.md) for the executed tests, browser journey and final 20-client measurement.

The Royal Lunch Perk is a **prototype offer**: when a four-warrior squad meets for lunch and submits a consented group selfie, the perk promises 40% of the lunch covered (Chanoly noodles for now) and unlocks the Royal Feast armor for every member. Terms apply; the game does not issue coupon codes or process payments, and players who decline simply keep playing. Genuine gathering approval is social account attestation; it does not use facial recognition or prove physical location.
