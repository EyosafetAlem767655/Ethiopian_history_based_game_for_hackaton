// Load .env before ./database and ./store read process.env at import time.
import 'dotenv/config';
import { SessionError } from './store';
import { registerCustomization, readAvatar, eligibility, assertParty } from './customization';
import { persistence, checkDatabase } from './database';
import { asyncRoutes } from './routes';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GuardedGameServer } from './matchmaking';
import { SharedGameTransport } from './transport';
import { currentSquad, registerTeamChat, notifyTeamMembershipChanged } from './chat';
import { registerNotifySocket, registerSocialRoutes, friendCode } from './social';
import { liveMatches, registerSpectators } from './live';
import { registerTournamentRoutes } from './tournament';
import { resultProof } from './result-proof';
import { registerWeb3Routes, web3Inventory, processWeb3Jobs } from './web3';
import { baseRewardsAdapter } from './chain-rewards';
import { z } from 'zod';
import type { Address, Hex } from 'viem';
import {
  bindWallet,
  checkWalletOrigin,
  issueWalletChallenge,
  walletIdentity,
  WalletLinkError,
} from './wallet';
import { registerHostedRoutes, exchangeHosted, isHosted, syncHosted, supabase } from './hosted';
import { processMediaDeletions } from './media';
import { BaseAttestation, processOutbox } from './attestation';
import { BattleRoom } from './room';
import { SquadLobby } from './lobby';
import { leaderboard } from './leaderboard';
import { CampaignRoom } from './campaign-room';
import { MISSIONS, DEMO_MISSIONS } from '../../../packages/shared/src/missions';
import { PROTOCOL_VERSION } from '../../../packages/shared/src/presentation';
import {
  authenticate,
  revokeSession,
  createProfile,
  token,
  profile,
  history,
  badges,
  db,
  digest,
  saveProfile,
  issueBadge,
  campaignProgress,
  saveCampaign,
  armorSets,
} from './store';
const app = express();
// Render terminates TLS at one proxy hop; trust it so req.ip is the client, not the proxy.
app.set('trust proxy', 1);
asyncRoutes(app);
app.use((_q, r, next) => {
  r.setHeader('X-Request-ID', randomUUID());
  r.setHeader('X-Content-Type-Options', 'nosniff');
  if (_q.path.startsWith('/api/')) r.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(
  cors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
    exposedHeaders: ['X-Request-ID'],
  }),
);
app.use(express.json({ limit: '32kb' }));
const limits = new Map<
  string,
  {
    n: number;
    time: number;
  }
