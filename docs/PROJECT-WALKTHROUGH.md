# What the game does, what Web3 means here, and how team chat works

This walkthrough is for Sam, starting from the beginning. It describes the implementation on `Sam-dev` as of 29 October 2026. Local features, configured integrations and unfinished work are distinguished below.

This is the feature snapshot based on `5645fcc`. Newer `main` commits add deployment and asynchronous database changes that still require integration. The [review handoff](SAM-REVIEW-HANDOFF.md) records those overlaps, the latest validation results, and the teammate checklist.

## The direct answer about your blockchain profile

Your game profile is created when you enter a nickname. It has a unique ID in the game database. That is a normal game account identifier, not an on-chain registration.

The wallet-link feature is implemented. Selecting **Link your wallet** and approving its message proves control of that wallet and saves its association with the game profile. The profile then displays a wallet account ID such as `eip155:84532:0x…`. The signature itself is not a blockchain transaction. The wallet link is stored off-chain.

An actual on-chain player registry is **not implemented**. We have not deployed a public contract or broadcast a public-testnet transaction in this session. The default match-recording mode is simulated. The code contains a Base Sepolia recording adapter and Solidity contract, and contract operations have been tested on a disposable local blockchain.

| Thing                         | What it means                                               | Current status                                                 |
| ----------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| Game profile ID               | The account the game uses for progress and inventory        | Created automatically and stored in SQLite                     |
| Verified wallet link          | A signed message associates a wallet with that game account | Implemented; each player must approve their own signature      |
| Wallet account ID             | A string identifying an address and network                 | Displayed after linking; does not itself write to a blockchain |
| On-chain profile registration | A transaction registers the player in a public contract     | Not implemented                                                |
| Public match attestation      | A transaction anchors a completed result                    | Adapter exists; actual testnet deployment/acceptance remains   |
| Tokenized achievement         | An earned badge is minted to a wallet                       | Contract capability exists; automatic gameplay minting remains |

## Follow one player from opening the game to a recorded win

1. **Open the screen.** React renders the menus at http://localhost:5173. The game screen is the frontend: it draws things and accepts input.
2. **Choose a nickname.** The browser asks the Node server to create a game profile. SQLite saves the profile. The server returns a signed session token, which the browser saves so later requests can identify the player. This token is not a cryptocurrency token.
3. **Choose a warrior.** This chooses appearance. Training and competitive rules remain controlled by the server.
4. **Choose a mode.** **Your journey** opens the story campaign. **Battle arena** opens training, 1v1 duels and the route to 4v4 play. These are different flows.
5. **Join the arena.** Colyseus places players in a game room and keeps a live connection. The arena banner shows the room ID, matchmaking/match status and human/AI-controlled warrior counts. Matchmaking waits five seconds before filling empty competitive seats with AI.
6. **Play.** The browser sends movement, aim, attack and defense commands. The server acts as referee: it calculates the match and broadcasts authoritative state. Phaser draws that state using the game's isometric renderer. A player cannot legitimately win just by sending `winner: me`.
7. **Finish.** A database transaction saves the result, progress, points, off-chain badges and an entry in a submission queue. New results snapshot player identities at finish, including the human account when AI substitutes after disconnection.
8. **Compute the fingerprint.** The server produces canonical JSON and a Keccak-256 hash of the result. If the score changes, the fingerprint changes. A hash is not encryption and does not prove the original score was honest.
9. **Verify.** **Your legacy → Battle chronicles → Verify result** recomputes that fingerprint in the browser. For a real record with a configured contract, it also reads the contract and compares the result and winner digests. Simulated results explicitly show that there is no on-chain proof.
10. **Add real blockchain writes later.** The trusted server will submit result digests to its deployed contract. The blockchain records what was submitted; the game server remains responsible for fair refereeing. Profile registration and automatic badge minting are separate implementation steps.

The database is the game's notebook. Colyseus is the live gameplay connection. Socket.IO is now the live team-message connection. The blockchain is a separate public record for the selected identity/reward/result features; it is not used to send every movement or chat message.

## Try the team room with a teammate

1. Open the game and choose a nickname. You do not need a wallet, training or competitive qualification to chat.
2. Select **Team room** in the sidebar. The server creates or reopens your team.
3. Share its six-character **Invite code**.
4. The other player opens the game in another browser, a private window, or on another device with access to the same server. Use distinct game profiles; two ordinary tabs can share the same saved login.
5. They open **Team room**, enter your code and choose **Join**.
6. Both players see team chat, online names and the same messages. Messages are persisted; the last 100 are loaded when reconnecting.
7. Navigate to **Battle arena** or **Your journey**. The chat connection stays mounted. Outside the team screen it appears as a collapsible panel, including during matches and fullscreen gameplay.
8. While typing, gameplay keyboard/actions are suppressed. The live match continues. Click the arena to regain control.

For two devices, both must use a reachable backend, not their own unrelated localhost. Public deployment and device-to-device acceptance remain to be completed. For local testing, a normal window plus a private window on the same computer is sufficient.

Chat access and battle qualification are separate. To enter a competitive duel, complete training. To enter 4v4, each human needs the required qualification: one qualifying duel win in demo or ten in normal progression. Connected squad members ready up on the team page. AI fills unoccupied battlefield seats; bots do not participate in chat.

## What Socket.IO does in this implementation

