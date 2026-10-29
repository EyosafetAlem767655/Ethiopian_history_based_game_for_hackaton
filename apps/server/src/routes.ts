import type { Express } from 'express';
// Express 4 does not forward rejected async handlers to error middleware itself.
export function asyncRoutes(app: Express) {
  for (const method of ['get', 'post', 'put', 'delete', 'use'] as const) {
    const original = (app[method] as any).bind(app);
    (app as any)[method] = (...args: any[]) =>
      original(
        ...args.map((arg) =>
          typeof arg === 'function' && arg.length < 4
            ? (q: any, r: any, next: any) => {
                try {
                  Promise.resolve(arg(q, r, next)).catch(next);
                } catch (e) {
                  next(e);
                }
              }
            : arg,
        ),
      );
  }
}
