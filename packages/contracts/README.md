# Royal Records

`pnpm exec tsx scripts/contracts.ts` compiles with solc and OpenZeppelin. `pnpm test` runs an ephemeral Ganache chain and checks deployment, access control, replay rejection and ERC-1155 issuance.

To deploy on Base Sepolia, fund a dedicated testnet attestor, set `ATTESTOR_PRIVATE_KEY`, explicitly set `ALLOW_CHAIN_BROADCAST=true`, then run `pnpm exec tsx scripts/deploy-contract.ts`. No deployment runs automatically. Set the returned `RECORDS_ADDRESS` on the server. Never expose the attestor key as a Vite environment variable.

The contract stores only result and winner digests, timestamp and attestor address. Read the `MatchAttested` event and `records(matchDigest)` to verify a result. Verify source through the Base Sepolia explorer using compiler version, optimizer 200 and Shanghai EVM settings from the compiler script. Demo results are never submitted to this adapter.

Badge minting requires a verified recipient wallet and trusted award call. Current gameplay awards are explicitly off-chain; the tested contract supports future minting. Replace the deployment metadata URI placeholder with a real hosted metadata endpoint before minting.