>();
app.use((req, res, next) => {
  const key = req.ip ?? 'local',
    now = Date.now();
  let entry = limits.get(key);
  if (!entry || now - entry.time > 60000) {
    entry = { n: 0, time: now };
    limits.set(key, entry);
  }
  if (++entry.n > 300) {
    res.status(429).json({ error: 'Slow down' });
    return;
  }
  next();
});
setInterval(() => {
  for (const [k, v] of limits) if (Date.now() - v.time > 60000) limits.delete(k);
}, 60000).unref();
app.get('/api/health', async (_q, r) => {
  await checkDatabase();
  return r.json({
    ok: true,
    identity: persistence === 'supabase' ? 'guest-and-supabase' : 'local-guest',
    persistence,
    blockchain:
      process.env.ALLOW_CHAIN_BROADCAST === 'true' ? 'base-sepolia-configured' : 'simulated',
    protocol: PROTOCOL_VERSION,
    tickRate: 30,
  });
});
app.post('/api/session', async (q, r) => {
  const parsed = z
    .object({
      name: z
        .string()
        .trim()
        .min(2)
        .max(20)
        .regex(/^[\p{L}\p{N} _-]+$/u),
      demo: z.boolean(),
    })
    .safeParse(q.body);
  if (!parsed.success) {
    r.status(400).json({ error: 'Use a nickname of 2–20 letters or numbers' });
    return;
  }
  if (parsed.data.demo && process.env.ENABLE_DEMO === 'false') {
    r.status(403).json({ error: 'Demo disabled' });
    return;
  }
  const p = await createProfile(parsed.data.name, parsed.data.demo);
  r.json({ token: token(p), profile: p });
});
app.post('/api/session/supabase', async (q, r) => {
  try {
    const v = z
      .object({ accessToken: z.string().min(10), name: z.string().trim().min(2).max(20) })
      .parse(q.body);
    r.json(await exchangeHosted(v.accessToken, v.name));
  } catch (e) {
    r.status(401).json({ error: (e as Error).message });
  }
});
app.use('/api', async (q, r, next) => {
  try {
    r.locals.player = await authenticate(q.headers.authorization?.replace('Bearer ', ''));
    next();
  } catch (e) {
    if (e instanceof SessionError) r.status(401).json({ error: 'Sign in again' });
    else next(e);
  }
});
app.get('/api/me', async (_q, r) => {
  const p = (await profile(r.locals.player.id))!;
  r.json({
    profile: p,
    identity: (await isHosted(p.id)) ? 'supabase' : 'local-guest',
    badges: await badges(p.id),
    history: await history(p.id),
    wallet: await walletIdentity(p.id),
    web3: await web3Inventory(p.id),
    campaign: await campaignProgress(p.id),
    squad: await currentSquad(p.id, p.demo),
    avatar: await readAvatar(p.id),
    age: await eligibility(p.id),
    friendCode: friendCode(p.id),
  });
});
app.post('/api/session/logout', async (q, r) => {
  await revokeSession(q.headers.authorization!.replace('Bearer ', ''));
  r.json({ signedOut: true });
});
app.get('/api/results/:id/proof', async (q, r) => {
  const proof = await resultProof(q.params.id, r.locals.player.id);
  if (!proof) {
    r.status(404).json({ error: 'Result not found in your match history' });
    return;
  }
  r.json(proof);
});
app.post('/api/results/:id/retry', async (q, r) => {
  const proof = await resultProof(q.params.id, r.locals.player.id);
  if (!proof) {
    r.status(404).json({ error: 'Result not found' });
    return;
  }
  if (
    process.env.ALLOW_CHAIN_BROADCAST !== 'true' ||
    proof.simulated ||
    proof.status !== 'failed'
  ) {
    r.status(409).json({ error: 'Only failed live testnet submissions can be retried' });
    return;
  }
  await db
    .prepare(
      "UPDATE outbox SET attempts=0,status='pending',error=NULL WHERE match_id=? AND status='failed'",
    )
    .run(q.params.id);
  r.json({ status: 'pending' });
});
app.post('/api/wallet/nonce', async (q, r) => {
  try {
    checkWalletOrigin(q.headers.origin);
    const { address } = z
      .object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) })
      .parse(q.body);
    r.json(await issueWalletChallenge(r.locals.player.id, address as Address));
  } catch (e) {
    r.status(e instanceof WalletLinkError ? e.status : 400).json({ error: (e as Error).message });
  }
});
app.post('/api/wallet/bind', async (q, r) => {
  try {
    checkWalletOrigin(q.headers.origin);
    const { address, signature } = z
      .object({
        address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
      })
      .parse(q.body);
    const wallet = await bindWallet(r.locals.player.id, address as Address, signature as Hex);
    r.json({ verified: true, ...wallet });
  } catch (e) {
    r.status(e instanceof WalletLinkError ? e.status : 400).json({ error: (e as Error).message });
  }
});
registerHostedRoutes(app);
registerCustomization(app);
registerWeb3Routes(app);
registerSocialRoutes(app);
registerTournamentRoutes(app);
app.get('/api/live', (_q, r) => {
  r.json(liveMatches(!!r.locals.player.demo));
});
app.put('/api/armor', async (q, r) => {
  const { armor } = z.object({ armor: z.enum(armorSets) }).parse(q.body);
  const p = (await profile(r.locals.player.id))!;
  if (armor !== 'standard' && !p.progress.armor?.includes(armor)) {
    r.status(403).json({ error: 'Complete the Royal Gathering to unlock this armor.' });
    return;
  }
  p.progress.equipped = armor;
  await saveProfile(p);
  r.json({ progress: p.progress });
});
app.get('/api/campaign', async (_q, r) => {
  const p = r.locals.player;
  r.json({ progress: await campaignProgress(p.id), missions: MISSIONS, demoOrder: DEMO_MISSIONS });
});
app.get('/api/pass/:id', async (q, r) => {
  const s = (await db
    .prepare('SELECT * FROM squads WHERE id=? AND demo=?')
    .get(q.params.id, r.locals.player.demo)) as any;
  if (!s || !JSON.parse(s.members).includes(r.locals.player.id)) {
    r.status(403).json({ error: 'Sign in as a member of this squad to view the pass' });
    return;
  }
  r.json({
    ...s,
    members: await Promise.all(
      JSON.parse(s.members).map(async (id: string) => ({ id, name: (await profile(id))?.name })),
    ),
    passId: 'royal-' + s.id,
    claimed: s.wins >= (s.demo ? 1 : 2) && s.rating >= (s.demo ? 0 : 1100),
    redeemed: false,
    redeemable: false,
  });
});
app.get('/api/leaderboard', async (_q, r) => {
  r.json(await leaderboard(r.locals.player.demo));
});
app.post('/api/squad', async (q, r) => {
  const result = await db.transaction(async () => {
    const p = r.locals.player;
    const existing = (await db.prepare('SELECT * FROM squads WHERE demo=?').all(p.demo)) as any[];
    let squad: any;
    if (typeof q.body.code === 'string') {
      squad = existing.find((s) => s.code === q.body.code.toUpperCase());
      if (!squad) {
        r.status(404).json({ error: 'Invite code not found' });
        return;
      }
      const members = JSON.parse(squad.members);
      if (!members.includes(p.id)) {
        if (members.length >= 4) {
          r.status(409).json({ error: 'Squad is full' });
          return;
        }
        await assertParty([...members, p.id]);
        members.push(p.id);
        squad.members = JSON.stringify(members);
        await db.transaction(async () => {
          for (const previous of existing) {
            if (previous.id !== squad.id && JSON.parse(previous.members).includes(p.id)) {
              const remaining = JSON.parse(previous.members).filter((id: string) => id !== p.id);
              await db
                .prepare('UPDATE squads SET members=? WHERE id=?')
                .run(JSON.stringify(remaining), previous.id);
            }
          }
          await db.prepare('UPDATE squads SET members=? WHERE id=?').run(squad.members, squad.id);
        })();
      }
    } else {
      squad = existing.find((s) => JSON.parse(s.members).includes(p.id));
      if (!squad) {
        squad = {
          id: randomUUID(),
          code: randomUUID().slice(0, 6).toUpperCase(),
          name: p.name + '’s Four Banners',
          demo: p.demo,
          members: JSON.stringify([p.id]),
        };
        await db
          .prepare('INSERT INTO squads(id,code,name,demo,members) VALUES (?,?,?,?,?)')
          .run(squad.id, squad.code, squad.name, squad.demo, squad.members);
      }
    }
    return {
      ...squad,
      members: await Promise.all(
        JSON.parse(squad.members).map(async (id: string) => ({
          id,
          name: (await profile(id))?.name,
        })),
      ),
    };
  })();
  if (result) {
    notifyTeamMembershipChanged(r.locals.player.id);
    r.json(result);
  }
});
app.post('/api/gathering/demo', async (q, r) => {
  const p = (await profile(r.locals.player.id))!;
  if (!p.demo) {
    r.status(403).json({ error: 'Simulated gathering is demo-only' });
    return;
  }
  if (p.progress.squadWins < 1 && !(await campaignProgress(p.id)).completed.includes(8)) {
    r.status(403).json({ error: 'Win Banner Conquest first' });
    return;
  }
  const squad = (await db
    .prepare('SELECT * FROM squads WHERE id=? AND demo=1')
    .get(q.body.squadId)) as any;
  if (!squad || !JSON.parse(squad.members).includes(p.id)) {
    r.status(403).json({ error: 'Squad membership required' });
    return;
  }
  const id = randomUUID(),
    metadata = {
      id,
      squadId: squad.id,
      simulated: true,
      approvals: [p.id, 'demo-bot-1', 'demo-bot-2', 'demo-bot-3'],
      at: new Date().toISOString(),
    };
  const hash = digest(metadata);
  await db.transaction(async () => {
    await db
      .prepare('INSERT INTO gatherings VALUES (?,?,?,?,?)')
      .run(id, squad.id, JSON.stringify(metadata.approvals), 1, hash);
    p.progress.stage = 3;
    await saveProfile(p);
    const campaign = await campaignProgress(p.id);
    campaign.fellowship = true;
    await saveCampaign(p.id, campaign);
    await issueBadge(p.id, 'Proof of Fellowship', id);
  })();
  r.json({ hash, simulated: true });
});
app.post('/api/demo/reset', async (_q, r) => {
  const p = r.locals.player;
  if (!p.demo) {
    r.status(403).json({ error: 'Demo only' });
    return;
  }
  const n = await createProfile(p.name, true);
  r.json({ token: token(n), profile: n });
});
// Single-service deploys (Render) serve the built web app from the same origin as the API and
// WebSocket. Colyseus answers /matchmake before Express, so only /api must stay out of the fallback.
const web = fileURLToPath(new URL('../../web/dist', import.meta.url));
if (existsSync(join(web, 'index.html'))) {
  app.use(
    express.static(web, {
      index: false,
      setHeaders: (r, file) => {
        if (/[\\/]assets[\\/].+-[\w-]{8}\.(js|css)$/.test(file))
          r.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }),
  );
  app.get(/^(?!\/api(?:\/|$)).*/, (_q, r) => {
    r.setHeader('Cache-Control', 'no-cache');
    r.sendFile(join(web, 'index.html'));
  });
}
app.use((err: Error, _q: express.Request, r: express.Response, _n: express.NextFunction) => {
  const status =
    err.name === 'ZodError'
      ? 400
      : Math.max(400, Math.min(599, Number((err as any).status) || 500));
  console.error('Request', r.getHeader('X-Request-ID'), err.name);
  r.status(status).json({
    error:
      status === 400
        ? 'Check the submitted fields and try again.'
        : status < 500
          ? err.message
          : 'Server operation failed. Please retry or quote the request ID.',
    code: 'SERVER_ERROR',
    requestId: r.getHeader('X-Request-ID'),
  });
});
const http = createServer(app);
// Long enough for a 5 MB ID or selfie upload on a slow mobile connection.
http.requestTimeout = 60000;
const server = new GuardedGameServer({ transport: new SharedGameTransport(http) });
const io = registerTeamChat(http);
registerNotifySocket(io);
registerSpectators(io);
server
  .define('battle', BattleRoom)
  .filterBy(['mode', 'demo', 'squadId', 'ageBand', 'tournamentId', 'matchKey']);
server.define('conquest', BattleRoom, { mode: 'squad' }).filterBy(['demo', 'ageBand']);
server.define('quest', BattleRoom, { mode: 'quest' }).filterBy(['demo', 'squadId', 'ageBand']);
server.define('squad-lobby', SquadLobby).filterBy(['squadId', 'ageBand']);
server
  .define('campaign', CampaignRoom)
  .filterBy(['demo', 'missionId', 'squadId', 'protocol', 'ageBand']);
if (process.env.ALLOW_CHAIN_BROADCAST === 'true') {
  const adapter = new BaseAttestation();
  const rewards = baseRewardsAdapter();
  setInterval(() => {
    void (async () => {
      await processOutbox(adapter);
      await processWeb3Jobs(rewards);
    })().catch((e: Error) => console.error('Web3 worker:', e.name));
  }, 15000).unref();
}
setInterval(() => {
  void syncHosted().catch((e) => console.error('Hosted sync:', e.message));
}, 5000).unref();
if (supabase)
  setInterval(() => {
    void processMediaDeletions(supabase!).catch((e: Error) =>
      console.error('Private media cleanup:', e.name),
    );
  }, 30000).unref();
const port = Number(process.env.PORT ?? 2567);
await checkDatabase();
await server.listen(port);
console.log(`Aksumara authoritative server :${port}`);
