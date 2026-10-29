# Sam's Web3 assessment and two-day learning plan

Assessment date: 28 October 2026. Branch: `Sam-dev`. Baseline commit: `f63f0d7`.
The tables below describe the initial assessment. Implementation progress is recorded at the end of this document.

Handoff update, 29 October 2026: the feature work is being split into six review commits on `Sam-dev`. Newly fetched `origin/main` is `addddb5`; its asynchronous database/deployment changes are not integrated into this feature snapshot. See [review handoff](SAM-REVIEW-HANDOFF.md) for current integration tasks, validation limitations and confirmed missing features; earlier assessments and test counts below are historical.

Update, 29 October 2026: `Sam-dev` now includes `origin/main` commit `5645fcc` ("2.5D animation"). That update adds a fifteen-mission campaign, including riding and a six-pass mounted spear challenge, alongside new artwork and rendering. The initial gameplay-gap table below is historical; consult `docs/CAMPAIGN.md` for the updated game scope. The wallet work was preserved, with `/api/me` reconciled to return both campaign progress and wallet identity.

## What is feasible

A focused hackathon prototype is feasible in two days because this repository already contains wallet linking, authoritative results, hashes, a submission queue, and a Solidity contract. Learning enough to explain and extend that flow is realistic. Building the entire twenty-level Kibre Gugs design, all arena features, and production blockchain security in that time is not.

Target demonstration: two players identify themselves, play one match, chat, see the same winner, inspect a result proof, and see an achievement. Use Base Sepolia for a real testnet proof if setup succeeds. The brief explicitly allows simulated match recording, so retain a clearly labeled fallback.

## Existing implementation versus the brief

| Requirement                   | What the source contains                                                              | Remaining work                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Live matchmaking and gameplay | Colyseus rooms, server simulation, snapshots, reconnection, bots after five seconds   | Demonstrate two humans, distinguish bots, test deployed connections                                                             |
| Room chat                     | Squad lobby chat and ready flags; battle chat accepted only during first five seconds | Persistent chat UI during gameplay, input focus handling, room isolation tests                                                  |
| Invitations                   | Six-character squad invite code                                                       | Optional friend list, direct invitations and notifications                                                                      |
| Player identity               | Signed local guest sessions; optional Supabase login; wallet ownership challenge      | Define the blockchain profile identity; wallet linking currently does not register a player on-chain or restore a guest session |
| Match verification            | Canonical JSON plus Keccak-256; server-only result creation; durable outbox           | User-facing independent verification, testnet acceptance, clearer status handling                                               |
| On-chain records              | Solidity contract and Base Sepolia adapter                                            | Actual deployment and end-to-end transaction evidence                                                                           |
| Leaderboard                   | SQLite rating query, separate demo records                                            | Link ranked results to proofs; it is not an on-chain ranking system                                                             |
| Rewards                       | Points and off-chain achievement inventory; contract supports ERC-1155 minting        | Wire one earned badge to verified wallet minting, retries, metadata and balance display                                         |
| Spectator mode                | No dedicated spectator path found                                                     | Read-only observer access, no fighter slot and no gameplay inputs                                                               |
| Replay history                | Stored significant events and result timeline                                         | Full playback is absent; do not present the timeline as full replay                                                             |
| Tournaments                   | Progression and squad competitions                                                    | No general tournament bracket/reward workflow found                                                                             |

The supplied concept differs materially from this code. Current duels use sword/shield, with health/damage combat. Horse physics, six mounted passes, the 1,000-point scoring formula, equipment tiers, twenty levels, and the ceremonial Menelik trial are not implemented. Current progression also removes a qualifying victory after every third normal duel loss, whereas the concept preserves completed levels. Coordinate these changes with the gameplay developer.

## Why keep this stack for the prototype

The organizers permit alternatives, per Sam's clarification. The recommendation is to preserve working infrastructure and explain the tradeoffs.

| Brief suggests      | Current choice                       | Reason to keep it now                                                                                                    | Tradeoff                                                                                       |
| ------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Next.js App Router  | React + Vite + Phaser                | The canvas game and menus already run as a browser client; server rendering is not needed for the demonstrated game loop | App Router conventions and server-rendered pages are absent                                    |
| Node.js / Socket.IO | Node.js + Express + Colyseus         | Existing game rooms implement matchmaking, authenticated players, snapshots and reconnection                             | Colyseus is not Socket.IO; changing libraries means migrating both client and server protocols |
| MongoDB / Redis     | SQLite WAL, optional Supabase mirror | Transactions keep result, progression, badges and outbox consistent; local setup needs no database service               | One persistent backend instance; multi-server matchmaking and shared state need further design |
| Web3 API            | viem + blockchain RPC + Solidity     | The JavaScript library already reads and writes the target contract                                                      | RPC availability, signer management and transaction recovery still need acceptance testing     |

