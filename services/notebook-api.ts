// NotebookLM internal API via batchexecute RPC
// Based on reverse-engineering from notebooklm-py (github.com/teng-lin/notebooklm-py)
// Multi-account support via ?authuser=X parameter (from add_to_NotebookLM)

import { getCurrentAuthuser } from '@/services/account-slots';

const BATCHEXECUTE_URL = 'https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute';
const NLM_HOME_URL = 'https://notebooklm.google.com/';

const RPC_LIST_NOTEBOOKS = 'wXbhsf';
const RPC_ADD_SOURCE = 'izAoDd';

// Delay between batchexecute calls to avoid rate limiting
const RPC_DELAY_MS = 1200;

// Cache config
const CACHE_KEY = 'notebook_list_cache';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface NotebookCache {
  notebooks: NotebookItem[];
  cachedAt: number;
}

export interface NotebookItem {
  id: string;
  title: string;
  url: string;
}

/**
 * Token pair extracted from NotebookLM homepage.
 * Both tokens are required for successful batchexecute RPC calls.
 */
interface NlmTokens {
  /** CSRF token (SNlM0e) — sent in POST body as `at` */
  at: string;
  /** Request token (cfb2h) — sent in URL query as `bl` */
  bl: string;
}

/**
 * Extract authentication tokens from NotebookLM homepage HTML.
 *
 * This is the KEY fix for multi-account switching: the reference
 * implementation (add_to_NotebookLM) extracts BOTH `SNlM0e` (at)
 * and `cfb2h` (bl) tokens from the homepage. The `bl` token MUST
 * be included in the batchexecute URL query params — without it,
 * Google's backend may reject the request or serve the wrong
 * account's data.
 *
 * @param authuser - Optional Google account authuser index (0, 1, 2…).
 *                   When > 0, appends ?authuser=X to the request URL,
 *                   fetching the page for that specific account.
 */
