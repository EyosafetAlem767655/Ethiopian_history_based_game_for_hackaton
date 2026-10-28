import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
it('retains signed identity, result hash and progression after process restart', () => {
  mkdirSync('output/tests', { recursive: true });
  const path = `output/tests/restart-${randomUUID()}.sqlite`;
  const common = { ...process.env, DB_PATH: path };
  const seed = spawnSync(
    'node',
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `import {createProfile,token,recordResult} from './apps/server/src/store.ts';import {world,fighter} from './packages/shared/src/game.ts';const p=createProfile('Persistent',true),w=world('duel',true);w.players=[fighter(p.id,p.name)];w.winner=0;recordResult('restart',w,new Date().toISOString());console.log(JSON.stringify({token:token(p),id:p.id}));`,
    ],
    { env: common, encoding: 'utf8', timeout: 60000 },
  );
  expect(seed.status, seed.stderr).toBe(0);
  const session = JSON.parse(seed.stdout.trim());
  const load = spawnSync(
    'node',
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `import {authenticate,history} from './apps/server/src/store.ts';const p=authenticate(process.env.RESTART_TOKEN);console.log(JSON.stringify({id:p.id,wins:p.progress.wins,hash:history(p.id)[0].hash}));`,
    ],
    { env: { ...common, RESTART_TOKEN: session.token }, encoding: 'utf8', timeout: 60000 },
  );
  expect(load.status, load.stderr).toBe(0);
  const data = JSON.parse(load.stdout.trim());
  expect(data.id).toBe(session.id);
  expect(data.wins).toBe(1);
  expect(data.hash).toMatch(/^0x[0-9a-f]{64}$/);
}, 120000);
