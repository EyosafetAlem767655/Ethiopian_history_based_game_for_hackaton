import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from '@colyseus/core';
import { SharedGameTransport } from './transport';
import { currentSquad, registerTeamChat } from './chat';
import { z } from 'zod';
import type { Address, Hex } from 'viem';
import {
  bindWallet,
  checkWalletOrigin,
  issueWalletChallenge,
  walletIdentity,
  WalletLinkError,
} from './wallet';
import { registerHostedRoutes, exchangeHosted, isHosted, syncHosted } from './hosted';
import { BaseAttestation, processOutbox } from './attestation';
import { BattleRoom } from './room';
import { SquadLobby } from './lobby';
import { resultProof } from './result-proof';
import { leaderboard } from './leaderboard';
import { CampaignRoom } from './campaign-room';
import { MISSIONS, DEMO_MISSIONS } from '../../../packages/shared/src/missions';
import { PROTOCOL_VERSION } from '../../../packages/shared/src/presentation';
import {
  authenticate,
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
} from './store';
const app = express();
app.use((_q, r, next) => {
  r.setHeader('X-Request-ID', randomUUID());
  next();
});
app.use(
  cors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
    exposedHeaders: ['X-Request-ID'],
  }),
);
app.use(express.json({ limit: '32kb' }));
const limits = new Map<string, { n: number; time: number }>();
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
app.get('/api/health', (_q, r) =>
  r.json({
    ok: true,
    identity: 'local-guest',
    persistence: 'sqlite',
    blockchain:
      process.env.ALLOW_CHAIN_BROADCAST === 'true' ? 'base-sepolia-configured' : 'simulated',
    protocol: PROTOCOL_VERSION,
    tickRate: 30,
  }),
);
app.post('/api/session', (q, r) => {
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
  const p = createProfile(parsed.data.name, parsed.data.demo);
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
app.use('/api', (q, r, next) => {
  try {
    r.locals.player = authenticate(q.headers.authorization?.replace('Bearer ', ''));
    next();
  } catch {
    r.status(401).json({ error: 'Sign in again' });
  }
});
app.get('/api/me', (_q, r) => {
  const p = profile(r.locals.player.id)!;
  r.json({
    profile: p,
    identity: isHosted(p.id) ? 'supabase' : 'local-guest',
    badges: badges(p.id),
    history: history(p.id),
    wallet: walletIdentity(p.id),
    campaign: campaignProgress(p.id),
    squad: currentSquad(p.id, p.demo),
  });
});
app.get('/api/results/:id/proof', (q, r) => {
  const proof = resultProof(q.params.id, r.locals.player.id);
  if (!proof) {
    r.status(404).json({ error: 'Result not found in your match history' });
    return;
  }
  r.json(proof);
});
app.post('/api/wallet/nonce', (q, r) => {
  try {
    checkWalletOrigin(q.headers.origin);
    const { address } = z
      .object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) })
      .parse(q.body);
    r.json(issueWalletChallenge(r.locals.player.id, address as Address));
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
app.get('/api/campaign', (_q, r) => {
  const p = r.locals.player;
  r.json({ progress: campaignProgress(p.id), missions: MISSIONS, demoOrder: DEMO_MISSIONS });
});
app.get('/api/pass/:id', (q, r) => {
  const s = db
    .prepare('SELECT * FROM squads WHERE id=? AND demo=?')
    .get(q.params.id, r.locals.player.demo) as any;
  if (!s || !JSON.parse(s.members).includes(r.locals.player.id)) {
    r.status(403).json({ error: 'Sign in as a member of this squad to view the pass' });
    return;
  }
  r.json({
    ...s,
    members: JSON.parse(s.members).map((id: string) => ({ id, name: profile(id)?.name })),
    passId: 'royal-' + s.id,
    claimed: s.wins >= (s.demo ? 1 : 2) && s.rating >= (s.demo ? 0 : 1100),
    redeemed: false,
    redeemable: false,
  });
});
app.get('/api/leaderboard', (_q, r) => {
  r.json(leaderboard(r.locals.player.demo));
});
app.post('/api/squad', (q, r) => {
  const p = r.locals.player;
  const existing = db.prepare('SELECT * FROM squads WHERE demo=?').all(p.demo) as any[];
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
      members.push(p.id);
      squad.members = JSON.stringify(members);
      db.transaction(() => {
        for (const previous of existing) {
          if (previous.id !== squad.id && JSON.parse(previous.members).includes(p.id)) {
            const remaining = JSON.parse(previous.members).filter((id: string) => id !== p.id);
            db.prepare('UPDATE squads SET members=? WHERE id=?').run(
              JSON.stringify(remaining),
              previous.id,
            );
          }
        }
        db.prepare('UPDATE squads SET members=? WHERE id=?').run(squad.members, squad.id);
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
      db.prepare('INSERT INTO squads(id,code,name,demo,members) VALUES (?,?,?,?,?)').run(
        squad.id,
        squad.code,
        squad.name,
        squad.demo,
        squad.members,
      );
    }
  }
  r.json({
    ...squad,
    members: JSON.parse(squad.members).map((id: string) => ({ id, name: profile(id)?.name })),
  });
});
app.post('/api/gathering/demo', (q, r) => {
  const p = profile(r.locals.player.id)!;
  if (!p.demo) {
    r.status(403).json({ error: 'Simulated gathering is demo-only' });
    return;
  }
  if (p.progress.squadWins < 1 && !campaignProgress(p.id).completed.includes(8)) {
    r.status(403).json({ error: 'Win Banner Conquest first' });
    return;
  }
  const squad = db.prepare('SELECT * FROM squads WHERE id=? AND demo=1').get(q.body.squadId) as any;
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
  db.transaction(() => {
    db.prepare('INSERT INTO gatherings VALUES (?,?,?,?,?)').run(
      id,
      squad.id,
      JSON.stringify(metadata.approvals),
      1,
      hash,
    );
    p.progress.stage = 3;
    saveProfile(p);
    const campaign = campaignProgress(p.id);
    campaign.fellowship = true;
    saveCampaign(p.id, campaign);
    issueBadge(p.id, 'Proof of Fellowship', id);
  })();
  r.json({ hash, simulated: true });
});
app.post('/api/demo/reset', (_q, r) => {
  const p = r.locals.player;
  if (!p.demo) {
    r.status(403).json({ error: 'Demo only' });
    return;
  }
  const n = createProfile(p.name, true);
  r.json({ token: token(n), profile: n });
});
app.use((err: Error, _q: express.Request, r: express.Response, _n: express.NextFunction) => {
  console.error('Request', r.getHeader('X-Request-ID'), err.message);
  r.status(500).json({
    error: 'Server operation failed. Please retry or quote the request ID.',
    code: 'SERVER_ERROR',
    requestId: r.getHeader('X-Request-ID'),
  });
});
const http = createServer(app);
const server = new Server({ transport: new SharedGameTransport(http) });
registerTeamChat(http);
server.define('battle', BattleRoom).filterBy(['mode', 'demo', 'squadId']);
server.define('conquest', BattleRoom, { mode: 'squad' }).filterBy(['demo']);
server.define('quest', BattleRoom, { mode: 'quest' }).filterBy(['demo', 'squadId']);
server.define('squad-lobby', SquadLobby).filterBy(['squadId']);
server.define('campaign', CampaignRoom).filterBy(['demo', 'missionId', 'squadId', 'protocol']);
if (process.env.ALLOW_CHAIN_BROADCAST === 'true') {
  const adapter = new BaseAttestation();
  setInterval(() => {
    void processOutbox(adapter);
  }, 15000).unref();
}
setInterval(() => {
  void syncHosted().catch((e) => console.error('Hosted sync:', e.message));
}, 5000).unref();
const port = Number(process.env.PORT ?? 2567);
await server.listen(port);
console.log(`Aksumara authoritative server :${port}`);
