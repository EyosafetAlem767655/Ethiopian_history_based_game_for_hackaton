import { spawn, type ChildProcess } from 'node:child_process';
const children: ChildProcess[] = [];
function start(args: string[], env: NodeJS.ProcessEnv) {
  const p = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: 'inherit' });
  children.push(p);
  return p;
}
const backend = {
  PORT: '2574',
  PERSISTENCE: 'sqlite',
  DB_PATH: ':memory:',
  SUPABASE_DB_URL: '',
  SUPABASE_URL: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
  SUPABASE_SECRET_KEY: '',
  CORS_ORIGINS: 'http://localhost:5175',
  NODE_ENV: 'test',
};
try {
  start(['--import', 'tsx', 'apps/server/src/index.ts'], backend);
  start(
    [
      'node_modules/vite/bin/vite.js',
      '--host',
      '127.0.0.1',
      '--port',
      '5175',
      '--strictPort',
      'apps/web',
    ],
    {
      VITE_API_URL: 'http://localhost:2574',
      VITE_WS_URL: 'ws://localhost:2574',
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
      VITE_SUPABASE_PUBLISHABLE_KEY: '',
    },
  );
  for (const url of ['http://localhost:2574/api/health', 'http://localhost:5175']) {
    const deadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(url)).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!ready) throw Error('Load-test server failed to start: ' + url);
  }
  const result = start(['--import', 'tsx', 'scripts/load.ts'], {
    TEST_API: 'http://localhost:2574',
    TEST_WEB: 'http://localhost:5175',
  });
  const code = await new Promise<number>((resolve, reject) => {
    result.once('exit', (c) => resolve(c ?? 1));
    result.once('error', reject);
  });
  if (code) throw Error('Load test failed');
} finally {
  for (const child of children) child.kill();
}
