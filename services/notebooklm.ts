import { getSelectedNotebook, setSelectedNotebook } from '@/lib/config';
import { delay } from '@/lib/utils';
import type { ImportItem, ImportProgress } from '@/lib/types';
import { addToHistory } from './history';
import { addSourceUrl, addSourceText, fetchNotebooksCached } from './notebook-api';

const BATCH_DELAY_MS = 1200;

async function getNotebookId(): Promise<string> {
  const selected = await getSelectedNotebook();
  if (selected) return selected.id;

  const notebooks = await fetchNotebooksCached();
  if (notebooks.length === 0) {
    throw new Error('未找到笔记本。请先在 Chrome 中打开并登录 notebooklm.google.com');
  }

  const first = notebooks[0];
  await setSelectedNotebook(first);
  return first.id;
}

export async function importUrl(url: string, _targetTabId?: number): Promise<boolean> {
  try {
    const notebookId = await getNotebookId();
    await addSourceUrl(notebookId, url);
    await addToHistory(url, 'success');
    return true;
  } catch (error) {
    console.error('Failed to import URL:', error);
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    await addToHistory(url, 'error', undefined, errMsg);
    return false;
  }
}

export async function importBatch(
  urls: string[],
  onProgress?: (progress: ImportProgress) => void,
  _targetTabId?: number
): Promise<ImportProgress> {
  const items: ImportItem[] = urls.map((url) => ({
    url,
    status: 'pending',
  }));

  const progress: ImportProgress = {
    total: urls.length,
    completed: 0,
    items,
  };

  try {
    const notebookId = await getNotebookId();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      item.status = 'importing';
      progress.current = item;
      onProgress?.(progress);

      try {
        await addSourceUrl(notebookId, item.url);
        item.status = 'success';
        await addToHistory(item.url, 'success');
      } catch (error) {
        item.status = 'error';
        item.error = error instanceof Error ? error.message : 'Unknown error';
        await addToHistory(item.url, 'error', undefined, item.error);
      }

      progress.completed++;
      onProgress?.(progress);

      if (i < items.length - 1) {
        await delay(BATCH_DELAY_MS);
      }
    }
  } catch (error) {
    for (const item of items) {
      if (item.status === 'pending') {
        item.status = 'error';
        item.error = error instanceof Error ? error.message : 'Unknown error';
      }
    }
  }

  progress.current = undefined;
  return progress;
}

export async function importText(
  text: string,
  title?: string,
  _targetTabId?: number,
  _renamePrefix?: string,
): Promise<boolean> {
  const historyTitle = title || 'Imported text';
  try {
    const notebookId = await getNotebookId();
    await addSourceText(notebookId, title || 'Pasted Text', text);
    await addToHistory(`text://${historyTitle}`, 'success', historyTitle);
    return true;
  } catch (error) {
    console.error('Failed to import text:', error);
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    await addToHistory(`text://${historyTitle}`, 'error', historyTitle, errMsg);
    return false;
  }
}

// Get current tab URL
export async function getCurrentTabUrl(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url || null;
}

// Get all open tab URLs
export async function getAllTabUrls(): Promise<string[]> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs
    .map((tab) => tab.url)
    .filter((url): url is string => !!url && url.startsWith('http'));
}
