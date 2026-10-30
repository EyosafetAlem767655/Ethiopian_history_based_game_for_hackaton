# Sam's feature review handoff

## Current update — 30 October 2026

Main was fetched again after the interruptions and remains `04837ad`. `Sam-dev` includes it. The remote branch `feat/frontend-smoke-tests` adds one smoke-test file but is not merged into main; this work does not merge that separate branch.

Implemented in this update:

- Consent-based on-chain profile registration: EIP-712 signatures scoped to player/wallet, Base Sepolia, deployment, nonce and expiry; contract verifies consent and enforces unique immutable ownership. Simulation remains explicit.
- Earned-badge ERC-1155 claim pipeline and inventory status: source-match integrity and authorization checks, official on-chain source comparison, durable leased jobs, bounded retries, transaction recovery and an independent wallet-balance control. Gathering-only badges remain off-chain.
- Match-long room chat and bounded reconnect history, separate from persistent private Socket.IO team chat. Restoring canvas focus resumes controls after chat and form use.
- Room/team authorization and duplicate-admission fixes; match-time squad attribution; real logout/server revocation; strict token parsing; early matchmaking limits/origin checks; team-chat revocation, packet budgets, queue and connection caps.
- Four-person gathering approval through one transactional implementation; photo-revision consent; fenced photo/document uploads outside the global transaction; durable late/orphan deletion jobs and updated scheduled cleanup.
- Pinned official proof-contract checks, bounded result submissions and transaction-preserving retry controls. API responses are marked no-store; runtime container uses a non-root user.

**Deployment is coordinated:** apply pending migrations **006, 007, 008** in order; redeploy the cleanup function and frontend/backend together. Live profile registration needs the updated contract bytecode. Configure the same `RECORDS_ADDRESS` and build-time `VITE_RECORDS_ADDRESS`, real metadata URLs, eligible accounts, attestor role/funds and key-management steps. Broadcasting stays disabled by default. No hosted schema was changed and no public blockchain transaction was sent during this work.

Validation: the final full regression run passed **108 tests in 21 files**. Chromium is now available in the local temporary browser cache; **2 browser checks passed**, including real backend wallet-signature verification, simulated profile/badge claims, logout revocation, rendering, arena controls and fullscreen. The wallet provider in that browser test is synthetic; real extension/public-testnet acceptance is still required. TypeScript, lint and the production build passed.

The first broad run exposed an existing test controller that camped one zone and assumed a squad victory. It now chooses capture objectives, aims at nearby opponents and uses current arena geometry; assertions still require a genuine server-recorded win. A focused journey rerun passed, followed by the full 108-test run. Browser testing found and fixed a missing credentialed CORS preflight header and a real canvas-focus problem; the presentation test now explicitly clicks the field after using form controls.

Current security status against the dated audit:

| Findings           | Status                                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S01–S08            | Core reproduced access/consent/storage/chat/logout failures repaired with regression coverage. Broader account lifecycle and operational hardening remain.        |
| S09                | Duplicate admissions and changed-roster result attribution repaired; competitive anti-farming policy is still open.                                               |
| S10                | Official proof contract pinned independently in frontend configuration; legacy hash serialization remains unchanged.                                              |
| S11                | Reward leases/recovery and bounded result submission improved; full finality/reorg operations, multi-worker result leases and separate admin custody remain open. |
| S12                | Durable deletion/fencing improved; full server-side image decoding, dimension limits, retention/account deletion policy remain open.                              |
| S13                | Schema readiness and import coverage improved; hosted least-privilege/backup restoration/integrity checks remain unverified.                                      |
| S14 / dependencies | Strict parser, private-response cache policy, nosniff and non-root runtime added; full CSP/CI/minimal runtime and dependency upgrades remain open.                |

Still missing product scope: spectators, full replay playback, tournaments, friends/direct invitations/activity notifications and a complete public ranking proof trail. Decide the original 20-level concept versus the current 15-mission adaptation with the gameplay owner. Public frontend/API/WSS URLs and public-testnet deployment/receipt evidence have not been supplied or verified.

Sam's identity/proof/reward/chat code is implemented locally; the dated audit is historical and does not mean these newly repaired issues are still present. Read [lesson 3](LESSON-03-REGISTRATION-REWARDS-AND-SECURITY.md) and [deployment instructions](DEPLOYMENT.md) for the current flow. The earlier handoff below is preserved as history.

