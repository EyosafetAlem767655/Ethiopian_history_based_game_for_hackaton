// Test-only fixture process. Production entrypoint never imports this module.
import { mkdirSync, writeFileSync } from 'node:fs';
process.env.DB_PATH = ':memory:';
process.env.PORT = '2570';
process.env.ALLOW_CHAIN_BROADCAST = 'false';
process.env.PERSISTENCE = 'sqlite';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SECRET_KEY = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.AGE_REVIEWER_IDS = '';
const store = await import('../apps/server/src/store');
const { freshCampaign } = await import('../packages/shared/src/missions');
const sessions: Record<string, unknown> = {};
const { world, fighter } = await import('../packages/shared/src/game');
const web3Player = await store.createProfile('Wallet browser fixture', true);
const badgeMatch = world('duel', true);
badgeMatch.players = [
  fighter(web3Player.id, web3Player.name),
  fighter('web3-browser-bot', 'Synthetic opponent', 1, true),
];
badgeMatch.winner = 0;
badgeMatch.finished = true;
await store.recordResult('browser-badge-fixture', badgeMatch, new Date().toISOString());
sessions.web3 = { token: store.token(web3Player), profile: web3Player };
for (let id = 1; id <= 15; id++) {
  const p = await store.createProfile('Mechanic ' + id, false);
  await store.saveCampaign(p.id, {
    ...freshCampaign(),
    completed: Array.from({ length: id - 1 }, (_, n) => n + 1),
    fellowship: id >= 11,
  });
  sessions[id] = { token: store.token(p), profile: p };
}
mkdirSync('output/tests', { recursive: true });
writeFileSync('output/tests/browser-fixtures.json', JSON.stringify(sessions));
await import('../apps/server/src/index');