async function fetchTokens(authuser?: number): Promise<NlmTokens | null> {
  try {
    const url = authuser && authuser > 0
      ? `${NLM_HOME_URL}?authuser=${authuser}&pageId=none`
      : NLM_HOME_URL;
    console.log(`[notebook-api] Fetching tokens from: ${url}`);

    // Use AbortController timeout — matching the reference's fetchWithTimeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const resp = await fetch(url, {
      credentials: 'include',
      redirect: 'manual',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    // Reference logic: allow opaque redirects through (still try to read body)
    if (!resp.ok && resp.type !== 'opaqueredirect') {
      console.warn(`[notebook-api] Token fetch: HTTP ${resp.status} type=${resp.type}`);
      return null;
    }

    const html = await resp.text();

    // If the response was a redirect, html will be empty — detect quickly
    if (!html || html.length < 100) {
      console.warn(`[notebook-api] Token fetch: empty/short response (${html.length} chars) — possible redirect`);
      return null;
    }

    // Extract both tokens from the HTML
    // Pattern matches the exact format Google embeds: "key":"value"
    const atMatch = html.match(/"SNlM0e":"([^"]+)"/);
    const blMatch = html.match(/"cfb2h":"([^"]+)"/);
    const at = atMatch ? atMatch[1] : null;
    const bl = blMatch ? blMatch[1] : null;

    if (!at || !bl) {
      console.warn(`[notebook-api] Tokens: at=${!!at} bl=${!!bl} (authuser=${authuser})`);
      // Log first 500 chars of HTML for debugging
      console.warn(`[notebook-api] HTML preview: ${html.slice(0, 500)}`);
      return null;
    }

    console.log(`[notebook-api] Tokens OK: at=${at.slice(0, 8)}... bl=${bl.slice(0, 8)}... (authuser=${authuser})`);
    return { at, bl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[notebook-api] Token fetch: ${msg}`);
    return null;
  }
}

/**
 * Generate a random request ID for batchexecute (matching Google's format).
 * The _reqid parameter is used for request deduplication — the reference
 * implementation includes it in every batchexecute URL.
 */
function generateReqId(): string {
  return String(Math.floor(Math.random() * 900000 + 100000));
}

/**
 * Strip anti-XSSI prefix from Google's batchexecute response.
 * Responses start with ")]}'" followed by a newline.
 */
function stripAntiXssi(text: string): string {
  const prefix = ")]}'";
  if (text.startsWith(prefix)) {
    return text.slice(prefix.length).trim();
  }
  return text;
}

async function getCachedNotebooks(): Promise<NotebookItem[] | null> {
  try {
    const result = await chrome.storage.local.get(CACHE_KEY);
    const cache = result[CACHE_KEY] as NotebookCache | undefined;
    if (cache && Date.now() - cache.cachedAt < CACHE_TTL_MS) {
      return cache.notebooks;
    }
  } catch { /* storage unavailable */ }
  return null;
}

async function setCachedNotebooks(notebooks: NotebookItem[]): Promise<void> {
  try {
    await chrome.storage.local.set({
      [CACHE_KEY]: { notebooks, cachedAt: Date.now() } satisfies NotebookCache,
    });
  } catch { /* storage unavailable */ }
}

/**
 * Fetch notebooks with cache support.
 * Returns cached data if within TTL, otherwise fetches fresh.
 * @param force - bypass cache and always fetch from API
 */
export async function fetchNotebooksCached(force = false): Promise<NotebookItem[]> {
  if (!force) {
    const cached = await getCachedNotebooks();
    if (cached && cached.length > 0) {
      console.log(`[notebook-api] Using cached notebooks: ${cached.length}`);
      return cached;
    }
  }
  console.log('[notebook-api] Fetching notebooks from API (force=' + force + ')');
  const notebooks = await fetchNotebooks();
  console.log(`[notebook-api] API returned ${notebooks.length} notebooks`);
  if (notebooks.length > 0) {
    await setCachedNotebooks(notebooks);
  }
  return notebooks;
}

/**
 * Fetch notebook list from NotebookLM via internal batchexecute API.
 * Uses the extension's host permission — fetch() automatically includes cookies.
 * Supports multi-account via ?authuser=X.
 */
export async function fetchNotebooks(): Promise<NotebookItem[]> {
  // Get the currently selected account's authuser index
  const authuser = await getCurrentAuthuser();

  // Step 1: Get both tokens from homepage (with account-specific authuser)
  const tokens = await fetchTokens(authuser);
  if (!tokens) {
    console.warn('[notebook-api] Failed to get tokens — user may not be logged in');
    return [];
  }

  // Step 2: Build batchexecute request (matching reference exactly)
  const params = [null, 1, null, [2]]; // LIST_NOTEBOOKS params
  const reqId = generateReqId();

  const url = new URL(BATCHEXECUTE_URL);
  url.searchParams.set('rpcids', RPC_LIST_NOTEBOOKS);
  url.searchParams.set('source-path', '/');
  url.searchParams.set('bl', tokens.bl);
  url.searchParams.set('_reqid', reqId);
  url.searchParams.set('rt', 'c');

  // CRITICAL: Include authuser in URL for multi-account support
  // Without this, Google's backend uses the default account (0) even
  // when we fetched tokens for a different account.
  if (authuser > 0) {
    url.searchParams.set('authuser', String(authuser));
  }

  // Build form body matching reference exactly
  const body = new URLSearchParams({
    'f.req': JSON.stringify([[[RPC_LIST_NOTEBOOKS, JSON.stringify(params), null, 'generic']]]),
    'at': tokens.at,
  }).toString();

  // Step 3: Make the RPC call
  try {
    const resp = await fetch(url.toString(), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body,
    });

    if (!resp.ok) {
      console.error('[notebook-api] RPC failed:', resp.status, resp.statusText);
      return [];
    }

    const text = await resp.text();
    return parseNotebookList(text);
  } catch (e) {
    console.error('[notebook-api] Fetch error:', e);
    return [];
  }
}

/**
 * Parse notebook list from batchexecute response.
 *
 * Response format (matching reference add_to_NotebookLM):
 *   )]}'\n\nXX[[["wrb.fr","wXbhsf","[...]",...
 *
 * The actual data is in a JSON-encoded string within the wrb.fr response.
 * Each notebook item: [title, sources_array, id, emoji, ...]
 */
function parseNotebookList(rawText: string): NotebookItem[] {
  try {
    // Reference approach: find the wrb.fr line directly
    const lines = rawText.split('\n');
    const dataLine = lines.find(line => line.includes('wrb.fr'));
    if (!dataLine) {
      console.warn('[notebook-api] No wrb.fr line found in response');
      return [];
    }

    const parsed = JSON.parse(dataLine);
    const innerData = JSON.parse(parsed[0][2]);

    if (!innerData || !innerData[0]) {
      console.warn('[notebook-api] Empty inner data');
      return [];
    }

    const notebooks: NotebookItem[] = [];
    for (const item of innerData[0]) {
      if (!Array.isArray(item) || item.length < 3) continue;

      const rawTitle = typeof item[0] === 'string' ? item[0] : '';
      const title = rawTitle.trim() || 'Untitled';
      const id = typeof item[2] === 'string' ? item[2] : '';

      if (id) {
        notebooks.push({
          id,
          title,
          url: `https://notebooklm.google.com/notebook/${id}`,
        });
      }
    }

    console.log(`[notebook-api] Parsed ${notebooks.length} notebooks`);
    return notebooks;
  } catch (e) {
    console.error('[notebook-api] Parse error:', e);
    return [];
  }
}

