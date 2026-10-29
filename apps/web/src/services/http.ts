export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code = 'NETWORK_ERROR',
    public requestId?: string,
  ) {
    super(requestId ? `${message} (Reference: ${requestId})` : message);
    this.name = 'ApiError';
  }
}
export interface EndpointOptions {
  dev: boolean;
  api?: string;
  ws?: string;
  hostname: string;
  protocol: string;
}
export function endpoints(o: EndpointOptions) {
  const api = (o.api ?? '').trim().replace(/\/+$/, '');
  if (!o.dev && !api)
    throw new ApiError(
      'The game server is not configured. Set VITE_API_URL and VITE_WS_URL in Vercel, then redeploy.',
      0,
      'SERVER_NOT_CONFIGURED',
    );
  const ws = (
    o.ws ??
    (api
      ? api.replace(/^http/, 'ws')
      : `${o.protocol === 'https:' ? 'wss' : 'ws'}://${o.hostname}:2567`)
  )
    .trim()
    .replace(/\/+$/, '');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(o.hostname);
  if (!ws)
    throw new ApiError(
      'Configure VITE_WS_URL with the multiplayer server address.',
      0,
      'SERVER_NOT_CONFIGURED',
    );
  for (const [value, schemes] of [
    [api, ['http:', 'https:']],
    [ws, ['ws:', 'wss:']],
  ] as const) {
    if (!value) continue;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new ApiError('The configured game server address is invalid.', 0, 'INVALID_SERVER_URL');
    }
    if (
      !(schemes as readonly string[]).includes(parsed.protocol) ||
      (!o.dev &&
        !local &&
        (parsed.protocol === 'http:' ||
          parsed.protocol === 'ws:' ||
          ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)))
    )
      throw new ApiError(
        'The public game requires an HTTPS API and WSS multiplayer server.',
        0,
        'INSECURE_SERVER_URL',
      );
  }
  return { api, ws };
}
export async function readResponse<T = any>(response: Response): Promise<T> {
  const requestId = response.headers.get('x-request-id') ?? undefined;
  const text = await response.text();
  if (!text.trim())
    throw new ApiError(
      response.ok
        ? 'The game server returned an empty response. Check the backend deployment.'
        : `The game server could not complete the request (HTTP ${response.status}).`,
      response.status,
      'EMPTY_RESPONSE',
      requestId,
    );
  if (!/application\/(?:[\w.+-]*\+)?json/i.test(response.headers.get('content-type') ?? ''))
    throw new ApiError(
      response.ok
        ? 'The server address returned a webpage instead of game data. Check VITE_API_URL and deploy the Render backend.'
        : `The game server is unavailable (HTTP ${response.status}). Please try again.`,
      response.status,
      'INVALID_RESPONSE',
      requestId,
    );
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError(
      'The game server returned incomplete data. Please try again.',
      response.status,
      'INVALID_JSON',
      requestId,
    );
  }
  if (!response.ok)
    throw new ApiError(
      typeof data?.error === 'string' ? data.error : `Request failed (HTTP ${response.status})`,
      response.status,
      data?.code ?? 'REQUEST_FAILED',
      data?.requestId ?? requestId,
    );
  return data as T;
}
export async function requestJSON<T = any>(
  url: string,
  init: RequestInit = {},
  timeout = 12000,
): Promise<T> {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await readResponse<T>(await fetch(url, { ...init, signal: controller.signal }));
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(
      controller.signal.aborted
        ? 'The game server took too long to respond. Please retry.'
        : 'Cannot reach the game server. Check your connection and backend address.',
      0,
      controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
    );
  } finally {
    clearTimeout(timer);
  }
}
