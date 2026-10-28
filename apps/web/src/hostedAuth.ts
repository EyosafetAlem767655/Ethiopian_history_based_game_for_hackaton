import { createClient } from '@supabase/supabase-js';
import { api, saveSession } from './store';
const url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const hostedAuth = url && key ? createClient(url, key) : null;
export async function signInEmail(email: string) {
  if (!hostedAuth) throw Error('Hosted authentication is not configured');
  const { error } = await hostedAuth.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin },
  });
  if (error) throw error;
}
export async function resumeHosted() {
  if (!hostedAuth) return false;
  const { data } = await hostedAuth.auth.getSession();
  if (!data.session) return false;
  const name =
    localStorage.getItem('knights-hosted-name') ??
    data.session.user.email?.split('@')[0] ??
    'Warrior';
  saveSession(await api('/session/supabase', { accessToken: data.session.access_token, name }));
  return true;
}
