/**
 * Google Account Slots Service
 *
 * Detects the currently logged-in Google account on NotebookLM by querying
 * the content script on notebooklm.google.com. Falls back to
 * chrome.identity.getProfileUserInfo() if no NotebookLM tab is found.
 *
 * Inspired by notebooklm-py's multi-profile approach:
 *   https://github.com/teng-lin/notebooklm-py
 */

import type { GoogleAccountInfo } from '@/lib/types';

export interface GoogleAccountSlot {
  email: string;
  name: string;
  photoUrl: string;
  detected: boolean;
  lastUsed: number;
}

const CACHED_SLOTS_KEY = 'cached_google_slots';

// ─── Storage helpers ─────────────────────────────────

export async function getCachedSlots(): Promise<GoogleAccountSlot[]> {
  const result = await chrome.storage.local.get(CACHED_SLOTS_KEY);
  const slots = result[CACHED_SLOTS_KEY];
  if (Array.isArray(slots)) {
    return slots as GoogleAccountSlot[];
  }
  return [];
}

export async function saveCachedSlots(slots: GoogleAccountSlot[]): Promise<void> {
  await chrome.storage.local.set({ [CACHED_SLOTS_KEY]: slots });
}

export function onSlotsChanged(callback: (slots: GoogleAccountSlot[]) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>) => {
    if (changes[CACHED_SLOTS_KEY]) {
      const newSlots = changes[CACHED_SLOTS_KEY].newValue as GoogleAccountSlot[] | undefined;
      if (Array.isArray(newSlots)) {
        callback(newSlots);
      }
    }
  };
  chrome.storage.local.onChanged.addListener(handler);
  return () => chrome.storage.local.onChanged.removeListener(handler);
}

// ─── Account detection ───────────────────────────────

/**
 * Generate initials avatar (SVG data URI) as fallback.
 */
export function getInitialsAvatar(nameOrEmail: string): string {
  const initial = nameOrEmail.trim().charAt(0).toUpperCase() || '?';
  const colors = ['#4F46E5', '#7C3AED', '#2563EB', '#059669', '#D97706', '#DC2626', '#0891B2', '#DB2777'];
  const idx = Math.abs(hashCode(nameOrEmail)) % colors.length;
  const color = colors[idx];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
    <circle cx="48" cy="48" r="48" fill="${color}"/>
    <text x="48" y="54" text-anchor="middle" fill="white" font-size="36" font-family="Inter,sans-serif" font-weight="600">${initial}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/**
 * Detect the current Google account by querying the NotebookLM page.
 *
 * Strategy A (primary): Send GET_GOOGLE_ACCOUNT message via background
 *   → content script on notebooklm.google.com extracts email from DOM
 * Strategy B (fallback): chrome.identity.getProfileUserInfo()
 *   (only works if user is signed into Chrome itself)
 */
export async function detectActiveAccount(): Promise<{ email: string; name: string; photoUrl: string } | null> {
  // Strategy A: Ask the content script on notebooklm.google.com
  try {
    const resp = await chrome.runtime.sendMessage<
      { type: 'GET_GOOGLE_ACCOUNT' },
      { success: boolean; data?: GoogleAccountInfo | null; error?: string }
    >({ type: 'GET_GOOGLE_ACCOUNT' });

    if (resp?.success && resp.data) {
      return resp.data;
    }
  } catch (err) {
    console.warn('[AccountSlots] Page detection failed:', err);
  }

  // Strategy B: chrome.identity.getProfileUserInfo (Chrome profile login)
  try {
    const userInfo = await new Promise<chrome.identity.UserInfo>((resolve, reject) => {
      chrome.identity.getProfileUserInfo((info) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(info);
      });
    });

    if (userInfo?.email) {
      return {
        email: userInfo.email,
        name: userInfo.email.split('@')[0] || userInfo.email,
        photoUrl: `https://lh3.googleusercontent.com/a/default-user=s96-c`,
      };
    }
  } catch (err) {
    console.warn('[AccountSlots] Chrome identity detection failed:', err);
  }

  return null;
}

// ─── Slot management ─────────────────────────────────

/**
 * Initialize account slots: merge detected account into cache.
 *
 * 1. Read existing slots from storage
 * 2. Detect current account (page → identity fallback)
 * 3. Merge: update detected flag, add if new
 * 4. Save back to storage
 * 5. Return updated slot list
 */
export async function initializeSlots(): Promise<GoogleAccountSlot[]> {
  const [existing, detected] = await Promise.all([
    getCachedSlots(),
    detectActiveAccount(),
  ]);

  const slots = [...existing];

  if (detected) {
    const existingIndex = slots.findIndex((s) => s.email === detected.email);

    if (existingIndex >= 0) {
      slots[existingIndex] = {
        ...slots[existingIndex],
        detected: true,
        lastUsed: Date.now(),
        name: slots[existingIndex].name || detected.name,
        photoUrl: detected.photoUrl || slots[existingIndex].photoUrl,
      };
    } else {
      slots.unshift({
        email: detected.email,
        name: detected.name,
        photoUrl: detected.photoUrl || getInitialsAvatar(detected.email),
        detected: true,
        lastUsed: Date.now(),
      });
    }

    // Clear detected flag for all other slots
    for (const slot of slots) {
      if (slot.email !== detected.email) {
        slot.detected = false;
      }
    }
  }

  await saveCachedSlots(slots);
  return slots;
}

/**
 * Mark an account as the active one.
 */
export async function activateSlot(email: string): Promise<void> {
  const slots = await getCachedSlots();
  let found = false;

  for (const slot of slots) {
    if (slot.email === email) {
      slot.detected = true;
      slot.lastUsed = Date.now();
      found = true;
    } else {
      slot.detected = false;
    }
  }

  if (!found) {
    slots.unshift({
      email,
      name: email.split('@')[0] || email,
      photoUrl: getInitialsAvatar(email),
      detected: true,
      lastUsed: Date.now(),
    });
  }

  await saveCachedSlots(slots);
}

/**
 * Remove an account slot.
 */
export async function removeSlot(email: string): Promise<void> {
  const slots = await getCachedSlots();
  const filtered = slots.filter((s) => s.email !== email);
  await saveCachedSlots(filtered);
}

// ─── Navigation helpers ──────────────────────────────

/**
 * Open Google account picker for switching accounts.
 */
export function openAccountPicker(): void {
  chrome.tabs.create({
    url: 'https://accounts.google.com/AccountChooser?continue=https://notebooklm.google.com',
  });
}

/**
 * Open Google sign-in for adding a new account.
 */
export function openAddAccount(): void {
  chrome.tabs.create({
    url: 'https://accounts.google.com/SignOutOptions?continue=https://notebooklm.google.com&addAccount=1',
  });
}

/**
 * Check auth status by testing a fetch to notebooklm.google.com.
 */
export async function checkAuthStatus(): Promise<{ valid: boolean; error?: string }> {
  try {
    const resp = await fetch('https://notebooklm.google.com/', {
      method: 'HEAD',
      credentials: 'include',
    });
    return { valid: resp.status === 200 };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}