Socket.IO provides events between the browser and server while the connection stays open. Its rooms let the server send a message to a selected team. It supports WebSocket and a polling fallback. It is a separate protocol from a plain WebSocket and from Colyseus; a Socket.IO browser client must connect to a Socket.IO server.

Here is the actual event flow, simplified:

```ts
// Browser: identify the signed-in game player and the intended team.
io(serverUrl, { auth: { token: gameSessionToken, squadId } });

// Browser: send text with a unique retry identifier.
socket.emit('chat:send', { clientId: crypto.randomUUID(), text: 'Hello team' }, (reply) => {
  // Acknowledge success or show the server's error.
});

// Server, after authentication, membership validation and saving the message:
io.to('team:' + squadId).emit('chat:message', savedMessage);

// Browser: append the server's message to the chat log.
socket.on('chat:message', (message) => addMessageToScreen(message));
```

The server chooses the room and sender name. It checks the session and team membership; trusting a typed team ID or nickname would let outsiders impersonate teammates. Membership is rechecked before delivery, so switching teams revokes old-room access. Text must contain 1–500 characters. New messages are limited to one per player per second. The client keeps its draft if acknowledgement fails, and a repeated client message ID is acknowledged without inserting/broadcasting a duplicate.

Socket.IO chat and Colyseus combat use the same backend port, 2567 locally. `SharedGameTransport` routes WebSocket upgrade requests to the correct protocol; both servers must not try to accept the same upgrade. Existing Colyseus squad readiness remains responsible for starting the competitive team match. Team text messages use the new Socket.IO room.

| File                           | Responsibility                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `apps/server/src/chat.ts`      | Session/membership checks, Socket.IO rooms, presence, saved messages and acknowledgements    |
| `apps/server/src/transport.ts` | Shares the HTTP port safely between game and chat protocols                                  |
| `apps/web/src/TeamChat.tsx`    | Connects the browser, renders history and sends text; stays mounted while changing screens   |
| `packages/shared/src/chat.ts`  | Shared message and event types                                                               |
| `apps/web/src/iso.ts`          | Stops gameplay controls while chat/text controls have focus                                  |
| `tests/chat.test.ts`           | Real clients test private delivery, transport compatibility, retries and restart persistence |

Socket.IO and its browser client are installed in the root workspace. For a separate project the installation command would be `pnpm add socket.io socket.io-client`; in this pnpm workspace it is `pnpm add -w socket.io socket.io-client`. There is no extra hosted chat account or API key.

## Remaining gaps, ordered for a hackathon

| Priority          | Gap                                                  | Why it matters                                                                                                                                     |
| ----------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next              | Real on-chain profile registration                   | The brief asks for blockchain-based player profiles; a signed database link is only part of that flow                                              |
| Next              | Actual Base Sepolia deployment and result acceptance | The adapter needs a deployed contract, dedicated testnet signer and evidence from real completed matches                                           |
| Next              | Automatic earned-badge minting                       | Off-chain inventory must be linked to contract awards, a stable badge-ID map, retries and wallet balance display                                   |
| Next              | Public backend/frontend and two-device acceptance    | Local network tests do not establish a working public multiplayer deployment                                                                       |
| Next              | Explicit opponent/matchmaking choices                | AI starts after five seconds; a human-only queue and a clear opponent acceptance flow are not implemented                                          |
| After main demo   | Spectator mode                                       | There is no dedicated read-only spectator join path                                                                                                |
| After main demo   | Full replay playback                                 | History stores result data/significant events rather than a full rewind or video                                                                   |
| After main demo   | Tournament brackets and tournament rewards           | Competitive matches exist, but a general tournament lifecycle is absent                                                                            |
| After main demo   | Friend requests and direct invitations               | Team codes work; a social friend list/request system is absent                                                                                     |
| After main demo   | Broader activity notifications                       | Chat presence/unread counts exist; the complete activity-notification scope remains                                                                |
| After main demo   | Wallet sign-in/recovery                              | Linking a wallet does not recover a lost guest login or move its link to another profile                                                           |
| Gameplay teammate | Full original Kibre Gugs progression                 | Current code adapts the idea into fifteen missions and a fictional final encounter, rather than implementing the full original twenty-level design |
| Polish            | Mobile combat, moderation and visual acceptance      | Desktop controls exist; touch combat, report/mute tools, and browser/device QA need additional work                                                |

The leaderboard is currently database-backed. Public ranking proof links and further leaderboard categories remain improvements. The existing private proof endpoint allows recorded participants to inspect their matches; it is not a complete public tournament auditing portal.

## A practical next order

First confirm two humans can join one team and text while a match is active. Then register one profile on the testnet, record one genuine non-demo match, verify its transaction, and mint one earned badge. Complete those end-to-end flows before adding tournaments, friends, spectators or full replay.

Primary references: [Socket.IO rooms](https://socket.io/docs/v4/rooms/), [server initialization](https://socket.io/docs/v4/server-initialization/), [authentication middleware](https://socket.io/docs/v4/middlewares/). Earlier blockchain concepts are explained in [Lesson 1](LESSON-01-WALLET-IDENTITY.md) and [Lesson 2](LESSON-02-MATCH-PROOFS.md).

Validation on 29 October 2026: **84 tests passed across 12 files**. TypeScript, lint, the final production build and frozen-lockfile validation passed. The seven chat cases use real Socket.IO clients and include simultaneous WebSocket/polling chat and Colyseus gameplay on the same port. Browser layout/typing acceptance and public deployment were not tested because no browser was connected.
