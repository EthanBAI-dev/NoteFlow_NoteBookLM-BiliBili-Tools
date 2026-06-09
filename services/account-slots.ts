/**
 * Google Account Slots Service
 *
 * Multi-account detection & switching, adapted from:
 *   https://github.com/AndyShaman/add_to_NotebookLM
 *
 * Core mechanism:
 *   1. Fetch accounts.google.com/ListAccounts → get ALL signed-in accounts
 *   2. Parse postMessage(...) response → extract name/email/avatar/authuser
 *   3. User picks an account → persist authuser index in chrome.storage.local
 *   4. All NotebookLM RPC calls → append ?authuser=X (done in notebook-api.ts)
 *
 * This avoids opening any Google login/chooser pages — the browser already
 * has cookies for every account. Switching is purely a parameter change.
 */

import { getSelectedAccountIndex, setSelectedAccountIndex } from '@/lib/config';

/** A single Google account slot */
export interface GoogleAccountSlot {
  /** authuser index (0 = primary, 1, 2… — maps to ?authuser=X) */
  index: number;
  /** Display name (acc[2] in postMessage format) */
  name: string;
  /** Email address (acc[3] in postMessage format) */
  email: string;
  /** Profile photo URL (acc[4] in postMessage format) */
  photoUrl: string;
  /** Whether this session is active */
  isActive: boolean;
  /** Whether this is the default account */
  isDefault: boolean;
  /** Whether the UI considers this "currently selected" */
  detected: boolean;
  /** Last used timestamp */
  lastUsed: number;
}

const CACHED_SLOTS_KEY = 'cached_google_slots';

// Exact URL from add_to_NotebookLM — the params trigger postMessage format
const LIST_ACCOUNTS_URL =
  'https://accounts.google.com/ListAccounts?json=standard&source=ogb&md=1&cc=1&mn=1&mo=1&gpsia=1&fwput=860&listPages=1&origin=https%3A%2F%2Fwww.google.com';

// ── Storage helpers ──────────────────────────────────

export async function getCachedSlots(): Promise<GoogleAccountSlot[]> {
  const result = await chrome.storage.local.get(CACHED_SLOTS_KEY);
  const slots = result[CACHED_SLOTS_KEY];
  if (Array.isArray(slots)) {
    return (slots as GoogleAccountSlot[]).map((s) => ({
      ...s,
      detected: s.detected ?? false,
      lastUsed: s.lastUsed ?? 0,
    }));
  }
  return [];
}

export async function saveCachedSlots(slots: GoogleAccountSlot[]): Promise<void> {
  await chrome.storage.local.set({ [CACHED_SLOTS_KEY]: slots });
}

export function onSlotsChanged(
  callback: (slots: GoogleAccountSlot[]) => void,
): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>) => {
    if (changes[CACHED_SLOTS_KEY]) {
      const newSlots = changes[CACHED_SLOTS_KEY].newValue as GoogleAccountSlot[] | undefined;
      if (Array.isArray(newSlots)) callback(newSlots);
    }
  };
  chrome.storage.local.onChanged.addListener(handler);
  return () => chrome.storage.local.onChanged.removeListener(handler);
}

// ── ListAccounts parsing (adapted from add_to_NotebookLM) ──

function parsePostMessageFormat(
  text: string,
): Array<{ name: string; email: string; avatar: string; isActive: boolean; isDefault: boolean }> | null {
  try {
    const match = text.match(/postMessage\('([^']*)'\s*,\s*'https:/);
    if (!match) return null;
    const decoded = match[1]
      .replace(/\\x5b/g, '[')
      .replace(/\\x5d/g, ']')
      .replace(/\\x22/g, '"');
    const parsed = JSON.parse(decoded);
    const accounts = parsed[1] as Array<[number, unknown, string, string, string, boolean, boolean, ...unknown[]]> | undefined;
    if (!Array.isArray(accounts)) return null;
    return accounts
      .filter((acc) => acc[3] && typeof acc[3] === 'string' && acc[3].includes('@'))
      .map((acc) => ({
        name: acc[2] || '',
        email: acc[3] || '',
        avatar: acc[4] || '',
        isActive: !!acc[5],
        isDefault: !!acc[6],
      }));
  } catch {
    return null;
  }
}

function parseStartEndFormat(
  text: string,
): Array<{ name: string; email: string; avatar: string; isActive: boolean; isDefault: boolean }> | null {
  try {
    const cleanJson = JSON.parse(text.replace(/^&&&START&&&/, ''));
    const accounts = cleanJson[1] as Array<[number, string, string, string, ...unknown[]]> | undefined;
    if (!Array.isArray(accounts)) return null;
    return accounts
      .filter((acc) => acc[1] && typeof acc[1] === 'string' && acc[1].includes('@'))
      .map((acc) => ({
        name: acc[2] || '',
        email: acc[1] || '',
        avatar: acc[3] || '',
        isActive: true,
        isDefault: false,
      }));
  } catch {
    return null;
  }
}

