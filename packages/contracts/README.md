# Royal Records

`pnpm exec tsx scripts/contracts.ts` compiles with solc and OpenZeppelin. `pnpm test` runs an ephemeral Ganache chain and checks deployment, access control, replay rejection and ERC-1155 issuance.

To deploy on Base Sepolia, fund a dedicated testnet attestor, set `ATTESTOR_PRIVATE_KEY`, explicitly set `ALLOW_CHAIN_BROADCAST=true`, then run `pnpm exec tsx scripts/deploy-contract.ts`. No deployment runs automatically. Set the returned `RECORDS_ADDRESS` on the server. Never expose the attestor key as a Vite environment variable.

The contract stores only result and winner digests, timestamp and attestor address. Read the `MatchAttested` event and `records(matchDigest)` to verify a result. Verify source through the Base Sepolia explorer using compiler version, optimizer 200 and Shanghai EVM settings from the compiler script. Demo results are never submitted to this adapter.

Badge minting requires a verified recipient wallet and trusted award call. The application now queues eligible earned-badge claims and confirms issuance. Simulation creates no token. Live claims require a registered, eligible wallet and an official confirmed source match; gathering-only badges stay off-chain. Replace the deployment metadata URI placeholder with a real hosted metadata endpoint before minting.

New version 3 match payloads snapshot player identities. Their winner digest hashes the sorted JSON array of winning wallet account IDs, `profile:<id>` values, or `bot:<id>` values. Version 1 and 2 results retain the old sorted participant-ID array. Use `winnerKey()` in `packages/shared/src/results.ts` rather than recalculating this differently in clients. The profile's Verify Result control reads `records(matchKey(matchId))` and compares both `resultHash` and `winner`; it does not infer proof from a server status or transaction link.

## Profile registration and deployment compatibility

The updated contract includes an EIP-712 profile registry. A role-authorized relayer must supply the owner’s signature over the profile digest, owner, deadline and nonce, scoped to chain and contract. Both wallet and profile digest are unique and immutable. Existing deployed bytecode does not gain this functionality automatically. Deploy the updated contract deliberately and retain prior addresses/receipts; changing configuration does not migrate old records or tokens.

Set a real `BADGE_METADATA_URI` containing `{id}` before deployment; the script rejects placeholders. `scripts/prepare-badge-metadata.ts --origin=https://YOUR-ACTUAL-DOMAIN` prepares absolute image URLs. Set the returned address as backend `RECORDS_ADDRESS` and frontend build-time `VITE_RECORDS_ADDRESS`, then rebuild. The browser rejects result proofs from other contracts. Production adapters use bounded requests, saved transaction hashes and two-confirmation receipt waits; they do not guarantee irreversible finality.

The deployer initially receives both admin and attestor roles. Separate admin custody and explicitly grant/revoke the online attestor before valuable use. No deployment, funding or key transfer is performed automatically. See [lesson 3](../../docs/LESSON-03-REGISTRATION-REWARDS-AND-SECURITY.md) for the complete local/demo/live flow and remaining limits.
