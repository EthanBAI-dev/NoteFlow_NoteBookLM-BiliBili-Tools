// NotebookLM internal API via batchexecute RPC
// Based on reverse-engineering from notebooklm-py (github.com/teng-lin/notebooklm-py)

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
 * Extract CSRF token (SNlM0e) from NotebookLM homepage HTML.
 * The token is embedded in the page's JavaScript initialization.
 */
async function fetchCsrfToken(): Promise<string | null> {
  try {
    const resp = await fetch(NLM_HOME_URL, { credentials: 'include' });
    if (!resp.ok) {
      console.warn(`[notebook-api] CSRF fetch: HTTP ${resp.status}`);
      return null;
    }
    const html = await resp.text();

    const match = html.match(/"SNlM0e":"([^"]+)"/);
    const token = match ? match[1] : null;
    console.log(`[notebook-api] CSRF token: ${token ? 'found' : 'NOT FOUND (not logged into NotebookLM?)'}`);
    return token;
  } catch {
    console.warn('[notebook-api] CSRF fetch: network error');
    return null;
  }
}

/**
 * Encode an RPC request into batchexecute format.
 * Format: [[[rpc_id, json_params, null, "generic"]]]
 */
function encodeRpcRequest(rpcId: string, params: unknown[]): string {
  const paramsJson = JSON.stringify(params);
  const inner = [rpcId, paramsJson, null, 'generic'];
  return JSON.stringify([[inner]]);
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
 */
export async function fetchNotebooks(): Promise<NotebookItem[]> {
  // Step 1: Get CSRF token from homepage
  const csrfToken = await fetchCsrfToken();
  if (!csrfToken) {
    console.warn('[notebook-api] Failed to get CSRF token — user may not be logged in');
    return [];
  }

  // Step 2: Build batchexecute request
  const params = [null, 1, null, [2]]; // LIST_NOTEBOOKS params
  const fReq = encodeRpcRequest(RPC_LIST_NOTEBOOKS, params);

  const urlParams = new URLSearchParams({
    rpcids: RPC_LIST_NOTEBOOKS,
    'source-path': '/',
    rt: 'c',
  });

  const body = `f.req=${encodeURIComponent(fReq)}&at=${encodeURIComponent(csrfToken)}&`;

  // Step 3: Make the RPC call
  try {
    const resp = await fetch(`${BATCHEXECUTE_URL}?${urlParams}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body,
    });

    if (!resp.ok) {
      console.error('[notebook-api] RPC failed:', resp.status);
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
 * Response format (after anti-XSSI stripping):
 * Multiple lines of response chunks. The actual data is in a JSON-encoded
 * string within the response array.
 *
 * Each notebook in the response: [title, ???, id, ...]
 */
function parseNotebookList(rawText: string): NotebookItem[] {
  try {
    const cleaned = stripAntiXssi(rawText);

    const results: NotebookItem[] = [];

    const lines = cleaned.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('[')) continue;

      try {
        const parsed = JSON.parse(trimmed);
        if (!Array.isArray(parsed)) continue;

        for (const outerItem of parsed) {
          if (!Array.isArray(outerItem)) continue;
          const candidates = outerItem[0] === 'wrb.fr' ? [outerItem] : outerItem.filter(Array.isArray);
          for (const item of candidates) {
            if (!Array.isArray(item)) continue;
            if (item[0] === 'wrb.fr' && item[1] === RPC_LIST_NOTEBOOKS && typeof item[2] === 'string') {
              const innerData = JSON.parse(item[2]);
              console.log('[notebook-api] innerData type:', Array.isArray(innerData) ? `array[${innerData.length}]` : typeof innerData);
              if (innerData.length > 0) {
                console.log('[notebook-api] innerData[0] type:', Array.isArray(innerData[0]) ? `array[${innerData[0].length}]` : typeof innerData[0]);
              }

              const rawList = Array.isArray(innerData) && Array.isArray(innerData[0])
                ? innerData[0]
                : (Array.isArray(innerData) ? innerData : []);

              console.log('[notebook-api] rawList length:', rawList.length);

              for (const nb of rawList) {
                if (!Array.isArray(nb)) continue;
                const rawTitle = typeof nb[0] === 'string' ? nb[0] : '';
                const title = rawTitle.replace(/^thought\n/, '').trim() || 'Untitled';
                const id = typeof nb[2] === 'string' ? nb[2] : '';
                if (id) {
                  results.push({ id, title, url: `https://notebooklm.google.com/notebook/${id}` });
                }
              }
              console.log('[notebook-api] Parsed', results.length, 'notebooks');
              return results;
            }
          }
        }
      } catch {
        // Not valid JSON, skip
      }
    }

    return results;
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
  const csrfToken = await fetchCsrfToken();
  if (!csrfToken) {
    throw new Error('[notebook-api] Failed to get CSRF token — user may not be logged into notebooklm.google.com in Chrome');
  }

  const fReq = encodeRpcRequest(rpcId, params);
  const urlParams = new URLSearchParams({
    rpcids: rpcId,
    'source-path': sourcePath,
    rt: 'c',
  });
  const body = `f.req=${encodeURIComponent(fReq)}&at=${encodeURIComponent(csrfToken)}&`;

  console.log(`[notebook-api] Calling ${rpcId} with sourcePath=${sourcePath}`);

  const resp = await fetch(`${BATCHEXECUTE_URL}?${urlParams}`, {
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