---

Prepared 29 October 2026 on `Sam-dev`. Review these additions separately from the teammate's existing campaign/combat implementation. Code comments explain the wallet transaction boundary, nonce consumption, shared socket transport, independent proof checks, and chat keyboard handling.

## Historical main integration and conflict resolution — 29 October

Latest fetched `origin/main` is `addddb5` (29 October 2026). Its Render hosting, asynchronous SQLite/Postgres database layer, avatars, age-review flow and result-save acknowledgments are now combined with Sam's six feature commits on `Sam-dev`.

The merge produced ten conflicted files: `attestation.ts`, `hosted.ts`, `index.ts`, `main.tsx`, `vite.config.ts`, `DEPLOYMENT.md`, `package.json`, `pnpm-lock.yaml`, `http.test.ts`, and `network.test.ts`. Resolution preserves both feature sets and includes the necessary semantic integration:

- Wallet challenge creation, binding and identity reads now await the shared database adapter. Binding uses its serialized transaction, including Postgres advisory locking, rather than SQLite-only `.immediate()`. Bigint expiry values are normalized before comparison.
- Match identities are fully resolved before canonical serialization/hashing. Proof access and the attestation worker await their database operations; legacy hashes remain unchanged.
- Chat uses async authentication/membership/history, a room work queue, transactional message deduplication and persisted spam limits. Postgres aliases preserve `playerId`; epoch values become numbers before sending to clients. Same-origin hosted chat is supported.
- Migration `005_team_chat.sql` adds the private Postgres chat table/indexes, retry uniqueness and browser-role access restrictions. The SQL adapter qualifies the new table and membership queries use the correct JSON function for each database.
- `/api/me` retains wallet/proof/team data plus the newer avatar/age fields. Colyseus retains its age-band filters. Render static hosting, cold-start handling, avatar rendering and committed-result acknowledgment remain.
- The frontend retains both optional vision prebundling and the fixed local port. Combined npm startup and actionable development errors remain; a production same-origin failure does not tell hosted users to run a local command.
- The pinned dependency graph retains all main entries plus Socket.IO. Chat tests now use synthetic approved-adult fixtures to respect existing invitation rules.

Before a production rollout, apply the pending `005_team_chat.sql` migration and configure `WALLET_ORIGIN` to the actual frontend origin. These integration changes do not deploy services, alter a hosted database, broadcast transactions or mint badges.

## Six original feature commits (preserved)

| Order         | Addition              | Review focus                                                                                                                                                 |
| ------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 (`058d94c`) | Wallet identity       | Five-minute SIWE challenges, single-use consumption, link conflicts, stable wallet account IDs, explicit off-chain labels, wallet tests and Lesson 1         |
| 2 (`5070bd2`) | Match proofs          | Version 3 identity snapshots, legacy compatibility, participant-only proof access, independent contract reads, hash/winner checks, tamper tests and Lesson 2 |
| 3 (`0bf7a09`) | Team chat             | Socket.IO private membership, saved history, presence, retries/deduplication, shared Colyseus transport, typing controls and real-client tests               |
| 4 (`fdda2e0`) | Arena navigation      | Training/1v1/4v4 labels, qualification guidance, room ID, matchmaking state, human/AI counts                                                                 |
| 5 (`a3d9052`) | Local startup         | `npm run dev` starts both services, fixed frontend port, clearer connection errors and HTTP tests                                                            |
| 6             | Documentation/handoff | Beginner walkthrough, setup/architecture updates, feature gaps, integration notes and teammate checklist                                                     |

A subsequent merge commit integrates main and resolves the ten conflicts without squashing these six feature commits. The original commits build on each other in that order; they are separate review units, not six unrelated patches. The shared result/identity helpers are introduced with wallet identity and then used by match proofs.

## Historical gaps — superseded by the current update above