// ── Generic RPC call ──

async function rpcCall(
  rpcId: string,
  params: unknown[],
  sourcePath = '/',
): Promise<string> {
  const authuser = await getCurrentAuthuser();
  const tokens = await fetchTokens(authuser);
  if (!tokens) {
    throw new Error('[notebook-api] Failed to get tokens — user may not be logged into notebooklm.google.com in Chrome');
  }

  const reqId = generateReqId();

  // Build URL matching reference exactly
  const url = new URL(BATCHEXECUTE_URL);
  url.searchParams.set('rpcids', rpcId);
  url.searchParams.set('source-path', sourcePath);
  url.searchParams.set('bl', tokens.bl);
  url.searchParams.set('_reqid', reqId);
  url.searchParams.set('rt', 'c');

  if (authuser > 0) {
    url.searchParams.set('authuser', String(authuser));
  }

  // Build form body matching reference exactly
  const body = new URLSearchParams({
    'f.req': JSON.stringify([[[rpcId, JSON.stringify(params), null, 'generic']]]),
    'at': tokens.at,
  }).toString();

  console.log(`[notebook-api] Calling ${rpcId} sourcePath=${sourcePath} authuser=${authuser}`);

  const resp = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body,
  });

  const text = await resp.text();
  console.log(`[notebook-api] ${rpcId} response: HTTP ${resp.status}, ${text.length} bytes`);

  if (!resp.ok) {
    throw new Error(`[notebook-api] RPC ${rpcId} failed: HTTP ${resp.status}`);
  }

  const cleaned = stripAntiXssi(text);

  if (cleaned.includes('"error"') || cleaned.includes('"errors"')) {
    throw new Error(`[notebook-api] RPC ${rpcId} returned error: ${cleaned.slice(0, 200)}`);
  }

  console.log(`[notebook-api] ${rpcId} succeeded`);
  return cleaned;
}

// ── Add source (URL) ──

export async function addSourceUrl(notebookId: string, url: string): Promise<void> {
  console.log(`[notebook-api] addSourceUrl: notebook=${notebookId}, url=${url.slice(0, 50)}`);
  const params = [
    [[null, null, [url], null, null, null, null, null]],
    notebookId,
    [2],
    null,
    null,
  ];
  await rpcCall(RPC_ADD_SOURCE, params, `/notebook/${notebookId}`);
}

// ── Add source (text) ──

export async function addSourceText(
  notebookId: string,
  title: string,
  content: string,
): Promise<void> {
  console.log(`[notebook-api] addSourceText: notebook=${notebookId}, title="${title}", ${content.length} chars`);
  const params = [
    [[null, [title, content], null, null, null, null, null, null]],
    notebookId,
    [2],
    null,
    null,
  ];
  await rpcCall(RPC_ADD_SOURCE, params, `/notebook/${notebookId}`);
}

// ── Batch delay helper ──

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Create notebook ──

export async function createNotebook(title: string): Promise<NotebookItem> {
  const RPC_CREATE_NOTEBOOK = 'CCqFvf';
  const params = [title, null, null, [2], [1]];
  const raw = await rpcCall(RPC_CREATE_NOTEBOOK, params);

  // Parse response — look for notebook id in the result
  const lines = raw.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('[')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed) {
        if (!Array.isArray(item)) continue;
        if (item[0] === 'wrb.fr' && item[1] === RPC_CREATE_NOTEBOOK && typeof item[2] === 'string') {
          const data = JSON.parse(item[2]);
          // Response: [[[id, title, ...]]]
          if (Array.isArray(data) && Array.isArray(data[0]) && Array.isArray(data[0][0])) {
            const nb = data[0][0];
            const id = typeof nb[0] === 'string' ? nb[0] : '';
            const nbTitle = typeof nb[1] === 'string' ? nb[1] : title;
            if (id) {
              return { id, title: nbTitle, url: `https://notebooklm.google.com/notebook/${id}` };
            }
          }
        }
      }
    } catch { /* skip */ }
  }

  throw new Error('[notebook-api] Failed to parse create notebook response');
}
