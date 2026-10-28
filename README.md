# Ethiopian Knights: The Battle for the Throne

A playable, server-authoritative Ethiopian-inspired fantasy action game. Train, duel, conquer banners with a four-member squad, demonstrate fellowship, solve the citadel puzzle, and defeat the enchanted King.

The kingdom of Aksumara and its story are fictional. Artwork draws respectfully from Ethiopian textiles, metalwork, architecture and landscapes; the fantasy is not presented as history.

## Start locally

Requirements: Node.js 22.x (22.18 or newer within that major) and pnpm 11.

```sh
pnpm install
pnpm dev
```

On Windows with restricted PowerShell scripts, use `pnpm.cmd` in place of `pnpm`. Open **http://localhost:5173**. The API and Colyseus server use port **2567**. No API keys, Docker, wallet, payment, or external database is required for local play. Profiles, signing secret, results and progression persist in `data/knights.sqlite` using SQLite WAL. Keep this directory to retain progress.

Choose **Play the Story Demo** for the complete accelerated journey. Normal progression requires the tutorial, ten qualifying duel wins, then two squad wins and 1100 squad rating. Every third duel loss removes one qualifying victory; historical wins remain intact and unlocked stages never relock. Guest mode cannot complete genuine four-human gathering verification; use configured Supabase authentication for that flow.

## Controls

| Input       | Action                                                        |
| ----------- | ------------------------------------------------------------- |
| WASD        | Move                                                          |
| Mouse       | Aim                                                           |
| Left mouse  | Strike / assigned role attack                                 |
| Right mouse | Directional block                                             |
| Space       | Dodge                                                         |
| Q           | Role ability                                                  |
| E           | Collect a seal / activate a pillar                            |
| Tab         | Battle contributions                                          |
| Escape      | Release controls / settings overlay; the live match continues |

Warrior selection is cosmetic. Duels and training use equal sword/shield rules. Squad and quest roles are assigned by the server. Matchmaking waits five seconds for humans, then uses labeled AI. To test a human duel, complete training in two independent browser sessions and enter the arena together. For squads, share the six-character invite code; connected members ready up together in the lobby.

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

The tests cover simulation, progression, canonical hashing, transactional result persistence, attestation retries, local Solidity deployment and access control, real two-client combat, reconnection, and the complete demo through server input commands. Playwright tests operate the UI with keyboard/mouse and save screenshots under `output/playwright/`. The load script runs 20 concurrent authenticated clients in separate rooms for 15 seconds and prints measured simulation rates. Tests use isolated in-memory server databases; browser tests create explicitly labeled demo records on the local server.

## Real, simulated, and optional

- **Real locally:** network rooms, authoritative combat, bots, progression, SQLite persistence, squad invites/readiness/chat, banner conquest, puzzle and boss encounters, canonical Keccak-256 result hashes, browser-wallet ownership signatures and off-chain achievements.
- **Explicitly simulated by default:** blockchain anchoring and the demo fellowship approval. Demo records, leaderboards and achievements stay separate from normal records. Reset Demo creates a fresh demo identity.
- **Implemented, requires external configuration:** Supabase email login, server-to-Supabase result synchronization, private gathering photo upload/approval/deletion, and Base Sepolia result submission. These require live-service acceptance testing with your project credentials.
- **Contract tested locally:** authorized match attestation, replay protection and ERC-1155 badge issuance. Gameplay badge inventory is currently off-chain; automatic minting and thirdweb embedded onboarding are not enabled.
- **Prepared, not published:** Vercel/Railway deployment configuration, Supabase migration and Base Sepolia deployment script. No public deployment or testnet transaction was performed during implementation.

Local guest IDs are not blockchain identities. The browser-wallet link proves possession through a single-use signed challenge. A result hash proves payload integrity; a simulated submission is not an on-chain proof. Explorer links are shown only for real wallet addresses or actual transactions.

## Configuration and deployment

See [`.env.example`](.env.example). The server reads root `.env`; Vite reads `apps/web/.env` or platform-provided build variables. Never place service-role keys or attestor keys in `VITE_*` variables. See [deployment instructions](docs/DEPLOYMENT.md) for Vercel, Railway, Supabase and Base Sepolia. No Neon or Cloudflare service is required.

The server uses SQLite as the runtime authority and durable queue, including when Supabase mirroring is enabled. Use one backend instance and persistent storage. Do not deploy the Colyseus backend as a stateless frontend function.

## Project map

- `apps/web`: React overlays, Zustand state, Phaser battlefield, generated artwork.
- `apps/server`: Colyseus rooms, guest/hosted identity, SQLite transactions, hosted storage, attestation adapters.
- `packages/shared`: validated input types, simulation, AI and progression rules.
- `packages/contracts`: Solidity attestation and achievement contract.
- `supabase/migrations`: PostgreSQL tables, RLS, private storage and transactional result RPC.
- `tests`: unit, real-network, contract and browser acceptance tests.

Read [architecture](docs/ARCHITECTURE.md), [demo walkthrough and three-minute presentation](docs/DEMO.md), [art pipeline](docs/ART.md), and [known limitations](docs/LIMITATIONS.md).

See [actual validation results](docs/VALIDATION.md) for the executed tests, browser journey and final 20-client measurement.

The Royal Lunch Pass is a prototype collectible. It is **not redeemable at Burger King**, contains no fabricated coupon code, and implies no commercial partnership. Genuine gathering approval is social account attestation; it does not use facial recognition or prove physical location.
