import { supabase } from './supabase';
import type { Session, AuthError } from '@supabase/supabase-js';

const SESSION_STORAGE_KEY = 'noteflow_auth_session';
const LEGACY_SESSION_STORAGE_KEY = 'flow2note_auth_session';

/** Restore a persisted session from chrome.storage.local */
export async function restoreSession(): Promise<{ session: Session | null; error: AuthError | null }> {
  try {
    const result = await chrome.storage.local.get([SESSION_STORAGE_KEY, LEGACY_SESSION_STORAGE_KEY]);
    const sessionData = result[SESSION_STORAGE_KEY] || result[LEGACY_SESSION_STORAGE_KEY];
    if (!sessionData) return { session: null, error: null };

    // Validate expiry
    const expiresAt = sessionData.expires_at ? sessionData.expires_at * 1000 : 0;
    if (Date.now() >= expiresAt) {
      // Session expired — try to refresh
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session) {
        await chrome.storage.local.remove([SESSION_STORAGE_KEY, LEGACY_SESSION_STORAGE_KEY]);
        return { session: null, error };
      }
      await persistSession(data.session);
      return { session: data.session, error: null };
    }

    // Restore session
    const { data, error } = await supabase.auth.setSession({
      access_token: sessionData.access_token,
      refresh_token: sessionData.refresh_token,
    });

    if (error || !data.session) {
      await chrome.storage.local.remove([SESSION_STORAGE_KEY, LEGACY_SESSION_STORAGE_KEY]);
      return { session: null, error };
    }

    if (result[LEGACY_SESSION_STORAGE_KEY] && !result[SESSION_STORAGE_KEY]) {
      await persistSession(data.session);
      await chrome.storage.local.remove(LEGACY_SESSION_STORAGE_KEY);
    }

    return { session: data.session, error: null };
  } catch {
    return { session: null, error: null };
  }
}

/** Persist session to chrome.storage.local */
async function persistSession(session: Session): Promise<void> {
  await chrome.storage.local.set({
    [SESSION_STORAGE_KEY]: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      user: {
        id: session.user.id,
        email: session.user.email,
        avatar_url: session.user.user_metadata?.avatar_url,
        name: session.user.user_metadata?.full_name || session.user.user_metadata?.name,
      },
    },
  });
  await chrome.storage.local.remove(LEGACY_SESSION_STORAGE_KEY);
}

/** Sign up with email & password */
export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (data.session) await persistSession(data.session);
  return { data, error };
}

/** Sign in with email & password */
export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (data.session) await persistSession(data.session);
  return { data, error };
}

/** Sign in with Google via Chrome Identity API */
export async function signInWithGoogle(): Promise<{ data: { session: Session | null } | null; error: string | null }> {
  try {
    // Get OAuth URL from Supabase
    const { data: urlData, error: urlError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        skipBrowserRedirect: true, // We'll handle the redirect ourselves
      },
    });

    if (urlError || !urlData?.url) return { data: null, error: urlError?.message || 'Failed to get auth URL' };

    // Launch OAuth flow via Chrome identity API
    const redirectUrl = await chrome.identity.launchWebAuthFlow({
      url: urlData.url,
      interactive: true,
    });

    if (!redirectUrl) return { data: null, error: 'User cancelled the login flow' };

    // Exchange the redirect URL for a session
    const { data, error } = await supabase.auth.exchangeCodeForSession(redirectUrl);
    if (error) return { data: null, error: error.message };

    if (data.session) await persistSession(data.session);
    return { data, error: null };
  } catch (err) {
    return { data: null, error: String(err) };
  }
}

/** Sign out */
export async function signOut() {
  await chrome.storage.local.remove([SESSION_STORAGE_KEY, LEGACY_SESSION_STORAGE_KEY]);
  await supabase.auth.signOut();
}

/** Get current user info from storage (fast, no network) */
export async function getCachedUser(): Promise<{
  id: string;
  email: string | undefined;
  avatar_url: string | undefined;
  name: string | undefined;
} | null> {
  try {
    const result = await chrome.storage.local.get([SESSION_STORAGE_KEY, LEGACY_SESSION_STORAGE_KEY]);
    return result[SESSION_STORAGE_KEY]?.user || result[LEGACY_SESSION_STORAGE_KEY]?.user || null;
  } catch {
    return null;
  }
}
