import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, endpoints, readResponse, requestJSON } from '../apps/web/src/services/http';
afterEach(() => vi.unstubAllGlobals());
it('reads JSON and preserves backend errors and diagnostic references', async () => {
  expect(
    await readResponse(
      new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } }),
    ),
  ).toEqual({ ok: true });
  await expect(
    readResponse(
      new Response('{"error":"Sign in again"}', {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'request-123' },
      }),
    ),
  ).rejects.toMatchObject({
    status: 401,
    requestId: 'request-123',
    message: expect.stringContaining('Sign in again'),
  });
});
it.each([
  ['', 'application/json', 'EMPTY_RESPONSE'],
  ['<html>SPA</html>', 'text/html', 'INVALID_RESPONSE'],
  ['{"ok":', 'application/json', 'INVALID_JSON'],
])('handles unusable API body %s', async (body, type, code) => {
  await expect(
    readResponse(new Response(body, { headers: { 'Content-Type': type } })),
  ).rejects.toMatchObject({ code });
});
it('rejects absent or insecure production endpoints and permits local development', () => {
  const production = { dev: false, hostname: 'game.vercel.app', protocol: 'https:' };
  expect(endpoints({ ...production, host: 'game.onrender.com' })).toEqual({
    api: '',
    ws: 'wss://game.onrender.com',
  });
  expect(() => endpoints({ ...production, protocol: 'http:' })).toThrow('HTTPS');
  expect(() => endpoints({ ...production, api: 'http://localhost:2567' })).toThrow('HTTPS');
  expect(() => endpoints({ ...production, api: 'https://game.up.railway.app', ws: '' })).toThrow(
    'VITE_WS_URL',
  );
  expect(endpoints({ ...production, api: 'https://game.up.railway.app/' }).ws).toBe(
    'wss://game.up.railway.app',
  );
  expect(endpoints({ dev: true, hostname: 'localhost', protocol: 'http:' }).api).toBe('');
});
it('times out a stalled server and distinguishes network failures', async () => {
  vi.stubGlobal(
    'fetch',
    (_url: string, o: RequestInit) =>
      new Promise((_resolve, reject) =>
        o.signal!.addEventListener('abort', () => reject(new Error('abort'))),
      ),
  );
  await expect(requestJSON('https://example.test', {}, 10)).rejects.toMatchObject({
    code: 'TIMEOUT',
  });
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
  await expect(requestJSON('https://example.test')).rejects.toBeInstanceOf(ApiError);
});
import { readFileSync } from 'node:fs';
it('keeps vision models and APIs outside the Vercel SPA fallback', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const fallback = new RegExp('^' + config.rewrites[0].source + '$');
  for (const path of [
    '/api/health',
    '/vision/face_landmarker.task',
    '/vision/wasm/vision_wasm_internal.wasm',
    '/vision/ocr/eng.traineddata.gz',
    '/assets/rig-v3.png',
  ])
    expect(fallback.test(path)).toBe(false);
  expect(fallback.test('/journey')).toBe(true);
});
