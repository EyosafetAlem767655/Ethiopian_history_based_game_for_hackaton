import { createClient } from '@supabase/supabase-js';
import { api, saveSession } from './store';
import { useUI } from './store';
const url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
export const hostedAuth = url && key ? createClient(url, key) : null;
export async function signInEmail(email: string) {
  if (!hostedAuth) throw Error('Hosted authentication is not configured');
  const { error } = await hostedAuth.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin },
  });
  if (error) throw error;
  localStorage.removeItem('knights-signed-out');
}
export async function resumeHosted() {
  if (!hostedAuth) return false;
  if (localStorage.getItem('knights-signed-out') && !location.hash.includes('access_token'))
    return false;
  const { data } = await hostedAuth.auth.getSession();
  if (!data.session) return false;
  const name =
    localStorage.getItem('knights-hosted-name') ??
    data.session.user.email?.split('@')[0] ??
    'Warrior';
  saveSession(await api('/session/supabase', { accessToken: data.session.access_token, name }));
  return true;
}
export async function signOutIdentity() {
  // Do not report server logout as complete until the bearer has been revoked.
  await api('/session/logout', {});
  localStorage.setItem('knights-signed-out', 'true');
  localStorage.removeItem('knights-session');
  useUI.setState({ session: null, me: null, snapshot: null });
  const result = await hostedAuth?.auth.signOut();
  if (result?.error)
    throw Error(
      'Game session ended. Email-provider sign-out failed; automatic sign-in is disabled on this device.',
    );
}
