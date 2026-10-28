import { create } from 'zustand';
import type { World, Progress } from '../../../packages/shared/src/game';
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
  set: (v: Partial<UIState>) => void;
}
export const useUI = create<UIState>((set) => ({
  session: initial,
  hero: initial?.profile.hero ?? 0,
  snapshot: null,
  me: null,
  error: '',
  muted: true,
  set,
}));
export function saveSession(s: Session) {
  localStorage.setItem('knights-session', JSON.stringify(s));
  useUI.setState({ session: s });
}
export const API = import.meta.env.VITE_API_URL ?? '';
export async function api(path: string, body?: unknown) {
  const res = await fetch(API + '/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (useUI.getState().session?.token ?? ''),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw Error(data.error ?? 'Request failed');
  return data;
}
