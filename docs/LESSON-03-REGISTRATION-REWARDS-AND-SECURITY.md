# From a linked wallet to a registered profile and badge

Update: 30 October 2026, `Sam-dev`. Main was fetched and was already current at `04837ad` before this work.

## What each step means

1. **Sign in / create a game profile.** Your game token identifies the account to the server. Email sign-in remains separate from the wallet.
2. **Link a wallet.** The existing ownership-message signature proves you control an address. This database link does not cost gas and is not an on-chain profile.
3. **Request profile registration in Your legacy.** In simulation mode the app creates a clearly labeled simulated record. In testnet mode you sign an EIP-712 authorization naming your wallet, a digest of your game profile, the official contract, Base Sepolia, a nonce and a ten-minute expiry. The server consumes that exact challenge once and queues it. The contract checks your signature as well as the relayer's role before registering. No email, birth date or photo is placed on-chain.
4. **Earn an achievement through gameplay.** The server decides the result and saves the badge. The browser cannot grant itself a badge by sending a token number.
5. **Claim its token.** The server verifies ownership of the achievement and the integrity of its source match. Live claims require an eligible signed-in, non-demo profile, confirmed profile registration and a confirmed non-demo result. The blockchain adapter also compares the source result to the official contract before minting. Gathering-only fellowship badges remain off-chain.
6. **Read the status.** Simulated means no chain operation happened. Pending/processing means queued work. Confirmed means a matching registration/award was checked on the configured chain. A transaction link is provided when available. Check wallet ownership reads ERC-1155 balance independently; a transferable badge may have left the original wallet after issuance.

You do not need wallet funds for the two message signatures. The server's dedicated testnet attestor pays the actual transaction fee. These are prototype/testnet achievements with no promised monetary value. This flow currently supports externally owned Ethereum accounts; smart-contract wallets and wallet recovery/relinking are not implemented.

## Why the queue exists

Blockchain requests can be slow or fail while the game continues. Jobs are durable database records, scoped to the deployment and player. A short transaction leases work, then releases the database before network operations. The worker saves a submitted transaction hash before waiting for a receipt. Retrying first reconciles that hash and the contract state; it does not immediately mint again. Tests simulate a receipt outage after a successful write and confirm one token, not two.

The worker processes at most three reward jobs per tick, backs off failed attempts, stops automatic retries after five attempts and reclaims expired processing leases after a restart. A failed badge can be requested again from the same claim control; a failed profile request needs a fresh authorization. Result submissions have a separate retry control in Battle chronicles. Production reads/writes use bounded RPC requests and two-confirmation receipt waits; this is not a guarantee of irreversible chain finality.

## Setup for the teammate deploying it

1. Apply pending migrations **006, 007 and 008** after 005, deploy the updated cleanup function, and verify the schedule. Keep the existing session secret stable.
2. Keep `ALLOW_CHAIN_BROADCAST=false` for ordinary local demos. Link a synthetic wallet, simulate registration, then simulate a claim on an earned badge. The UI explicitly says no token exists on-chain.
3. For a real testnet demonstration, first prepare absolute image URLs with `node --import tsx scripts/prepare-badge-metadata.ts --origin=https://YOUR-ACTUAL-GAME-DOMAIN`, then deploy those public metadata files. Set `BADGE_METADATA_URI=https://YOUR-ACTUAL-GAME-DOMAIN/achievements/{id}.json`. The deploy script rejects the old placeholder.
4. Deploy the updated `RoyalRecords` contract deliberately with the configured testnet attestor. The old bytecode does not contain the profile registry. Set **`RECORDS_ADDRESS` on the server and the same `VITE_RECORDS_ADDRESS` in the frontend build**, then rebuild/redeploy. The browser refuses proofs from a different contract. Preserve any earlier deployment addresses and result evidence; do not assume changing the address migrates old results or tokens.
5. Check attestor permissions and testnet funds. The deployment initially gives the deployer both admin and attestor roles. Before any valuable use, transfer admin control to a separately managed account and document grant/revoke/rotation. Never put a private key in a `VITE_*` value.
6. Enable live broadcasting only after that setup is reviewed. Use an eligible signed-in, non-demo account under the existing adult-review policy. Register, complete/confirm a result, claim, inspect the explorer and read the wallet balance. Record actual URLs/address/receipts; no public deployment or transaction was performed by this implementation session.

## Security changes that support this flow

- Lobby/quest membership is checked against the room's actual team; concurrent admission cannot create duplicate fighters. Squad result attribution uses the match roster instead of whatever team the player joined later.
- Matchmaking has its own early authentication, origin, byte, time and request limits because it executes before Express. Browser preflight includes credential permission for allowed origins.
- Logout revokes the server token fingerprint, closes active connections and signs out the email provider. Token parsing rejects extra segments and malformed signatures. Other processes discover revocation during periodic session checks.
- Team chat validates and budgets packets before queuing, bounds queue depth/connections and checks membership within the database transaction used for delivery. Team changes trigger eviction; private history is checked again after its asynchronous read.
- Match chat stays available after the countdown, includes opponents, has a rate limit and keeps a bounded room-lifetime history for reconnects. Team chat remains separate and private. Typing pauses your controls; the match continues.
- Gathering approvals require four current eligible members and the current photo revision. Upload publication and deletion use fenced, immutable object paths. Evidence uploads and reviewer downloads run outside the global transaction. Cancelled/late uploads cannot restore the database reference and are queued for deletion.

## Still open

Public two-device/testnet acceptance, actual hosted permissions/scheduling/backups, dependency upgrades, full server image decoding/dimension checks, comprehensive security headers/CI, retention/account deletion policy, wallet recovery and broader competitive anti-farming rules remain open. Spectators, full replay playback, tournaments and friends/activity notifications are separate unimplemented product work. The 20-level original concept versus the 15-mission adaptation still needs an explicit gameplay decision.

These changes improve the audited flows; they do not certify the whole project as production secure. The dated 29 October audit describes the earlier revision and should be read alongside the current handoff/status update.