| Gap                            | Concrete next deliverable                                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| On-chain profile registration  | Register a wallet-authorized profile and show the actual registration state; wallet linking currently only saves a verified database association                              |
| Public-testnet result evidence | Deploy/configure the contract, complete a non-demo match, and independently verify its record; simulation remains a permitted hackathon fallback                              |
| Tokenized rewards              | Connect one earned badge to contract minting, durable retries, metadata and actual wallet balance display; current achievement inventory is off-chain                         |
| Spectators                     | Join a match as a read-only observer without taking a fighter slot                                                                                                            |
| Full replays                   | Record enough ordered input/state data and implement playback; saved results/events alone are not a replay                                                                    |
| Tournaments                    | Brackets, tournament lifecycle and reward distribution                                                                                                                        |
| Social features                | Friend requests, direct invitations and activity notifications beyond team presence/unread chat                                                                               |
| Human-only matchmaking         | A deliberate wait-for-human option; current rooms can fill with AI after five seconds                                                                                         |
| Public acceptance              | Confirm owner-configured deployment and test two devices, reconnect, saved history and chat; newer main contains hosting code, but that is not deployment acceptance evidence |

Wallet sign-in/recovery is also absent: linking a wallet does not recover a lost guest account. It is separate from the brief's minimum identity demonstration.

## What the gameplay teammate can send Sam

- The working frontend/backend URLs and deployed commit, or the remaining hosting configuration tasks. Send configuration names/status, not private keys or service-role secrets.
- Confirmation of the intended training, age-review and human-match eligibility rules so the team room and arena give consistent instructions.
- The planned spectator/replay room events and which gameplay features are already being implemented, to avoid duplicate work.
- The achievement names and exact earning conditions for the first blockchain badge.
- A short confirmed list of remaining gameplay bugs, including whether the squad demo is expected to guarantee a player-team win.

Sam's next focus is the Web3 identity/result/reward path and chat integration. Agree ownership of spectators, replays, tournaments and social features before extending them.

## Historical integrated validation — 29 October

Validated on 29 October 2026 after combining main through `addddb5`:

| Check                                | Result                                                                                                                                                                                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                           | **100 tests passed across 17 files**, about 257 seconds; includes the demo journey, multiplayer/campaign/reconnect/persistence, wallet/proof/chat, age-review/storage and Postgres checks                                                                                                         |
| Focused integration run              | **48 passed** across wallet, proofs, chat, Postgres and HTTP files                                                                                                                                                                                                                                |
| New Postgres end-to-end check        | Passed: real migrations and runtime SQL/transactions, wallet signature/replay rejection, result identity snapshots, private chat, concurrent retry deduplication, reconnect history and browser-role table restrictions; only the database transport uses local PGlite instead of a hosted server |
| TypeScript / lint / production build | All passed                                                                                                                                                                                                                                                                                        |
| Frozen dependency installation       | Passed; all current-main lock entries retained plus the Socket.IO graph                                                                                                                                                                                                                           |
| Local app and backend                | Frontend HTTP 200; direct and frontend-proxied API health both returned `ok: true`, SQLite, simulated blockchain                                                                                                                                                                                  |
| Browser smoke attempt                | Two existing checks could not launch because the required Chromium executable is absent; browser behavior/visual acceptance remains unverified                                                                                                                                                    |
| Public deployment/testnet            | Not performed; no hosted database was migrated and no chain transactions or badge mints were sent                                                                                                                                                                                                 |

The earlier pre-merge demo test had failed once on its guaranteed squad-win expectation and passed on a focused rerun. The integrated full run above passed that test too; the earlier inconsistent gameplay/controller behavior is still useful context for the gameplay developer.

The three slow npm artifacts were downloaded in ranges and each SHA-512 was checked against the pinned lockfile before caching with pnpm. The project lockfile retains registry resolutions, not local temporary artifact paths.

## Historical manual review checklist

Manual review on this branch:

1. Run `npm run dev` and keep the terminal open. Open `http://localhost:5173`. Separate normal/private windows provide separate browser sessions, but nicknames alone do not satisfy main's reviewed-adult invitation rule.
2. Open **Team room**, share/join its invite code with eligible reviewed-adult accounts, send messages both ways, navigate away/back and reconnect. A solo player can open their own team room without training or a wallet; joining other humans still follows main's eligibility rules. Check history and typing during a live match.
3. Complete training and a match. Open **Your legacy → Battle chronicles → Verify result**. Local simulation must not claim an on-chain proof.
4. Optionally link a browser wallet by signing its ownership message. Confirm that the UI calls the link off-chain and does not claim registration or wallet-based account recovery.
5. After integrating main, repeat the flow on two devices using the deployed URL and the newer eligibility rules.

Additional explanations: [project walkthrough](PROJECT-WALKTHROUGH.md), [wallet lesson](LESSON-01-WALLET-IDENTITY.md), [proof lesson](LESSON-02-MATCH-PROOFS.md).
