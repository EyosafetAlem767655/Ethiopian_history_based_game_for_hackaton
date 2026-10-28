import { create } from 'zustand';
import type { World, Progress } from '../../../packages/shared/src/game';
import { endpoints, requestJSON, ApiError } from './services/http';
export interface Session {
  token: string;
  profile: { id: string; name: string; demo: number; hero: number; progress: Progress };
}
let initial: Session | null = null;
try {
  initial = JSON.parse(localStorage.getItem('knights-session') ?? 'null');
} catch {
  /* fresh session */
}
interface UIState {
  session: Session | null;
  hero: number;
  snapshot: World | null;
  me: any;
  error: string;
  muted: boolean;
  volume: number;
  reducedMotion: boolean;
  set: (v: Partial<UIState>) => void;
}
export const useUI = create<UIState>((set) => ({
  session: initial,
  hero: initial?.profile.hero ?? 0,
  snapshot: null,
  me: null,
  error: '',
  muted: localStorage.getItem('kibre-muted') === 'true',
  volume: Number(localStorage.getItem('kibre-volume') ?? '.65'),
  reducedMotion:
    localStorage.getItem('kibre-motion') === 'reduced' ||
    matchMedia('(prefers-reduced-motion: reduce)').matches,
  set,
}));
useUI.subscribe((s, p) => {
  if (s.muted !== p.muted) localStorage.setItem('kibre-muted', String(s.muted));
  if (s.volume !== p.volume) localStorage.setItem('kibre-volume', String(s.volume));
  if (s.reducedMotion !== p.reducedMotion)
    localStorage.setItem('kibre-motion', s.reducedMotion ? 'reduced' : 'full');
});
export function saveSession(s: Session) {
  localStorage.setItem('knights-session', JSON.stringify(s));
  useUI.setState({ session: s });
}
// Read-only development diagnostics avoid importing a second HMR store in browser tests.
declare global {
  interface Window {
    __kibreInspect?: () => { world: World | null; id: string | undefined };
  }
}
if (import.meta.env.DEV)
  window.__kibreInspect = () => ({
    world: structuredClone(useUI.getState().snapshot),
    id: useUI.getState().session?.profile.id,
  });
export const API = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');
export function connection() {
  return endpoints({
    dev: import.meta.env.DEV,
    api: API,
    ws: import.meta.env.VITE_WS_URL,
    hostname: location.hostname,
    protocol: location.protocol,
  });
}
export async function api(path: string, body?: unknown) {
  const config = connection();
  try {
    return await requestJSON(config.api + '/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (useUI.getState().session?.token ?? ''),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      localStorage.removeItem('knights-session');
      useUI.setState({ session: null, me: null });
    }
    throw e;
  }
}
