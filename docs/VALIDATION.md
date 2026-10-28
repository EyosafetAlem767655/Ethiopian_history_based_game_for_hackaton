# Validation results — expanded campaign

Verified locally on Windows, Node 22.18.0 and pnpm 11.5.1. No Railway service, Supabase credentials or funded Base Sepolia signer was available. The existing public Vercel site was inspected read-only; `/api/health` returned its HTML frontend, confirming the missing backend/routing problem. These source changes have not been publicly deployed.

| Check                                        | Actual result                                                                                                                                |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict TypeScript                            | Passed                                                                                                                                       |
| ESLint                                       | Passed                                                                                                                                       |
| Production Vite build                        | Passed; separate lazy isometric renderer and Phaser bundles                                                                                  |
| Complete Vitest suite                        | **46 passed across 9 files**                                                                                                                 |
| Complete Playwright suite                    | **19 passed**, final run about 9.6 minutes                                                                                                   |
| Full browser demo                            | Completed through the King finale and earned Thronebreaker, about 6 minutes with the automated pilot                                         |
| Normal mission browser checks                | All 15 distinct mechanics exercised through keyboard/mouse input                                                                             |
| Persistence after process restart            | Signed identity, duel result/hash, campaign checkpoint and honor survived                                                                    |
| Campaign multiplayer                         | Two authenticated guest clients shared one mission, maintained four unique warrior roles, reconnected, and both retained first-clear records |
| Security/compatibility                       | Forged outcome fields, incompatible protocol, locked missions and outsider squad joins rejected                                              |
| API/legacy database                          | JSON, empty/HTML/malformed responses, HTTP errors, timeouts, missing/insecure configuration and incomplete/corrupt SQLite rows tested        |
| Contracts                                    | Local attestor authorization, replay prevention, ERC-1155 issuance and duplicate-award rejection passed                                      |
| Docker build                                 | Not executed: Docker Desktop Linux engine was unavailable on this machine                                                                    |
| Public API/WSS and genuine four-account flow | Pending owner deployment/configuration                                                                                                       |

Playwright uses a separate in-memory backend on port 2570 and frontend on 5174. The complete demo earns its progression through actual inputs; it does not inject victories or puzzle completion. Individual normal-mechanic cases seed prior checkpoints in the test-only startup script so each mechanic can be reached independently. They exercise the mechanic, not a full first-time normal-campaign playthrough. The 45–60 minute normal and 8–12 minute demo labels remain approximate first-play targets requiring human playtesting.

The browser suite covers training, arrow movement, projection/zoom, checkpoint reload, scroll transitions/replay, audio unlock and preferences, reduced motion, Amharic font loading, favicon loading, responsive menus, riding, wind-affected jousting, escorts, rescues, banner capture, seeded symbols, mirror alignment, monster telegraphs and Crown wards. A mounted boundary lock discovered during browser testing was fixed and received a regression test.

The online SQLite backup command was also executed against the local database. The new backup passed SQLite `quick_check` with `ok`; original records were retained. After the 46-case full run, a final targeted run added the checkpoint-ambush placement regression and passed all 28 selected cases, bringing validated distinct cases to **47**. It covers spawning outside walls and river water. The final presentation check additionally verified actual PNG content types and fullscreen retaining the HUD/scroll.

## Twenty-client load measurement

The final run used **19 automated signed guest input clients plus one rendered Chromium client**, in 20 independent active campaign rooms. Each room ran real Shield Oath combat with AI companions, monsters and swept magic projectiles. Inputs were sent approximately 30 times per second. Measurement output is saved to `output/load-expanded.json`.

| Metric                                  | Measured result |
| --------------------------------------- | --------------- |
| Sample window                           | 30.016 seconds  |
| Average authoritative simulation        | **29.977 Hz**   |
| Minimum room simulation                 | **29.851 Hz**   |
| Maximum actors in a sampled room        | 11              |
| Node-client snapshots received          | 10,260          |
| Snapshots containing monsters           | 10,241          |
| Snapshots containing projectiles        | 1,112           |
| Received serialized bytes, Node clients | 110,830,431     |
| Rendered viewport                       | 1440 × 1000     |
| Renderer on this software-only host     | Canvas          |
| Frame-rate samples                      | 239             |
| Median frame rate                       | **59.1 FPS**    |
| 10th-percentile frame rate              | **54.4 FPS**    |

Initial software WebGL runs held server ticks near 30 Hz but rendered at roughly 11 FPS. Static terrain/wall caching and corpse culling were added. Detecting software-only WebGL and selecting Canvas produced the reported improvement; hardware-backed browsers retain WebGL. These are local measurements, not a Railway capacity guarantee or a production hardware benchmark. No large-party single-room stress test, mobile performance target, or multi-instance backend claim is made.

## Integration handoff status

| Integration                                                  | Status                                                                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Local guest identity, SQLite, rooms and off-chain awards     | Implemented and verified                                                           |
| Demo fellowship and default chain submission                 | Explicitly simulated                                                               |
| Existing Vercel deployment                                   | Inspected; owner must deploy new revision with Railway endpoints                   |
| Railway persistent backend                                   | Configuration prepared; service not created here                                   |
| Existing Supabase campaign upgrade                           | Additive migration prepared; not applied here                                      |
| Hosted authentication/private storage/four-account approvals | Adapter implemented; live acceptance pending credentials                           |
| Base Sepolia                                                 | Retryable adapter and contracts prepared; no public deployment/broadcast performed |
| Thirdweb and automatic achievement minting                   | Unavailable/deferred                                                               |

Follow [deployment instructions](DEPLOYMENT.md) for the exact Vercel origin, endpoint ownership, persistent volume, additive Supabase upgrade, two-browser production checks, backups and rollback. Read [limitations](LIMITATIONS.md) before presenting the game as deployed or claiming a measured normal-campaign duration.