Suggested judging explanation: “We used React/Phaser for the browser game, Colyseus for real-time game rooms, and transactional SQLite for a single-instance prototype. This let us preserve authoritative gameplay and spend our deadline on verifiable results. Solidity and viem provide the Web3 layer. Scaling beyond one backend would require shared matchmaking/state infrastructure.”

## First lesson: understand one result

1. A browser sends commands such as move, attack and block. It cannot legitimately submit its own win.
2. `apps/server/src/room.ts` runs the authoritative match and decides when it ends.
3. `recordResult()` in `apps/server/src/store.ts` assembles the participants, winner, scores and times. One database transaction saves the result, updates progression, awards off-chain badges and creates an outbox entry.
4. `canonical()` makes JSON object key ordering consistent. `digest()` computes Keccak-256 over that representation.
5. `apps/server/src/attestation.ts` reads eligible outbox entries. The worker runs separately from gameplay and submits through viem when live broadcasting is configured.
6. `RoyalRecords.sol` permits an authorized attestor to record each match digest once. The contract stores a result hash, winner digest, block timestamp and attestor address.
7. The UI can read the record and compare it with a newly computed hash of the saved result. A matching hash supports integrity of that exact payload relative to the chain record.

Example from Kibre Gugs: if the payload says A scored 570 and B scored 490, changing A's score to 580 changes the hash. The verifier should report a mismatch. But a dishonest trusted server could submit a dishonest result initially: blockchain does not itself observe spear hits.

The current winner digest hashes a sorted JSON array of winning participant IDs, including bots when present. It is not a readable winner name or wallet address. The contract timestamp is the time of the recording block; the gameplay end time is inside the hashed payload. Keep these distinctions explicit when building the verification UI.

## Terms tied to this project

| Term                 | Meaning here                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Blockchain           | A network-maintained ledger where the contract records results                                                         |
| Wallet / address     | The wallet manages signing; its public address identifies an account                                                   |
| Private key          | Secret authority to sign for an account; never send it to the frontend or commit it                                    |
| Signature            | Evidence that an account authorized a particular message; the existing wallet-link message does not spend funds        |
| Nonce                | A fresh challenge value; expiration and single-use consumption prevent reusing an old proof                            |
| Hash                 | A fingerprint of bytes; it is neither encryption nor proof that the original claim was true                            |
| Smart contract       | Code deployed on-chain; this one checks the attestor's role and rejects repeated match IDs                             |
| RPC / Web3 API       | The interface used to query a blockchain node or submit a transaction; viem is the client library here                 |
| Transaction / gas    | A signed request to change chain state and its execution fee; a plain ownership-message signature is not a transaction |
| Testnet              | A network for testing; the current adapter targets Base Sepolia                                                        |
| Attestor             | The trusted server account allowed to submit match records                                                             |
| Outbox / idempotency | A durable list of work to retry; repeating processing should not create a second result or reward                      |
| ERC-1155             | A token standard supporting multiple badge types within one contract; the current contract allows transfers            |

Wallet ownership proves control of an account, not someone's real-world identity or that they control only one account.

## Recommended implementation order

### Day 1: understand the boundary, identity and proof

- **Hours 1–2:** Run the game and inspect one saved result together. Learn browser versus server, HTTP versus persistent socket messages, and database versus blockchain. Explain which component may declare a winner.
- **Hours 3–4:** Trace `/api/wallet/nonce` → wallet signature → `/api/wallet/bind`. Improve binding conflicts and atomic nonce consumption. Define a stable wallet-based display ID. For an explicitly on-chain profile, add a small registration mapping/event binding a profile digest to a wallet; require the wallet's authorization. Reuse the verified link flow rather than inventing another onboarding system.
- **Hours 5–6:** Trace canonical JSON and hashing. Implement or demonstrate a verifier that detects a changed score. Agree with the gameplay developer on one versioned result schema including participants, wallet identities or identity references, winner, scores and times.
- **Hours 7–8:** Exercise the contract locally, then configure a dedicated testnet signer and deploy to Base Sepolia if available. Complete a normal match and verify its record and transaction. Demo-mode records deliberately remain simulated.

### Day 2: rewards, communication and presentation

