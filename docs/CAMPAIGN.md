# The Royal Chronicles

Aksumara, its enchanted King, and the cooperative ending remain fictional. The supplied Kibre Gugs guide inspired regional settings, horsemanship, rescue/escort objectives and cosmetic ranks. These are creative adaptations, not claims of historical reconstruction.

The normal journey contains fifteen server-owned missions. Its 45–60 minute first-play target includes training and reading/exploration, excluding matchmaking and the real-world gathering. It is a pacing target awaiting human playtesting; automated pilots can complete individual mechanics much faster. The demo uses condensed rules with a separate 8–12 minute presentation target and isolated identities/records. It is not a normal-campaign save shortcut.

| ID  | Mission                   | Implemented objective                                                          |
| --- | ------------------------- | ------------------------------------------------------------------------------ |
| 1   | Shewa: Shield Oath        | Protect a vulnerable standard-bearer through a timed multi-direction defense   |
| 2   | Entoto: Highland Riding   | Ordered ring course, momentum, braking and multiple laps                       |
| 3   | Ankober: Mist Path        | Explore four landmarks and restore a server-seeded gate sequence               |
| 4   | Wollo: Spears in the Wind | Six mounted passes, one throw per pass, wind, defense and riding score         |
| 5   | Gojjam: Stranded Courier  | Mud slows mounts; release and escort the courier through ambush checkpoints    |
| 6   | Arsi: Banner Conquest     | Capture three zones, respawns and objective scoring                            |
| 7   | Abay: Banner Crossing     | Escort a bearer across a collidable river and bridge checkpoints               |
| 8   | Wollo: Rescue             | Free three captives, sustain rescue interactions, revive fallen allies         |
| 9   | Gondar: Stolen Standard   | Capture the enemy standard and return it to the defended base                  |
| 10  | Harar: Night Watch        | Read beacon clues, kindle their sequence, then defend against shadows          |
| 11  | Missing Seal              | Collect three artifacts by branching routes and overcome monsters              |
| 12  | Four Symbols              | Several seeded symbol sequences, validated only on the server                  |
| 13  | Sun and Moon Observatory  | Rotate three receivers through distinct alignment rounds                       |
| 14  | Guardian's Gauntlet       | Monster waves followed by the armored lion and recovery windows                |
| 15  | Eclipse Throne            | Ordered individual challengers, cooperative Crown wards, then the final strike |

Hyenas close quickly, casters fight at range with swept magic projectiles, and wardens telegraph area slams. The guardian charges, claws and threatens a shockwave. The cooperative King uses shields, spell rings and summoned shadows. Sword arcs, spear streaks, projectile trails and block flashes are projected independently of world physics.

Chapter III requires the Royal Gathering. Normal play needs four qualifying authenticated human accounts, consented private image upload, and all four approvals. Demo fellowship is explicitly simulated. Legacy Stage 3 unlocks remain recognized, but do not mark any new mission as cleared.

Campaign progress lives in a separate versioned SQLite row. Each authoritative result atomically records its mission ID/version, objective state, contribution, first-clear rewards, badges and attestation outbox. Replays retain history without duplicating first-clear points/honor. Failed encounters retain earlier checkpoints. Campaign clears never change competitive duel wins/rating. Cosmetic ranks do not change equipment.

Protocol 2 clients submit only sequenced movement/aim/actions. Campaign rooms reject incompatible versions and ineligible missions. Party rooms validate persistent squad membership, assign unique roles, and label AI fillers. A disconnected human receives a 30-second reconnection grace with AI substitution. Process restarts preserve cleared missions and results, not live encounters.

The demo mission order is 1 → 2 → 6 → 8 → simulated gathering → 12 → 14 → 15. Optional training teaches sword basics. Reset Demo creates a fresh isolated identity. Normal story, rated duels, and separate 4v4 arena play remain distinct menu choices.
