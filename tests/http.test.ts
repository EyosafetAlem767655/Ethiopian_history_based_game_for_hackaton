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
  expect(() => endpoints(production)).toThrow('not configured');
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
it('gives startup instructions for an unreachable local API only', async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
  await expect(requestJSON('/api/session')).rejects.toMatchObject({
    code: 'NETWORK_ERROR',
    message: expect.stringContaining('npm run dev'),
  });
  await expect(requestJSON('https://example.test/api/session')).rejects.toMatchObject({
    code: 'NETWORK_ERROR',
    message: expect.not.stringContaining('npm run dev'),
  });
});
