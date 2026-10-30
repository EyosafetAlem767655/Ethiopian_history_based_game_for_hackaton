import { Server, matchMaker } from '@colyseus/core';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { authenticate } from './store';

const maxBody = 16 * 1024;
const limits = new Map<string, { n: number; until: number }>();
function consume(key: string, maximum: number) {
  const now = Date.now();
  if (limits.size > 10000)
    for (const [id, entry] of limits) if (entry.until <= now) limits.delete(id);
  if (limits.size >= 10000 && !limits.has(key)) return false;
  const entry = limits.get(key);
  if (!entry || entry.until <= now) {
    limits.set(key, { n: 1, until: now + 60000 });
    return true;
  }
  return ++entry.n <= maximum;
}
function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts: Buffer[] = [];
    const finish = (error?: Error) => {
      clearTimeout(timer);
      req.off('data', data);
      req.off('end', end);
      req.off('aborted', aborted);
      req.off('error', failed);
      if (error) {
        req.resume();
        reject(error);
      }
    };
    const failed = () => finish(Error('Request interrupted'));
    const aborted = () => finish(Error('Request interrupted'));
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBody)
        finish(Object.assign(Error('Matchmaking request too large'), { status: 413 }));
      else parts.push(chunk);
    };
    const end = () => {
      finish();
      try {
        resolve(JSON.parse(Buffer.concat(parts).toString()));
      } catch {
        reject(Object.assign(Error('Invalid matchmaking request'), { status: 400 }));
      }
    };
    const timer = setTimeout(
      () => finish(Object.assign(Error('Matchmaking request timed out'), { status: 408 })),
      5000,
    );
    req.on('data', data);
    req.once('end', end);
    req.once('aborted', aborted);
    req.once('error', failed);
  });
}

/** Colyseus routes run before Express; enforce their controls at that actual boundary. */
export class GuardedGameServer extends Server {
  protected async handleMatchMakeRequest(req: IncomingMessage, res: ServerResponse) {
    const send = (status: number, data: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    };
    res.setHeader('Cache-Control', 'no-store');
    const origin = req.headers.origin;
    const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim());
    if (origin && !origins.includes(origin)) {
      let same = false;
      try {
        const parsed = new URL(origin);
        same =
          ['https:', 'http:'].includes(parsed.protocol) &&
          parsed.origin === origin &&
          parsed.host === req.headers.host;
      } catch {}
      if (!same) {
        req.resume();
        send(403, { error: 'Game origin not allowed' });
        return;
      }
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      req.resume();
      send(404, { error: 'Matchmaking route not found' });
      return;
    }
    const forwarded = req.headers['x-forwarded-for'];
    const ip =
      process.env.NODE_ENV === 'production' && typeof forwarded === 'string'
        ? forwarded.split(',').at(-1)!.trim()
        : (req.socket.remoteAddress ?? 'local');
    if (!consume('ip:' + ip, 120)) {
      req.resume();
      send(429, { error: 'Too many matchmaking requests' });
      return;
    }
    if (Number(req.headers['content-length'] ?? 0) > maxBody) {
      req.resume();
      send(413, { error: 'Matchmaking request too large' });
      return;
    }
    try {
      const path = new URL(req.url!, 'http://localhost').pathname.match(
        /^\/matchmake\/(joinOrCreate|create|join|joinById|reconnect)\/([A-Za-z0-9_-]+)$/,
      );
      if (!path) {
        req.resume();
        send(404, { error: 'Matchmaking route not found' });
        return;
      }
      const options = await readBody(req);
      if (!options || typeof options !== 'object' || Array.isArray(options)) {
        send(400, { error: 'Invalid matchmaking options' });
        return;
      }
      const bearer =
        req.headers.authorization?.replace(/^Bearer /, '') ??
        (options as { token?: unknown }).token;
      // Reconnect carries its own opaque room reservation secret; the room then
      // revalidates the original game credential before restoring control.
      if (path[1] !== 'reconnect') {
        let p;
        try {
          p = await authenticate(bearer);
        } catch {
          send(401, { error: 'Sign in before entering the arena' });
          return;
        }
        if (!consume('player:' + p.id, 20)) {
          send(429, { error: 'Too many arena entries. Please wait.' });
          return;
        }
      }
      const result = await matchMaker.controller.invokeMethod(path[1], path[2], options, {
        token: typeof bearer === 'string' ? bearer : undefined,
        headers: req.headers,
        ip,
      });
      send(200, result);
    } catch (e) {
      const error = e as Error & { status?: number; code?: number };
      send(error.status ?? 400, { error: error.message, code: error.code });
    }
  }
}
