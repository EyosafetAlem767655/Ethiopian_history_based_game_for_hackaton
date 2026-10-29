# Sam's feature review handoff

Prepared 29 October 2026 on `Sam-dev`. Review these additions separately from the teammate's existing campaign/combat implementation. Code comments explain the wallet transaction boundary, nonce consumption, shared socket transport, independent proof checks, and chat keyboard handling.

## Review status: draft, integration required

These changes start from `5645fcc` (2.5D animation). During handoff, `origin/main` had advanced to `addddb5` through four further commits, including Render hosting, avatar/age-review flows, and an asynchronous SQLite/Postgres database abstraction. Those newer changes have been fetched for comparison but are **not merged into this branch**. This preserves the tested feature work for review; it is not a claim that the branch is ready to deploy over current main.

Before merging, reconcile these concrete overlaps:

- Port wallet, result-proof, and chat database calls to the async database interface. Preserve atomic challenge consumption and wallet-link conflicts. The current wallet transaction uses SQLite's `.immediate()` interface.
- Add a Postgres migration for `team_messages`, qualify it under `game_runtime`, and update the SQL adapter's table list. Replace the SQLite `json_each` membership lookup with a query supported by both adapters.
- Combine `/api/me`, wallet/proof routes, shared socket transport, result identity snapshots, and the attestation worker with the newer server code. Retain the newer hosted/static-serving behavior.
- Combine the chat/arena/profile UI and typing guards with the newer avatar, age-review, and input behavior. Preserve current-main eligibility rules for human play.
- Reconcile dependency/lockfile and environment/documentation changes, then rerun both this feature suite and current main's Postgres, customization, review-storage, and browser tests.

## Six separate commits

| Order         | Addition              | Review focus                                                                                                                                                 |
| ------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 (`058d94c`) | Wallet identity       | Five-minute SIWE challenges, single-use consumption, link conflicts, stable wallet account IDs, explicit off-chain labels, wallet tests and Lesson 1         |
| 2 (`5070bd2`) | Match proofs          | Version 3 identity snapshots, legacy compatibility, participant-only proof access, independent contract reads, hash/winner checks, tamper tests and Lesson 2 |
| 3 (`0bf7a09`) | Team chat             | Socket.IO private membership, saved history, presence, retries/deduplication, shared Colyseus transport, typing controls and real-client tests               |
| 4 (`fdda2e0`) | Arena navigation      | Training/1v1/4v4 labels, qualification guidance, room ID, matchmaking state, human/AI counts                                                                 |
| 5 (`a3d9052`) | Local startup         | `npm run dev` starts both services, fixed frontend port, clearer connection errors and HTTP tests                                                            |
| 6             | Documentation/handoff | Beginner walkthrough, setup/architecture updates, feature gaps, integration notes and teammate checklist                                                     |

Commits build on each other in that order; they are separate review units, not six unrelated patches. The shared result/identity helpers are introduced with wallet identity and then used by match proofs.

## What is actually still missing

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

## Validation and manual review

The handoff full run of `npm test` completed with **84 passes and one failure out of 85 tests**. The failing `tests/network.test.ts` demo journey expected the player's squad (`0`) to win Banner Conquest, but the other squad (`1`) won at the conquest assertion. The cause is not established; do not treat this run as a clean full-suite pass. Wallet tests (12), proof tests (17), Socket.IO tests (7), local-contract tamper checks, and the other network/campaign checks passed.

The focused rerun, `npm test -- tests/network.test.ts -t 'completes the demo journey'`, **passed** (one test; six skipped) in about 121 seconds without a gameplay change. This demonstrates inconsistent test behavior; the gameplay/controller timing and guaranteed-win expectation still need investigation.

`npm run lint`, `npm run typecheck`, and the production build passed on this feature snapshot. The staged code for each feature commit was checked separately with TypeScript. Earlier work also passed a full 84-test suite before the additional HTTP regression test. These results do not validate the newer main integration.

No public-testnet transaction, browser-wallet extension interaction, public two-device acceptance, or visual browser review was completed in this session.

Manual review on this branch:

1. Run `npm run dev` and keep the terminal open. Open `http://localhost:5173` in a normal window and a private window with separate profiles.
2. Open **Team room**, share/join its invite code, send messages both ways, navigate away/back and reconnect. Check history and typing during a live match.
3. Complete training and a match. Open **Your legacy → Battle chronicles → Verify result**. Local simulation must not claim an on-chain proof.
4. Optionally link a browser wallet by signing its ownership message. Confirm that the UI calls the link off-chain and does not claim registration or wallet-based account recovery.
5. After integrating main, repeat the flow on two devices using the deployed URL and the newer eligibility rules.

Additional explanations: [project walkthrough](PROJECT-WALKTHROUGH.md), [wallet lesson](LESSON-01-WALLET-IDENTITY.md), [proof lesson](LESSON-02-MATCH-PROOFS.md).
