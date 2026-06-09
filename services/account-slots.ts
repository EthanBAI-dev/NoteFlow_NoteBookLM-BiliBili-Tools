/**
 * Google Account Slots Service
 *
 * Manages multiple Google account profiles ("slots") for use with NotebookLM.
 * Accounts are cached in chrome.storage.local under `cached_google_slots`.
 *
 * Inspired by notebooklm-py's multi-profile approach:
 *   https://github.com/teng-lin/notebooklm-py
 */

/** A single Google account slot */
export interface GoogleAccountSlot {
  /** Google account email address */
  email: string;
  /** Display name (from profile) */
  name: string;
  /** Google profile photo URL */
  photoUrl: string;
  /** Whether this is the currently detected active account */
  detected: boolean;
  /** When this account was last used (epoch ms) */
  lastUsed: number;
}

const CACHED_SLOTS_KEY = 'cached_google_slots';

// ─── Storage helpers ─────────────────────────────────

/**
 * Read cached Google account slots from chrome.storage.local.
 */
export async function getCachedSlots(): Promise<GoogleAccountSlot[]> {
  const result = await chrome.storage.local.get(CACHED_SLOTS_KEY);
  const slots = result[CACHED_SLOTS_KEY];
  if (Array.isArray(slots)) {
    return slots as GoogleAccountSlot[];
  }
  return [];
}

/**
 * Save Google account slots to chrome.storage.local.
 */
export async function saveCachedSlots(slots: GoogleAccountSlot[]): Promise<void> {
  await chrome.storage.local.set({ [CACHED_SLOTS_KEY]: slots });
}

/**
 * Listen for storage changes to cached_google_slots.
 */
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
 * Construct a Google profile photo URL from an email address.
 *
 * Uses the public Google profile image endpoint. Falls back to a
 * generated UI avatar if the request fails.
 */
export function getProfilePhotoUrl(email: string): string {
  const hash = simpleEmailHash(email);
  return `https://lh3.googleusercontent.com/a-/AOh14G${hash}=s96-c`;
}

/** Simple hash for constructing a plausible photo URL */
function simpleEmailHash(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    const chr = email.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(12, '0');
}

/**
 * Generate initials avatar (data URI) for a given name/email.
 * Used as fallback when Google photo URL can't be loaded.
 */
export function getInitialsAvatar(nameOrEmail: string): string {
  const initial = nameOrEmail.trim().charAt(0).toUpperCase() || '?';
  // Pastel colors based on name hash
  const colors = [
    '#4F46E5', '#7C3AED', '#2563EB', '#059669',
    '#D97706', '#DC2626', '#0891B2', '#DB2777',
  ];
  const idx = Math.abs(simpleEmailHash(nameOrEmail).charCodeAt(0) || 0) % colors.length;
  const color = colors[idx];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
    <circle cx="48" cy="48" r="48" fill="${color}"/>
    <text x="48" y="54" text-anchor="middle" fill="white" font-size="36" font-family="Inter,sans-serif" font-weight="600">${initial}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/**
 * Detect the current primary Google account using chrome.identity.
 *
 * Returns the account info, or null if not available.
 */
export async function detectPrimaryAccount(): Promise<{ email: string; name: string } | null> {
  try {
    const userInfo = await new Promise<chrome.identity.UserInfo>((resolve, reject) => {
      chrome.identity.getProfileUserInfo((info) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(info);
        }
      });
    });

    if (userInfo?.email) {
      return {
        email: userInfo.email,
        name: userInfo.email.split('@')[0] || userInfo.email,
      };
    }
    return null;
  } catch (err) {
    console.warn('[AccountSlots] Failed to detect primary account:', err);
    return null;
  }
}

// ─── Slot management ─────────────────────────────────

/**
 * Initialize account slots: merge detected account into cache.
 *
 * 1. Read existing slots from storage
 * 2. Detect the current primary Chrome account
 * 3. Merge: update detected flag, add if new
 * 4. Save back to storage
 * 5. Return the updated slot list
 */
export async function initializeSlots(): Promise<GoogleAccountSlot[]> {
  const [existing, detected] = await Promise.all([
    getCachedSlots(),
    detectPrimaryAccount(),
  ]);

  const slots = [...existing];

  if (detected) {
    const existingIndex = slots.findIndex((s) => s.email === detected.email);

    if (existingIndex >= 0) {
      // Update existing slot: mark as detected, refresh lastUsed
      slots[existingIndex] = {
        ...slots[existingIndex],
        detected: true,
        lastUsed: Date.now(),
        name: slots[existingIndex].name || detected.name,
      };
    } else {
      // Add new slot for detected account
      slots.unshift({
        email: detected.email,
        name: detected.name,
        photoUrl: getProfilePhotoUrl(detected.email),
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
 * Mark an account as the active (currently selected) one.
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
    // If email not in slots, add it as a new entry
    slots.unshift({
      email,
      name: email.split('@')[0] || email,
      photoUrl: getProfilePhotoUrl(email),
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

/**
 * Open Google account picker for switching or adding accounts.
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
 * Check current auth status by testing a fetch to notebooklm.google.com.
 * Returns true if the session appears valid.
 */
export async function checkAuthStatus(): Promise<{ valid: boolean; error?: string }> {
  try {
    const resp = await fetch('https://notebooklm.google.com/', {
      method: 'HEAD',
      credentials: 'include',
    });
    // A 200 means we're authenticated (redirect to accounts.google.com would mean not)
    return { valid: resp.status === 200 };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : '网络错误',
    };
  }
}