- **Hours 1–2:** Connect one earned badge to ERC-1155 `award()`, with a durable mint queue and a stable badge-name-to-token-ID map. Require a verified recipient, check duplicate awards, and display the actual on-chain balance. Keep ordinary game points in the database.
- **Hours 3–4:** Keep match chat available during play. Pause gameplay keyboard handling while typing. Test membership checks, blank/oversized messages, spam limits and isolation between rooms. Add a small notification for a confirmed proof or earned badge.
- **Hours 5–6:** Test two separate browser sessions, a reconnect, backend restart, invalid signatures, repeated claims and RPC failure/recovery. Show pending, confirmed, failed and simulated states accurately.
- **Hours 7–8:** Rehearse the demonstration and record evidence. Keep this block as integration buffer. If earlier work overruns, use the permitted simulation fallback; cut optional friends, spectators and replay playback before compromising the main flow.

These are work budgets, not guarantees. Profile registration, real testnet setup and badge automation are the riskiest parts for a beginner. Finish one verified result before expanding scope.

## Improvements found during source review

- **Fixed in milestone 1:** Wallet binding used `INSERT OR REPLACE` on a table with a unique address, allowing a new profile to remove an older link. Binding now rejects conflicts and consumes the exact, unexpired challenge atomically after verification, preventing concurrent reuse.
- **Fixed in milestone 1:** Wallet challenges now use the SIWE message format with website, chain, address, player and expiration context.
- `/api/health` always reports simulated blockchain and local-guest identity, even when integrations are configured. Derive these fields from actual configuration/readiness.
- The history UI calls any stored transaction a “confirmed transaction,” even though a transaction hash is saved before a receipt is obtained. Make link labels depend on status.
- The outbox stops after five attempts, without a manual retry workflow or backoff. Existing-record recovery compares the result hash but not the winner digest, and may lack a transaction link. Improve recovery and verification before calling the path robust.
- Simulated records are not automatically requeued when live mode is enabled. Use a fresh normal match for testnet acceptance. Keep demo history clearly separate.
- Identity linking is stored separately from the immutable match payload, whose participants currently contain local IDs. Capture or reference the intended wallet identity at match completion if winners must be verifiable against blockchain profiles later.
- A displayed hash alone is not an independent verifier. Fetch the saved payload, recompute its hash, and compare contract fields on the intended network and contract address.

These are source-review findings, not claims of a complete security audit.

## Work boundary with the gameplay developer

Sam owns wallet identity, result proof/verification, contract integration, reward delivery and chat. The teammate owns movement, horses, combat, scoring, arenas and progression. The shared boundary is a versioned server-produced result and stable player IDs. Keep blockchain calls out of `packages/shared/src/game.ts` and out of the simulation tick. Coordinate edits to `apps/web/src/main.tsx`, `apps/server/src/index.ts` and `store.ts`, which both work streams may touch.

## Reading order and sources

Read local files in this order: `apps/server/src/index.ts` (wallet endpoints), `apps/server/src/store.ts` (canonical/digest/recordResult), `apps/server/src/attestation.ts`, `packages/contracts/contracts/RoyalRecords.sol`, then `tests/contracts.test.ts` and `tests/network.test.ts`.