function parseAccounts(text: string): Array<{ name: string; email: string; avatar: string; isActive: boolean; isDefault: boolean }> {
  const pm = parsePostMessageFormat(text);
  if (pm && pm.length > 0) return pm;
  const se = parseStartEndFormat(text);
  if (se && se.length > 0) return se;
  return [];
}

// ── Debug logging helpers ────────────────────────────

/** Structured debug event for tracing account slot state changes */
export interface SlotDebugEvent {
  at: number;              // timestamp
  source: string;          // trigger source identifier
  activeEmail: string | null;
  detectedIndex: number;
  totalSlots: number;
  stack: string;           // truncated stack trace
}

const DEBUG_LOG_KEY = 'dev_slots_debug_log';
const MAX_DEBUG_EVENTS = 50;

/** Log a structured debug event to storage (for DevTools inspection) */
export async function logSlotDebug(
  source: string,
  activeEmail: string | null,
  detectedIndex: number,
  totalSlots: number,
): Promise<void> {
  const event: SlotDebugEvent = {
    at: Date.now(),
    source,
    activeEmail,
    detectedIndex,
    totalSlots,
    stack: new Error().stack?.split('\n').slice(2, 5).join(' → ') || '',
  };

  // Console with structured format
  const prefix = `[🔍 AccountSlots::${source}]`;
  console.log(
    `%c${prefix}`,
    'color:#6366f1;font-weight:bold',
    `email=${activeEmail ?? 'null'} detectedIdx=${detectedIndex} total=${totalSlots}`,
    `\n  ↳ stack: ${event.stack}`,
  );

  // Persist to storage
  try {
    const result = await chrome.storage.local.get(DEBUG_LOG_KEY);
    const log: SlotDebugEvent[] = result[DEBUG_LOG_KEY] || [];
    log.push(event);
    if (log.length > MAX_DEBUG_EVENTS) log.splice(0, log.length - MAX_DEBUG_EVENTS);
    await chrome.storage.local.set({ [DEBUG_LOG_KEY]: log });
  } catch { /* best-effort */ }
}

// ── Public fetch API ─────────────────────────────────

/**
 * Fetch accounts from Google ListAccounts and cache them.
 *
 * CRITICAL: preserves the user's previously selected account index
 * (read from persisted storage) instead of always setting slot 0 as detected.
 * This prevents background syncs from reverting the user's choice.
 */
export async function fetchAndCacheAccounts(): Promise<GoogleAccountSlot[]> {
  try {
    const resp = await fetch(LIST_ACCOUNTS_URL, {
      credentials: 'include',
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      console.debug(`[AccountSlots] HTTP ${resp.status}`);
      return [];
    }
    const text = await resp.text();
    const parsed = parseAccounts(text);
    if (parsed.length === 0) {
      console.debug('[AccountSlots] No accounts parsed');
      return [];
    }

    // ── KEY FIX: read persisted selected index ──
    // This ensures background-triggered syncs respect the user's choice
    const persistedIndex = await getSelectedAccountIndex();

    const now = Date.now();
    const slots: GoogleAccountSlot[] = parsed.map((acc, idx) => ({
      index: idx,
      name: acc.name,
      email: acc.email,
      photoUrl: acc.avatar,
      isActive: acc.isActive,
      isDefault: acc.isDefault,
      // Use persisted index instead of hardcoded `idx === 0`
      detected: idx === persistedIndex,
      lastUsed: now,
    }));

    await saveCachedSlots(slots);
    logSlotDebug(
      'fetchAndCacheAccounts',
      slots.find(s => s.detected)?.email ?? null,
      persistedIndex,
      slots.length,
    );
    return slots;
  } catch (err) {
    console.debug('[AccountSlots] Fetch error:', (err as Error)?.message);
    return [];
  }
}

/**
 * Initialize account slots.
 * Three-tier fallback: direct fetch → cache → chrome.identity.
 */
export async function initializeSlots(): Promise<GoogleAccountSlot[]> {
  // Restore persisted detection from previous session
  const persistedIndex = await getSelectedAccountIndex();

  // Tier 1: Direct ListAccounts fetch
  const fresh = await fetchAndCacheAccounts();
  if (fresh.length > 0) {
    logSlotDebug('initializeSlots(tier1-fresh)', fresh.find(s => s.detected)?.email ?? null, persistedIndex, fresh.length);
    return fresh;
  }

  // Tier 2: Existing cache
  const cached = await getCachedSlots();
  if (cached.length > 0) {
    const restored = cached.find((s) => s.index === persistedIndex);
    if (restored) {
      cached.forEach((s) => (s.detected = s.index === persistedIndex));
      if (restored) restored.lastUsed = Date.now();
    } else if (cached[0]) {
      cached[0].detected = true;
    }
    await saveCachedSlots(cached);
    logSlotDebug('initializeSlots(tier2-cache)', cached.find(s => s.detected)?.email ?? null, persistedIndex, cached.length);
    return cached;
  }

  // Tier 3: chrome.identity (single account only)
  try {
    const userInfo = await new Promise<chrome.identity.UserInfo>((resolve, reject) => {
      chrome.identity.getProfileUserInfo((info) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(info);
      });
    });
    if (userInfo?.email) {
      const fallback: GoogleAccountSlot[] = [{
        index: 0,
        name: userInfo.email.split('@')[0] || userInfo.email,
        email: userInfo.email,
        photoUrl: `https://lh3.googleusercontent.com/a-/AOh14G${hashEmail(userInfo.email)}=s96-c`,
        isActive: true,
        isDefault: true,
        detected: true,
        lastUsed: Date.now(),
      }];
      await saveCachedSlots(fallback);
      logSlotDebug('initializeSlots(tier3-identity)', userInfo.email, 0, 1);
      return fallback;
    }
  } catch { /* no identity */ }

  logSlotDebug('initializeSlots(empty)', null, 0, 0);
  return [];
}

