# Royal Records

`pnpm exec tsx scripts/contracts.ts` compiles with solc and OpenZeppelin. `pnpm test` runs an ephemeral Ganache chain and checks deployment, access control, replay rejection and ERC-1155 issuance.

To deploy on Base Sepolia, fund a dedicated testnet attestor, set `ATTESTOR_PRIVATE_KEY`, explicitly set `ALLOW_CHAIN_BROADCAST=true`, then run `pnpm exec tsx scripts/deploy-contract.ts`. No deployment runs automatically. Set the returned `RECORDS_ADDRESS` on the server. Never expose the attestor key as a Vite environment variable.

The contract stores only result and winner digests, timestamp and attestor address. Read the `MatchAttested` event and `records(matchDigest)` to verify a result. Verify source through the Base Sepolia explorer using compiler version, optimizer 200 and Shanghai EVM settings from the compiler script. Demo results are never submitted to this adapter.

Badge minting requires a verified recipient wallet and trusted award call. Current gameplay awards are explicitly off-chain; the tested contract supports future minting. Replace the deployment metadata URI placeholder with a real hosted metadata endpoint before minting.

New version 3 match payloads snapshot player identities. Their winner digest hashes the sorted JSON array of winning wallet account IDs, `profile:<id>` values, or `bot:<id>` values. Version 1 and 2 results retain the old sorted participant-ID array. Use `winnerKey()` in `packages/shared/src/results.ts` rather than recalculating this differently in clients. The profile's Verify Result control reads `records(matchKey(matchId))` and compares both `resultHash` and `winner`; it does not infer proof from a server status or transaction link.
