// NotebookLM Configuration
export const NOTEBOOKLM_CONFIG = {
  baseUrl: 'https://notebooklm.google.com',
  importDelay: 1500, // Delay between batch imports (ms)
} as const;

// Selected notebook storage key
const SELECTED_NOTEBOOK_KEY = 'selected_notebook';

export interface SelectedNotebook {
  id: string;
  title: string;
  url: string;
}

/** Save user's chosen target notebook for imports */
export async function setSelectedNotebook(notebook: SelectedNotebook): Promise<void> {
  await chrome.storage.local.set({ [SELECTED_NOTEBOOK_KEY]: notebook });
}

/** Get user's chosen target notebook (null if not set) */
export async function getSelectedNotebook(): Promise<SelectedNotebook | null> {
  const result = await chrome.storage.local.get(SELECTED_NOTEBOOK_KEY);
  return result[SELECTED_NOTEBOOK_KEY] ?? null;
}

/**
 * Persist the selected Google account authuser index.
 * This is the key mechanism for multi-account switching:
 * once saved, ALL subsequent NotebookLM API calls will use
 * the corresponding ?authuser=X parameter automatically.
 */
const ACCOUNT_INDEX_KEY = 'selected_account_index';

export async function setSelectedAccountIndex(index: number): Promise<void> {
  await chrome.storage.local.set({ [ACCOUNT_INDEX_KEY]: index });
}

/**
 * Get the persisted selected account authuser index.
 * Returns 0 (primary account) as default.
 */
export async function getSelectedAccountIndex(): Promise<number> {
  const result = await chrome.storage.local.get(ACCOUNT_INDEX_KEY);
  const value = result[ACCOUNT_INDEX_KEY];
  return typeof value === 'number' ? value : 0;
}