// ── Avatar fallback ──────────────────────────────────

/** Generate initials avatar (data URI) */
export function getInitialsAvatar(nameOrEmail: string): string {
  const initial = nameOrEmail.trim().charAt(0).toUpperCase() || '?';
  const colors = ['#4F46E5', '#7C3AED', '#2563EB', '#059669', '#D97706', '#DC2626', '#0891B2', '#DB2777'];
  const idx = Math.abs(hashEmail(nameOrEmail).charCodeAt(0) || 0) % colors.length;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
    <circle cx="48" cy="48" r="48" fill="${colors[idx]}"/>
    <text x="48" y="54" text-anchor="middle" fill="white" font-size="36" font-family="Inter,sans-serif" font-weight="600">${initial}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function hashEmail(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = ((hash << 5) - hash) + email.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(12, '0');
}

// ── Account switching (THE FIX: persist index, NO page navigation) ──

/**
 * Switch to a different Google account.
 *
 * This is the core fix: instead of opening Google's AccountChooser
 * (which always defaults to account 0), we simply persist the
 * selected authuser index. The browser already has cookies for
 * ALL accounts — all subsequent NotebookLM RPC calls will use
 * the ?authuser=X parameter to pick the right one.
 *
 * @param email - The target account email
 * @returns The authuser index of the activated account
 */
export async function activateSlot(email: string): Promise<number> {
  const slots = await getCachedSlots();
  const target = slots.find((s) => s.email === email);

  if (!target) {
    // Unknown account — add as a new slot
    const newIndex = slots.length;
    slots.unshift({
      index: newIndex,
      name: email.split('@')[0] || email,
      email,
      photoUrl: `https://lh3.googleusercontent.com/a-/AOh14G${hashEmail(email)}=s96-c`,
      isActive: true,
      isDefault: false,
      detected: true,
      lastUsed: Date.now(),
    });
    // Clear other detected flags
    for (let i = 1; i < slots.length; i++) slots[i].detected = false;

    // Persist the index
    await Promise.all([saveCachedSlots(slots), setSelectedAccountIndex(newIndex)]);
    logSlotDebug('activateSlot(unknown)', email, newIndex, slots.length);
    return newIndex;
  }

  // Update detected flags
  for (const s of slots) s.detected = (s.email === email);
  target.lastUsed = Date.now();

  // Persist the index
  await Promise.all([saveCachedSlots(slots), setSelectedAccountIndex(target.index)]);
  logSlotDebug('activateSlot', email, target.index, slots.length);
  return target.index;
}

/**
 * Get the currently selected account authuser index.
 * Used by notebook-api.ts to append ?authuser=X to all RPC calls.
 */
export async function getCurrentAuthuser(): Promise<number> {
  return getSelectedAccountIndex();
}

export async function removeSlot(email: string): Promise<void> {
  const slots = await getCachedSlots();
  await saveCachedSlots(slots.filter((s) => s.email !== email));
}

/**
 * Open Google account picker (for adding a new account).
 * This is the ONLY place where we navigate to Google — used
 * exclusively for the "Add new account" action, NOT for switching.
 */
export function openAddAccount(): void {
  chrome.tabs.create({
    url: 'https://accounts.google.com/SignOutOptions?continue=https://notebooklm.google.com&addAccount=1',
  });
}

/**
 * Check if the current Google session is still valid.
 */
export async function checkAuthStatus(): Promise<{ valid: boolean; error?: string }> {
  try {
    const authuser = await getCurrentAuthuser();
    const url = `https://notebooklm.google.com/?authuser=${authuser}`;
    const resp = await fetch(url, { method: 'HEAD', credentials: 'include' });
    return { valid: resp.status === 200 };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : '网络错误' };
  }
}

/**
 * Compute the authuser query param for a given email.
 */
export function getAuthuserParam(slots: GoogleAccountSlot[], activeEmail: string | null): string {
  if (!activeEmail) return '';
  const active = slots.find((s) => s.email === activeEmail);
  const index = active?.index ?? 0;
  return index > 0 ? `?authuser=${index}` : '';
}
