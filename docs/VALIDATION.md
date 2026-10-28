# Validation results

Validated locally on Windows with Node 22.18.0 and pnpm 11.5.1. No external Supabase project, funded testnet signer, or public hosting credentials were used.

| Check | Actual result |
|---|---|
| Strict TypeScript check | Passed |
| ESLint | Passed |
| Production Vite build | Passed; separate lazy game and Phaser bundles |
| Full Vitest regression run | 26 tests passed across 5 files |
| Final targeted reconnection run | 2 passed, 4 skipped; covers active-room reconnection and the newly added completed-result reconnection case |
| Playwright browser suite | 3 passed, including the entire solo story through the victory screen and earned Thronebreaker inventory |
| Persistence across process restart | Passed; signed session, qualifying victory and result hash survived reopening the database |
| Local Solidity chain | Contract deployment, authorized attestation, unauthorized rejection, duplicate-result rejection, ERC-1155 issuance and duplicate-award rejection passed |
| Live external integrations | Not executed; require configured Supabase and Base Sepolia service access |

The final targeted run added one new test after the 26-test full run. All 27 distinct regression cases have passed across these runs. The last backend change sends the authoritative snapshot and result after a successful reconnect; both relevant reconnection cases passed after that change. Typecheck, lint and production build were checked again against the final source.

The browser tests send real keyboard and mouse input. They read authoritative positions to guide movement and do not inject victories, progression, puzzle completion or rewards. Their completed path includes training, a duel, 4v4 conquest, simulated fellowship, three artifact interactions, the four-symbol puzzle, guardian combat, the individual King challenge and the cooperative Eclipse Crown phase.

## Final load measurement

Twenty authenticated clients in twenty independent active training rooms, each sending input approximately 30 times per second, over 15.0002 seconds:

- Average room simulation rate: **29.9929 Hz**.
- Slowest room: **29.8662 Hz**.
- Received snapshots: **4519**.
- Client setup time: **0.1753 seconds**.

This measures the local process and WebSocket transport under that workload; it is not an internet-latency measurement or a hosted production load guarantee.

## Review artifacts

Playwright screenshots are saved locally under `output/playwright/`: `kingdom.png`, `mobile.png`, `training-result.png`, `final-victory.png` and `legacy.png`. Build output is `apps/web/dist`. Runtime health returned HTTP success with SQLite persistence, local guest identity, simulated blockchain status and a configured 30 Hz tick rate. The frontend returned HTTP 200.

Expected test-only messages include the deliberately rejected locked-stage request and Ganache's optional native µWS fallback warning. These did not cause assertion failures.