- [Ethereum accounts and wallets](https://ethereum.org/developers/docs/accounts/): account control, signing and wallet concepts.
- [Ethereum oracles](https://ethereum.org/developers/docs/oracles/): why external facts need an external source of trust.
- [Official Base network details](https://docs.base.org/get-started/connect-to-base): Base Sepolia chain ID 84532, RPC `https://sepolia.base.org`, explorer `https://sepolia.basescan.org`.

## Local run and verification

Node 22.23.1 is installed. The repository requests pnpm 11.5.1; no global pnpm executable was initially present. Use `npx --yes pnpm@11.5.1 install --frozen-lockfile` to install the locked dependencies. After installation, `npx --yes pnpm@11.5.1 dev` starts both services. Open http://localhost:5173; API health is http://localhost:2567/api/health. No wallet, external database or `.env` is required for local simulated mode.

Executed during this assessment on Linux with Node 22.23.1:

| Check                                        | Result                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| Frozen-lockfile dependency installation      | Passed with pnpm 11.5.1; no dependency manifest or lockfile changes       |
| `npm run typecheck`                          | Passed                                                                    |
| `npm run build`                              | Passed                                                                    |
| `npm run lint`                               | Passed                                                                    |
| `npm test`                                   | All 27 tests across 5 files passed in approximately 145 seconds           |
| Frontend HTTP                                | HTTP 200 at http://localhost:5173                                         |
| Backend health                               | `ok: true`, SQLite, local guest identity, simulated chain, 30 Hz reported |
| Browser visual inspection / Playwright suite | Not performed in this session; no connected browser was available         |
| Public deployment / real testnet transaction | Not performed                                                             |

The regression suite exercised real local network clients, two-player combat, wallet signatures, lobby chat/readiness, reconnection, the demo journey, persistence/restart, canonical hashing, queue retries, and contract operations on an ephemeral Ganache blockchain. Ganache used its JavaScript fallback after an optional native-module warning; contract assertions passed. These results do not establish public-testnet acceptance or visual correctness.

The development servers were left running for Sam. To restart later, run `npx --yes pnpm@11.5.1 dev` from the repository root. Stop that command with Ctrl+C. Local runtime data is stored in ignored `data/knights.sqlite`; keep it to retain guest profiles and progress. Installation and serving required access outside the tool sandbox because it blocked registry access and local sockets.

Only this assessment document was added to tracked source scope; application source, dependencies, lockfile and branch were not changed. Existing `docs/VALIDATION.md` describes the previous author's run separately.

## Milestone 1: wallet ownership and stable account IDs

Implemented on `Sam-dev`: a wallet module, five-minute SIWE challenges, atomic single-use consumption, explicit binding conflicts, and wallet account IDs in the API/profile UI. The two existing wallet tables are retained; their initialization is independent of hosted authentication and now lives in the core store for use by result recording. Configure `WALLET_ORIGIN` to the frontend origin in hosted environments.

This is ownership verification and an off-chain profile link. On-chain registration, wallet-based account recovery, contract-account signature support and result identity snapshots remain later work. The wallet must be an ordinary externally owned account for this verification path.

Read [Lesson 1](LESSON-01-WALLET-IDENTITY.md) for the concepts, code walkthrough, trial steps and the distinction between wallet signatures and blockchain transactions. The lesson uses no new dependencies or funded accounts.

Milestone validation: all **40 tests across 6 files passed**, including 12 wallet-specific cases and an additional HTTP integration case for conflicting links and foreign origins. TypeScript, lint, formatting and production build passed. The local development servers were restarted with these changes. Browser-extension interaction and on-chain registration were not exercised; no public transactions were sent.

## Milestone 2: identity snapshots and result verification

New version 3 results record player names and wallet/profile/AI identity at finish, including a human's identity during AI substitution. Versions 1 and 2 keep their existing hashes and winner semantics. The authenticated proof endpoint requires recorded participation. The browser recomputes the saved hash and independently reads the configured Base Sepolia contract for real results, checking both the hash and winner digest. Simulated, missing, mismatched and unavailable chain records have distinct outcomes. The submission queue refuses locally corrupted results before broadcasting.

Use **Your legacy → Battle chronicles → expand a match → Verify result**. This also works without a wallet after training. Read [Lesson 2](LESSON-02-MATCH-PROOFS.md) for the fingerprint example, trust limits and implementation map. Public testnet submission, on-chain profile registration and automatic badge minting remain future steps.

Milestone validation on 29 October 2026: **77 tests passed across 11 files**, including 17 dedicated proof cases and actual local-contract verification/tamper rejection. Network tests cover a real wallet signature followed by a server-produced result and authenticated proof access. TypeScript, lint and the final production build passed. The existing local servers reloaded these changes. Browser visual/extension testing and public-testnet acceptance were not performed.

## Milestone 3: visible team room and arena flow

Socket.IO now provides private team text chat across menus and live matches, with authenticated membership, online presence, SQLite history and deduplicated acknowledgements/retries. WebSocket and polling chat coexist with Colyseus game connections on one backend port. Team chat is accessible before competitive qualification. The arena page identifies training, 1v1 and 4v4; its live banner shows room ID, matchmaking state and human/AI control counts. The profile explicitly displays the local game ID and distinguishes wallet linking from unimplemented on-chain registration.

The [beginner walkthrough](PROJECT-WALKTHROUGH.md) explains the complete player flow, Socket.IO event examples and the remaining hackathon gaps. Validation: **84 tests passed across 12 files**, including seven chat integration cases for private delivery, authentication/origin checks, message validation, retry deduplication, transport coexistence, membership revocation and restart persistence. TypeScript, lint, final production build and frozen-lockfile validation passed. No browser was connected for visual/typing acceptance; public deployment and two-device acceptance remain separate checks.
