import { fetchNotebooksCached as fetchNotebooksApi } from '@/services/notebook-api';
import {
  importUrl,
  importBatch,
  importText,
  getCurrentTabUrl,
  getAllTabUrls,
} from '@/services/notebooklm';
import { convertHtmlToMarkdown } from '@/services/pdf-generator';
import { getHistory, clearHistory } from '@/services/history';
import { fetchPodcast, sanitizeFilename, buildFilename } from '@/services/podcast';
import { fetchYouTube, fetchYouTubeMore, checkYouTubeSubtitles } from '@/services/youtube';
import {
  fetchBilibiliVideo,
  fetchVideoSubtitle,
  sanitizeBilibiliFilename,
  parseBilibiliUrl,
  mergeBilibiliSubtitles,
  fetchBilibiliUserVideos,
  fetchBilibiliFavoriteList,
  convertSubtitleOutput,
} from '@/services/bilibili';
import { setOpState, clearOpState, type OpState } from '@/services/op-state';
import { uploadToDrive } from '@/services/google-drive';
import { fetchAndCacheAccounts, logSlotDebug } from '@/services/account-slots';
import JSZip from 'jszip';
import type { PodcastInfo, PodcastEpisode } from '@/services/podcast';

import {
  extractClaudeConversation,
  formatConversationForImport,
} from '@/services/claude-conversation';
import type { MessageType, MessageResponse, ClaudeConversation } from '@/lib/types';
import { runtimeT, type TranslationKey } from '@/lib/i18n';
import { getSettings } from '@/lib/settings';

// Dev reload: allow external messages to trigger extension reload
try {
  chrome.runtime.onMessageExternal.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'DEV_RELOAD') {
      console.log('[DEV] Reload triggered externally');
      sendResponse({ ok: true });
      setTimeout(() => chrome.runtime.reload(), 100);
      return true;
    }
  });
} catch { /* fake-browser in WXT build doesn't support onMessageExternal */ }

// Context menu IDs
const MENU_ID_PAGE = 'import-page';
const MENU_ID_LINK = 'import-link';

async function localizeRuntimeError(error?: string): Promise<string> {
  if (!error) return runtimeT('runtime.cannotExtractContent');
  if (error in { 'runtime.xContentNotFound': true, 'runtime.huaweiExtractFailed': true, 'runtime.wechatVerificationRequired': true }) {
    return runtimeT(error as TranslationKey);
  }
  return error;
}

async function refreshContextMenus(): Promise<void> {
  try {
    await chrome.contextMenus.removeAll();
  } catch {
    // Ignore missing menu errors.
  }

  chrome.contextMenus.create({
    id: MENU_ID_PAGE,
    title: await runtimeT('menu.importPage'),
    contexts: ['page'],
  });

  chrome.contextMenus.create({
    id: MENU_ID_LINK,
    title: await runtimeT('menu.importLink'),
    contexts: ['link'],
  });
}

// ── YouTube URL tracking: per-tab seq + debounce ──
const ytUrlStates = new Map<number, {
  debounceTimer?: ReturnType<typeof setTimeout>;
  seq: number;
  latestUrl: string | null;
}>();

async function broadcastToSidepanel(msg: Record<string, unknown>): Promise<void> {
  try {
    await chrome.runtime.sendMessage(msg);
  } catch {
    // Sidepanel may not be open — ignore
  }
}

export default defineBackground(() => {
  console.log('NoteFlow background service started');

  void refreshContextMenus();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (!changes.noteflow_locale && !changes.flow2note_locale) return;
    void refreshContextMenus();
  });

  // ── Google Account List Auto-Detection ──
  // Uses the shared fetchAndCacheAccounts from services/account-slots.ts
  // which fetches accounts.google.com/ListAccounts?json=1 directly.

  // Sync on startup
  (async () => {
    const prev = (await chrome.storage.local.get('cached_google_slots'))['cached_google_slots'];
    const prevCount = Array.isArray(prev) ? prev.length : 0;
    const slots = await fetchAndCacheAccounts();
    logSlotDebug('background(startup)', slots[0]?.email ?? null, 0, slots.length);
    // Detect login: was 0 accounts, now have some
    if (prevCount === 0 && slots.length > 0) {
      console.log(`[Background] Login detected: ${slots.length} account(s) now available`);
    }
  })();

  // Listen for when Google itself fetches ListAccounts (e.g. user
  // navigates to a Google service or switches accounts)
  chrome.webRequest.onCompleted.addListener(
    (details) => {
      logSlotDebug('background(webRequest)', null, -1, -1);
      setTimeout(fetchAndCacheAccounts, 500);
    },
    { urls: ['https://accounts.google.com/ListAccounts*'] },
  );

  // Also sync when the user visits notebooklm.google.com
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (
      changeInfo.status === 'complete' &&
      tab.url?.startsWith('https://notebooklm.google.com')
    ) {
      logSlotDebug('background(tabs.onUpdated)', null, -1, -1);
      setTimeout(fetchAndCacheAccounts, 1000);
    }
  });

  // ── End Google Account List Auto-Detection ──

  // Click toolbar icon → open side panel (must be at top level, not just onInstalled)
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  // Create context menus on install
  chrome.runtime.onInstalled.addListener((details) => {
    // Open welcome page on first install
    if (details.reason === 'install') {
      chrome.tabs.create({ url: chrome.runtime.getURL('/welcome.html') });
    }
    void refreshContextMenus();
  });

  // Handle context menu clicks
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    let url: string | undefined;

    if (info.menuItemId === MENU_ID_PAGE) {
      url = tab?.url;
    } else if (info.menuItemId === MENU_ID_LINK) {
      url = info.linkUrl;
    }

    if (!url || !url.startsWith('http')) {
      console.warn('Context menu import: invalid URL');
      return;
    }

    try {
      await importUrl(url);
    } catch (error) {
      console.error('Context menu import failed:', error);
    }
  });

  // Handle long-running operations via persistent port connections (supports progress updates)
  chrome.runtime.onConnect.addListener((port) => {
    // ── Rescue / Repair sources ──
    if (port.name === 'rescue-sources' || port.name === 'repair-wechat') {
      // The port's sender.tab.id is the NLM tab that initiated the repair
      const senderTabId = port.sender?.tab?.id;
      port.onMessage.addListener(async (msg) => {
        const urls: string[] = msg.urls || [];
        const sendProgress = (data: Record<string, unknown>) => {
          try { port.postMessage(data); } catch { /* disconnected */ }
          setOpState({
            active: true,
            phase: (data.phase as OpState['phase']) || 'downloading',
            kind: 'export',
            current: (data.current as number) || 0,
            total: (data.total as number) || 0,
            title: (data.title as string) || '',
            timestamp: Date.now(),
          });
        };

        try {
          if (port.name === 'repair-wechat') {
            // Repair WeChat sources with per-URL progress
            const results = await repairWechatSourcesWithProgress(urls, senderTabId, sendProgress);
            sendProgress({ phase: 'done', results });
          } else {
            // Rescue failed sources with per-URL progress
            const results = await rescueSourcesWithProgress(urls, senderTabId, sendProgress);
            sendProgress({ phase: 'done', results });
          }
        } catch (err) {
          sendProgress({ phase: 'error', error: String(err) });
        }
      });
      return;
    }

    if (port.name === 'podcast-download') {
      port.onMessage.addListener(async (msg) => {
        if (msg.type !== 'DOWNLOAD_PODCAST') return;

        const podcastInfo = msg.podcast as PodcastInfo;
        const episodes = msg.episodes as PodcastEpisode[];
        const sendProgress = (data: Record<string, unknown>) => {
          try { port.postMessage(data); } catch { /* disconnected */ }
          const phase = data.phase as string;
          if (phase === 'downloading' || phase === 'polishing') {
            setOpState({
              active: true,
              phase: phase === 'polishing' ? 'polishing' : 'downloading',
              kind: 'export',
              current: (data.current as number) || 0,
              total: (data.total as number) || 0,
              title: (data.title as string) || '',
              timestamp: Date.now(),
            });
          }
        };

        const folderName = sanitizeFilename(podcastInfo.name);
        console.log(`[podcast] Downloading ${episodes.length} episodes of "${podcastInfo.name}"`);

        try {
          for (let i = 0; i < episodes.length; i++) {
            const ep = episodes[i];
            const filename = `${folderName}/${buildFilename(i + 1, ep.title, ep.fileExtension)}`;
            sendProgress({ phase: 'downloading', current: i + 1, total: episodes.length, title: ep.title });
            console.log(`[podcast] ${i + 1}/${episodes.length}: ${ep.title}`);

            await new Promise<void>((resolve, reject) => {
              chrome.downloads.download(
                { url: ep.audioUrl, filename, conflictAction: 'uniquify' },
                (downloadId) => {
                  if (chrome.runtime.lastError) {
                    console.error(`[podcast] Download failed:`, chrome.runtime.lastError.message);
                    reject(new Error(chrome.runtime.lastError.message));
                  } else {
                    console.log(`[podcast] Download started: ${downloadId}`);
                    resolve();
                  }
                },
              );
            });
          }
          sendProgress({ phase: 'done' });
        } catch (err) {
          sendProgress({ phase: 'error', error: String(err) });
        }
      });
      return;
    }

    if (port.name === 'bilibili-download') {
      port.onMessage.addListener(async (msg) => {
        if (msg.type !== 'BILIBILI_DOWNLOAD_SEPARATE' && msg.type !== 'BILIBILI_DOWNLOAD_MERGED') return;

        const { videos, ownerName, desc, source, outputFormat } = msg as any;
        const isMerged = msg.type === 'BILIBILI_DOWNLOAD_MERGED';
        const settings = await getSettings();
        const stripTimestamps = settings.stripBilibiliTimestamps;

        await setOpState({
          active: true,
          phase: 'downloading',
          kind: 'export',
          current: 0,
          total: videos.length,
          title: videos[0]?.part || videos[0]?.title || '',
          timestamp: Date.now(),
        });

        const sendProgress = (data: Record<string, unknown>) => {
          try { port.postMessage(data); } catch { /* disconnected */ }
        };

        try {
          if (isMerged) {
            const results: { video: any; markdown: string | null }[] = [];
            for (let i = 0; i < videos.length; i++) {
              const video = videos[i];
              sendProgress({ phase: 'downloading', current: i + 1, total: videos.length, title: video.part || video.title, bvid: video.bvid });
              const result = await fetchVideoSubtitle(video, ownerName, desc, stripTimestamps);
              results.push(result);
              if (i < videos.length - 1) {
                await new Promise(r => setTimeout(r, 1500));
              }
            }
            let mergedMd = mergeBilibiliSubtitles(results, source);
            const fmt = convertSubtitleOutput(outputFormat || 'md', mergedMd, undefined, stripTimestamps);
            const mergedLabel = await runtimeT('runtime.bilibiliMergedContent');
            const mergedFilename = `${sanitizeBilibiliFilename(source.title)}_${sanitizeBilibiliFilename(mergedLabel)}${fmt.ext}`;
            const encoded = btoa(unescape(encodeURIComponent(fmt.content)));
            const dataUrl = `data:${fmt.mime};base64,${encoded}`;
            await chrome.downloads.download({ url: dataUrl, filename: mergedFilename, saveAs: false });
            sendProgress({ phase: 'done' });
            clearOpState();
          } else {
            const zip = new JSZip();
            let skipped = 0;
            for (let i = 0; i < videos.length; i++) {
              const video = videos[i];
              sendProgress({ phase: 'downloading', current: i + 1, total: videos.length, title: video.part || video.title, bvid: video.bvid });
              const result = await fetchVideoSubtitle(video, ownerName, desc, stripTimestamps);
              if (!result.markdown) { skipped++; }
              else {
                let markdown = result.markdown;
                const displayTitle = video.part ? `${video.title} - ${video.part}` : video.title;
                const fmt = convertSubtitleOutput(outputFormat || 'md', markdown, result.rawBody, stripTimestamps);
                const filename = `${sanitizeBilibiliFilename(displayTitle)}${fmt.ext}`;
                zip.file(filename, fmt.content);
              }
              if (i < videos.length - 1) {
                await new Promise(r => setTimeout(r, 1500));
              }
            }
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const reader = new FileReader();
            const dataUrl = await new Promise<string>((resolve, reject) => {
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(zipBlob);
            });
            const zipRoot = source?.title || await runtimeT('runtime.subtitleArchive');
            const zipName = `${sanitizeBilibiliFilename(zipRoot)}.zip`;
            await chrome.downloads.download({ url: dataUrl, filename: zipName, saveAs: true });
            sendProgress({ phase: 'done', downloaded: videos.length - skipped, skipped });
            clearOpState();
          }
        } catch (err) {
          sendProgress({ phase: 'error', error: String(err) });
          clearOpState();
        }
      });
      return;
    }


  });

  // Handle messages from popup and content scripts
  chrome.runtime.onMessage.addListener(
    (
      message: MessageType,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: MessageResponse) => void
    ) => {
      // Pass sender tab ID so import operations target the correct notebook tab
      const senderTabId = sender.tab?.id;
      handleMessage(message, senderTabId)
        .then((data) => sendResponse({ success: true, data }))
        .catch((error) =>
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        );

      // Return true to indicate we'll send response asynchronously
      return true;
    }
  );
});

// ── Rescue failed sources ──
// Fetch page content ourselves and import as text (bypasses NotebookLM's URL fetch)
interface RescueResult {
  url: string;
  status: 'success' | 'error';
  title?: string;
  content?: string;
  error?: string;
}

/**
 * Detect if fetched content is a blocked/anti-scraping page rather than real article content.
 * Returns error message if blocked, null if content looks legit.
 */
async function detectBlockedContent(markdown: string, html: string, url: string): Promise<string | null> {
  // Too short — no real content
  if (markdown.length < 50) {
    return runtimeT('runtime.contentTooShort');
  }

  // WeChat-specific: blocked page has no rich_media_content and empty title
  if (url.includes('mp.weixin.qq.com')) {
    const hasContent = /rich_media_content|js_content/.test(html);
    const hasTitle = /<title>[^<]{2,}<\/title>/.test(html);
    if (!hasContent && !hasTitle) {
      return runtimeT('runtime.wechatBlocked');
    }
  }

  // Generic anti-scraping signals
  const blockedPatterns = [
    /环境异常.*验证/s,
    /完成验证后.*继续访问/s,
    /访问过于频繁/,
    /请完成.*安全验证/s,
    /robot.*verification/i,
    /captcha.*required/i,
    /access.*denied.*bot/i,
    /please.*verify.*human/i,
    /cloudflare.*checking/i,
    /just.*moment.*checking/i,
    /enable.*javascript.*cookies/i,
  ];

  for (const pattern of blockedPatterns) {
    if (pattern.test(markdown)) {
      return runtimeT('runtime.antiScrapingBlocked');
    }
  }

  // Content ratio check: if markdown is mostly boilerplate (very few words relative to HTML size)
  const wordCount = markdown.split(/\s+/).filter((w) => w.length > 1).length;
  const htmlSize = html.length;
  if (htmlSize > 10000 && wordCount < 30) {
    return runtimeT('runtime.emptyShell');
  }

  return null;
}

/** URLs that need tab-based rendering (SPA / dynamic content) */
function needsTabBasedExtraction(url: string): boolean {
  return /^https?:\/\/(www\.)?(x\.com|twitter\.com)\//.test(url)
    || /^https?:\/\/developer\.huawei\.com\//.test(url);
}

async function rescueSources(urls: string[], targetTabId?: number): Promise<RescueResult[]> {
  const results: RescueResult[] = [];

  // Split: SPA sites go to tab-based extraction, others use fetch
  const tabUrls = urls.filter(needsTabBasedExtraction);
  const fetchUrls = urls.filter(u => !needsTabBasedExtraction(u));

  // Handle tab-based URLs via the same repair/extract pipeline
  if (tabUrls.length > 0) {
    const tabResults = await repairDynamicSources(tabUrls, false, targetTabId, RESCUE_PREFIX);
    results.push(...tabResults);
  }

  for (const url of fetchUrls) {
    try {
      console.log(`[rescue] Fetching: ${url}`);
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) {
        // If fetch fails (e.g. 403), fall back to tab-based extraction
        console.log(`[rescue] Fetch returned ${resp.status}, falling back to tab-based extraction: ${url}`);
        const fallbackResults = await repairDynamicSources([url], false, targetTabId, RESCUE_PREFIX);
        results.push(...fallbackResults);
        continue;
      }

      const html = await resp.text();

      // Convert HTML to Markdown via offscreen document (Turndown)
      let markdown: string;
      let title: string;
      try {
        const result = await convertHtmlToMarkdown(html);
        markdown = result.markdown;
        title = result.title || new URL(url).hostname;
      } catch {
        // Fallback: basic text extraction
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        title = titleMatch?.[1]?.trim()?.replace(/\s+/g, ' ') || new URL(url).hostname;
        markdown = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }

      // Content quality check — detect anti-scraping / blocked pages
      const contentIssue = await detectBlockedContent(markdown, html, url);
      if (contentIssue) {
        results.push({ url, status: 'error', error: contentIssue });
        continue;
      }

      // Prepend title and source URL for reference
      const content = `# ${title}\n\nSource: ${url}\n\n${markdown}`;

      // Import as text to NotebookLM
      const success = await importText(content, title, targetTabId, RESCUE_PREFIX);
      results.push({
        url,
        status: success ? 'success' : 'error',
        title,
        error: success ? undefined : await runtimeT('runtime.importNotebooklmFailed'),
      });

      // Delay between imports (wait for dialog to fully close)
      if (urls.indexOf(url) < urls.length - 1) {
        await new Promise((r) => setTimeout(r, 3000));
      }
    } catch (error) {
      results.push({
        url,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return results;
}

// ── Repair WeChat sources ──
// Open page in browser tab → extract rendered content → import as text
// Tab-based content extraction for dynamic/SPA sites (X.com, WeChat, etc.)
// extractOnly=true returns content without importing to NotebookLM (for PDF export)
async function repairDynamicSources(
  urls: string[],
  extractOnly = false,
  targetTabId?: number,
  renamePrefix?: string,
): Promise<RescueResult[]> {
  return _tabBasedExtract(urls, extractOnly, targetTabId, renamePrefix);
}

async function repairWechatSources(urls: string[], targetTabId?: number): Promise<RescueResult[]> {
  return _tabBasedExtract(urls, false, targetTabId, REPAIR_PREFIX);
}

type ProgressCallback = (data: Record<string, unknown>) => void;

const RESCUE_PREFIX = '🛟 ';
const REPAIR_PREFIX = '🔧 ';

async function rescueSourcesWithProgress(
  urls: string[],
  targetTabId?: number,
  sendProgress?: ProgressCallback
): Promise<RescueResult[]> {
  const results: RescueResult[] = [];

  const tabUrls = urls.filter(needsTabBasedExtraction);
  const fetchUrls = urls.filter(u => !needsTabBasedExtraction(u));

  if (tabUrls.length > 0) {
    const tabResults = await _tabBasedExtractWithProgress(tabUrls, false, targetTabId, sendProgress, RESCUE_PREFIX);
    results.push(...tabResults);
  }

  for (const url of fetchUrls) {
    sendProgress?.({ phase: 'item-start', url });
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) {
        sendProgress?.({ phase: 'item-start', url });
        console.log(`[rescue] Fetch returned ${resp.status}, falling back to tab-based: ${url}`);
        const fallbackResults = await _tabBasedExtractWithProgress([url], false, targetTabId, sendProgress, RESCUE_PREFIX);
        results.push(...fallbackResults);
        continue;
      }
      const html = await resp.text();
      let markdown: string, title: string;
      try {
        const cvt = await convertHtmlToMarkdown(html);
        markdown = cvt.markdown;
        title = cvt.title || new URL(url).hostname;
      } catch {
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        title = titleMatch?.[1]?.trim()?.replace(/\s+/g, ' ') || new URL(url).hostname;
        markdown = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
      const contentIssue = await detectBlockedContent(markdown, html, url);
      if (contentIssue) {
        const r: RescueResult = { url, status: 'error', error: contentIssue };
        results.push(r);
        sendProgress?.({ phase: 'item-done', url, result: r });
        continue;
      }
      const content = `# ${title}\n\nSource: ${url}\n\n${markdown}`;
      const success = await importText(content, title, targetTabId, RESCUE_PREFIX);
      const r: RescueResult = { url, status: success ? 'success' : 'error', title, error: success ? undefined : await runtimeT('runtime.importNotebooklmFailed') };
      results.push(r);
      sendProgress?.({ phase: 'item-done', url, result: r });
      if (urls.indexOf(url) < urls.length - 1) await new Promise(res => setTimeout(res, 3000));
    } catch (error) {
      const r: RescueResult = { url, status: 'error', error: error instanceof Error ? error.message : 'Unknown error' };
      results.push(r);
      sendProgress?.({ phase: 'item-done', url, result: r });
    }
  }
  return results;
}

async function repairWechatSourcesWithProgress(
  urls: string[],
  targetTabId?: number,
  sendProgress?: ProgressCallback
): Promise<RescueResult[]> {
  return _tabBasedExtractWithProgress(urls, false, targetTabId, sendProgress, REPAIR_PREFIX);
}

async function _tabBasedExtractWithProgress(
  urls: string[],
  extractOnly = false,
  targetTabId?: number,
  sendProgress?: ProgressCallback,
  renamePrefix?: string,
): Promise<RescueResult[]> {
  const results: RescueResult[] = [];

  for (const url of urls) {
    sendProgress?.({ phase: 'item-start', url });
    try {
      let openUrl = url;
      const xArticleFocusMatch = url.match(/^https?:\/\/(www\.)?(x\.com|twitter\.com)\/(\w+)\/article\/(\d+)/);
      if (xArticleFocusMatch) { /* already focus mode */ }

      const tab = await chrome.tabs.create({ url: openUrl, active: false });
      if (!tab.id) throw new Error('Failed to create tab');

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 15000);
        const listener = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
          if (tabId === tab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener); clearTimeout(timeout); resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });

      const isXcom = /^https?:\/\/(www\.)?(x\.com|twitter\.com)\//.test(url);
      const renderWait = isXcom ? 8000 : needsTabBasedExtraction(url) ? 5000 : 3000;
      await new Promise(r => setTimeout(r, renderWait));

      const extractResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: _tabExtractorFunction,
      });

      await chrome.tabs.remove(tab.id);

      const extracted = extractResult?.[0]?.result as { success: boolean; title?: string; content?: string; error?: string } | undefined;
      if (!extracted?.success || !extracted.content) {
        const r: RescueResult = { url, status: 'error', error: await localizeRuntimeError(extracted?.error) };
        results.push(r);
        sendProgress?.({ phase: 'item-done', url, result: r });
        continue;
      }
      if (extracted.content.length < 100) {
        const r: RescueResult = { url, status: 'error', error: await runtimeT('runtime.contentTooShortBlocked') };
        results.push(r);
        sendProgress?.({ phase: 'item-done', url, result: r });
        continue;
      }

      const title = extracted.title || new URL(url).hostname;
      const rawContent = extracted.content;
      const content = `# ${title}\n\nSource: ${url}\n\n${rawContent}`;

      if (extractOnly) {
        const r: RescueResult = { url, status: 'success', title, content: rawContent };
        results.push(r);
        sendProgress?.({ phase: 'item-done', url, result: r });
      } else {
        const success = await importText(content, title, targetTabId, renamePrefix);
        const r: RescueResult = { url, status: success ? 'success' : 'error', title, content: rawContent, error: success ? undefined : await runtimeT('runtime.importNotebooklmFailed') };
        results.push(r);
        sendProgress?.({ phase: 'item-done', url, result: r });
      }

      if (urls.indexOf(url) < urls.length - 1) await new Promise(r => setTimeout(r, 3000));
    } catch (error) {
      const r: RescueResult = { url, status: 'error', error: error instanceof Error ? error.message : 'Unknown error' };
      results.push(r);
      sendProgress?.({ phase: 'item-done', url, result: r });
    }
  }
  return results;
}

// Shared extractor function injected into tabs (must be self-contained, no closures)
function _tabExtractorFunction(): { success: boolean; title?: string; content?: string; error?: string } {
  const currentUrl = window.location.href;

  // ── X.com / Twitter extractor ──
  if (currentUrl.includes('x.com/') || currentUrl.includes('twitter.com/')) {
    const xArticleContent = document.querySelector('[data-testid="twitterArticleRichTextView"]');
    if (xArticleContent) {
      const titleEl = document.querySelector('[data-testid="twitter-article-title"]');
      const title = titleEl?.textContent?.trim()
        || document.title.replace(/ \/ X$/, '').replace(/ on X:.*$/, '').trim();
      const content = (xArticleContent as HTMLElement).innerText?.trim() || '';
      if (content.length >= 100) return { success: true, title, content };
    }
    const tweetTexts = document.querySelectorAll('article [data-testid="tweetText"]');
    if (tweetTexts.length > 0) {
      const title = document.title.replace(/ \/ X$/, '').replace(/ on X:.*$/, '').trim();
      const parts: string[] = [];
      tweetTexts.forEach(el => {
        const text = (el as HTMLElement).innerText?.trim();
        if (text && text.length > 10) parts.push(text);
      });
      const content = parts.join('\n\n');
      if (content.length >= 50) return { success: true, title, content };
    }
    return { success: false, error: 'runtime.xContentNotFound' };
  }

  // ── Huawei Developer Docs extractor ──
  if (currentUrl.includes('developer.huawei.com')) {
    const docTitle = document.querySelector('h1')?.textContent?.trim()
      || document.title.replace(/-.*$/, '').trim();
    const docContent = document.querySelector('.markdown-body')
      || document.querySelector('#mark .idpContent')
      || document.querySelector('.document-content-html')
      || document.querySelector('#document-content .layout-content');
    if (docContent && (docContent as HTMLElement).innerText?.trim().length > 50) {
      return { success: true, title: docTitle, content: (docContent as HTMLElement).innerText.trim() };
    }
    return { success: false, error: 'runtime.huaweiExtractFailed' };
  }

  // ── WeChat / Generic extractor ──
  const contentEl = document.querySelector('#js_content')
    || document.querySelector('.rich_media_content')
    || document.querySelector('article')
    || document.querySelector('.rich_media_area_primary');
  const titleEl = document.querySelector('.rich_media_title, #activity-name, h1');
  const title = titleEl?.textContent?.trim() || document.title || '';
  if (!contentEl || contentEl.textContent?.trim().length === 0) {
    return { success: false, error: 'runtime.wechatVerificationRequired' };
  }
  const content = (contentEl as HTMLElement).innerText || contentEl.textContent || '';
  return { success: true, title, content: content.trim() };
}

async function _tabBasedExtract(
  urls: string[],
  extractOnly = false,
  targetTabId?: number,
  renamePrefix?: string,
): Promise<RescueResult[]> {
  const results: RescueResult[] = [];

  for (const url of urls) {
    try {
      console.log(`[repair] Opening: ${url}`);

      // For X.com article focus-mode URLs, use as-is; for /status/ URLs keep original
      // (we can't know if a /status/ URL is an article until we render it)
      let openUrl = url;
      const xArticleFocusMatch = url.match(/^https?:\/\/(www\.)?(x\.com|twitter\.com)\/(\w+)\/article\/(\d+)/);
      if (xArticleFocusMatch) {
        console.log(`[repair] X.com: already focus mode URL`);
      }

      // Open the URL in a new tab
      const tab = await chrome.tabs.create({ url: openUrl, active: false });
      if (!tab.id) throw new Error('Failed to create tab');

      // Wait for page to load
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(); // resolve even on timeout, we'll try to extract anyway
        }, 15000);

        const listener = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
          if (tabId === tab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            clearTimeout(timeout);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });

      // Give extra time for dynamic content to render (SPA sites need more)
      // X.com articles need 8s+ in background tabs for full content rendering
      const isXcom = /^https?:\/\/(www\.)?(x\.com|twitter\.com)\//.test(url);
      const renderWait = isXcom ? 8000 : needsTabBasedExtraction(url) ? 5000 : 3000;
      await new Promise((r) => setTimeout(r, renderWait));

      // Extract content from the rendered page (site-specific extractors)
      const extractResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: _tabExtractorFunction,
      });

      // Close the tab
      await chrome.tabs.remove(tab.id);

      const extracted = extractResult?.[0]?.result as {
        success: boolean;
        title?: string;
        content?: string;
        error?: string;
      } | undefined;

      if (!extracted?.success || !extracted.content) {
        results.push({
          url,
          status: 'error',
          error: await localizeRuntimeError(extracted?.error),
        });
        continue;
      }

      // Content quality check
      if (extracted.content.length < 100) {
        results.push({
          url,
          status: 'error',
          error: await runtimeT('runtime.contentTooShortBlocked'),
        });
        continue;
      }

      const title = extracted.title || new URL(url).hostname;
      const rawContent = extracted.content;
      const content = `# ${title}\n\nSource: ${url}\n\n${rawContent}`;

      if (extractOnly) {
        // Return content without importing (for PDF export)
        results.push({ url, status: 'success', title, content: rawContent });
      } else {
        // Import as text
        const success = await importText(content, title, targetTabId, renamePrefix);
        results.push({
          url,
          status: success ? 'success' : 'error',
          title,
          content: rawContent,
          error: success ? undefined : await runtimeT('runtime.importNotebooklmFailed'),
        });
      }

      if (urls.indexOf(url) < urls.length - 1) {
        await new Promise((r) => setTimeout(r, 3000));
      }
    } catch (error) {
      results.push({
        url,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return results;
}

async function handleMessage(message: MessageType, senderTabId?: number): Promise<unknown> {
  const type = (message as any).type;
  console.log('[background] Incoming message:', type, message);

  // ── Background self-broadcast guard (e.g. YT_FETCH_RESULT) ──
  if (type === 'YT_FETCH_RESULT') {
    return; // Broadcast from background to sidepanel — ignore in background
  }

  // ── YouTube SPA URL change (from content script) ──
  if (type === 'YT_URL_CHANGED') {
    const { url } = message as { url: string; tabId: number };
    const tabId = senderTabId || 0;

    if (!url || !tabId) return { acknowledged: true };

    let state = ytUrlStates.get(tabId);
    if (!state) {
      state = { seq: 0, latestUrl: null };
      ytUrlStates.set(tabId, state);
    }

    // Clear any pending debounce
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    state.latestUrl = url;

    // Return immediately — actual fetch happens after debounce
    state.debounceTimer = setTimeout(async () => {
      const currentUrl = state!.latestUrl;
      if (!currentUrl) return;

      state!.seq++;
      const requestSeq = state!.seq;

      console.log(`[background] YT fetch debounced: ${currentUrl.slice(0, 80)} (seq=${requestSeq})`);

      try {
        const result = await fetchYouTube(currentUrl);

        // Check if still the latest request for this tab
        if (state!.seq !== requestSeq) {
          console.log(`[background] YT result stale (seq ${requestSeq} != ${state!.seq}), discarding`);
          return;
        }

        // Broadcast to sidepanel
        broadcastToSidepanel({
          type: 'YT_FETCH_RESULT',
          url: currentUrl,
          result,
        });
      } catch (err) {
        if (state!.seq !== requestSeq) return;
        broadcastToSidepanel({
          type: 'YT_FETCH_RESULT',
          url: currentUrl,
          result: null,
          error: err instanceof Error ? err.message : 'Fetch failed',
        });
      }
    }, 500);

    return { acknowledged: true };
  }

  // ── YouTube Subtitle Detection ──
  if (type === 'DETECT_YOUTUBE_SUBTITLES') {
    const videoId = (message as any).videoId as string;
    try {
      const available = await checkYouTubeSubtitles(videoId);
      return { available };
    } catch {
      return { available: false };
    }
  }

  // ── Force Intercept Bilibili Messages (Defensive) ──
  if (type === 'FETCH_BILIBILI') {
    const { url } = message as { url: string };
    const parsed = parseBilibiliUrl(url);
    if (!parsed) throw new Error(await runtimeT('runtime.bilibiliUrlParseFailed'));
    return await fetchBilibiliVideo(parsed.bvid);
  }
  if (type === 'FETCH_BILIBILI_SPACE') {
    const { mid } = message as { mid: string };
    return await fetchBilibiliUserVideos(mid);
  }
  if (type === 'FETCH_BILIBILI_FAVORITE') {
    const { url } = message as { url: string };
    return await fetchBilibiliFavoriteList(url);
  }
  if (type === 'DOWNLOAD_BILIBILI_SUBTITLES') {
    const { videos, ownerName, desc } = message as any;
    const settings = await getSettings();
    let downloaded = 0; let skipped = 0;
    console.log(`[background] Starting download for ${videos.length} videos...`);
    for (const video of videos) {
      console.log(`[background] Fetching ${video.bvid} (${videos.indexOf(video) + 1}/${videos.length})`);
      const result = await fetchVideoSubtitle(video, ownerName, desc, settings.stripBilibiliTimestamps);
      if (!result.markdown) { skipped++; }
      else {
        const displayTitle = video.part ? `${video.title} - ${video.part}` : video.title;
        const filename = `${sanitizeBilibiliFilename(displayTitle)}.md`;
        const encoded = btoa(unescape(encodeURIComponent(result.markdown)));
        const dataUrl = `data:text/markdown;base64,${encoded}`;
        await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
        downloaded++;
      }
      if (videos.indexOf(video) < videos.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    return { downloaded, skipped };
  }
  // Single video subtitle download (TXT button on each list item)
  if (type === 'DOWNLOAD_BILIBILI_SINGLE_SUBTITLE') {
    const { video, ownerName, desc: videoDesc } = message as any;
    const settings = await getSettings();
    const result = await fetchVideoSubtitle(video, ownerName || '', videoDesc || '', settings.stripBilibiliTimestamps);
    if (!result.markdown) {
      return { success: false, error: await runtimeT('runtime.bilibiliNoSubtitle') };
    }
    const displayTitle = video.part ? `${video.title} - ${video.part}` : video.title;
    const filename = `${sanitizeBilibiliFilename(displayTitle)}.txt`;
    const plainText = result.markdown.replace(/^# .+\n\n?/gm, '').replace(/\*\*/g, '').replace(/\n{3,}/g, '\n\n').trim();
    const encoded = btoa(unescape(encodeURIComponent(plainText)));
    const dataUrl = `data:text/plain;base64,${encoded}`;
    await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
    return { success: true };
  }
  if (type === 'DOWNLOAD_BILIBILI_ZIP') {
    const { videos, ownerName, desc } = message as any;
    const settings = await getSettings();
    const zip = new JSZip();
    let added = 0;
    console.log(`[background] Starting ZIP download for ${videos.length} videos...`);
    for (const video of videos) {
      console.log(`[background] Fetching ${video.bvid} (${videos.indexOf(video) + 1}/${videos.length})`);
      const result = await fetchVideoSubtitle(video, ownerName, desc, settings.stripBilibiliTimestamps);
      if (result.markdown) {
        const displayTitle = video.part ? `${video.title} - ${video.part}` : video.title;
        zip.file(`${sanitizeBilibiliFilename(displayTitle)}.md`, result.markdown);
        added++;
      }
      if (videos.indexOf(video) < videos.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    if (added > 0) {
      const content = await zip.generateAsync({ type: 'base64' });
      const zipFilename = `Bilibili_Subtitles_${new Date().getTime()}.zip`;
      await chrome.downloads.download({ url: `data:application/zip;base64,${content}`, filename: zipFilename, saveAs: false });
    }
    return { added };
  }
  if (type === 'IMPORT_BILIBILI_SUBTITLES') {
    const { videos, ownerName, desc } = message as any;
    const settings = await getSettings();
    let imported = 0; let skipped = 0;
    setOpState({ active: true, phase: 'importing', kind: 'import', current: 0, total: videos.length, title: await runtimeT('runtime.bilibiliPreparingImport'), timestamp: Date.now() });
    for (const video of videos) {
      setOpState({ active: true, phase: 'importing', kind: 'import', current: videos.indexOf(video), total: videos.length, title: video.part || video.title, timestamp: Date.now() });
      const result = await fetchVideoSubtitle(video, ownerName, desc, settings.stripBilibiliTimestamps);
      if (!result.markdown) { skipped++; continue; }
      let markdown = result.markdown;
      const displayTitle = video.part ? `${video.title} - ${video.part}` : video.title;
      const success = await importText(markdown, displayTitle, senderTabId);
      if (success) { imported++; } else { skipped++; }
      if (videos.indexOf(video) < videos.length - 1) await new Promise(r => setTimeout(r, 2500));
    }
    clearOpState();
    if (imported === 0 && skipped > 0) {
      throw new Error(await runtimeT('runtime.bilibiliImportFailedDetail'));
    }
    return { imported, skipped };
  }

  if (type === 'IMPORT_BILIBILI_MERGED') {
    const { videos, ownerName, desc, source } = message as any;
    const settings = await getSettings();
    const results = [];
    setOpState({ active: true, phase: 'importing', kind: 'import', current: 0, total: videos.length, title: await runtimeT('runtime.bilibiliFetchingSubtitle'), timestamp: Date.now() });
    console.log(`[background] Starting merged import for ${videos.length} videos...`);
    for (const video of videos) {
      console.log(`[background] Processing ${video.bvid} (${videos.indexOf(video) + 1}/${videos.length})`);
      setOpState({ active: true, phase: 'importing', kind: 'import', current: videos.indexOf(video), total: videos.length, title: video.part || video.title, timestamp: Date.now() });
      const result = await fetchVideoSubtitle(video, ownerName, desc, settings.stripBilibiliTimestamps);
      results.push(result);
      if (videos.indexOf(video) < videos.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    const validResults = results.filter(r => r.markdown !== null);
    if (validResults.length === 0) {
      clearOpState();
      throw new Error(await runtimeT('runtime.bilibiliAllNoSubtitle'));
    }
    let mergedMd = mergeBilibiliSubtitles(results, source);
    const success = await importText(mergedMd, await runtimeT('runtime.bilibiliMergedContentTitle', { title: source.title }), senderTabId);
    clearOpState();
    return { success };
  }

  if (type === 'DOWNLOAD_BILIBILI_MERGED') {
    const { videos, ownerName, desc, source } = message as any;
    const settings = await getSettings();
    const results = [];
    console.log(`[background] Starting merged download for ${videos.length} videos...`);
    for (const video of videos) {
      console.log(`[background] Fetching ${video.bvid} (${videos.indexOf(video) + 1}/${videos.length})`);
      const result = await fetchVideoSubtitle(video, ownerName, desc, settings.stripBilibiliTimestamps);
      results.push(result);
      if (videos.indexOf(video) < videos.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    const mergedMd = mergeBilibiliSubtitles(results, source);
    const mergedLabel = await runtimeT('runtime.bilibiliMergedContent');
    const filename = `${sanitizeBilibiliFilename(source.title)}_${sanitizeBilibiliFilename(mergedLabel)}.md`;
    const encoded = btoa(unescape(encodeURIComponent(mergedMd)));
    const dataUrl = `data:text/markdown;base64,${encoded}`;
    await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
    return { success: true };
  }

  if (type === 'UPLOAD_BILIBILI_TO_DRIVE') {
    const { videos, ownerName, desc, source } = message as any;
    const settings = await getSettings();
    const results = [];
    console.log(`[background] Starting Drive upload for ${videos.length} videos...`);
    for (const video of videos) {
      console.log(`[background] Fetching ${video.bvid} (${videos.indexOf(video) + 1}/${videos.length})`);
      const result = await fetchVideoSubtitle(video, ownerName, desc, settings.stripBilibiliTimestamps);
      results.push(result);
      if (videos.indexOf(video) < videos.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    const mergedMd = mergeBilibiliSubtitles(results, source);
    const displayName = sanitizeBilibiliFilename(source.title);
    const driveResult = await uploadToDrive(mergedMd, displayName);
    if (driveResult.success) {
      console.log('[background] Drive upload succeeded:', driveResult.fileName);
    } else {
      console.error('[background] Drive upload failed:', driveResult.error);
    }
    return driveResult;
  }

  switch (message.type) {
    case 'IMPORT_URL':
      return await importUrl(message.url, senderTabId);

    case 'IMPORT_BATCH':
      return await importBatch(message.urls, undefined, senderTabId);

    case 'GET_CURRENT_TAB':
      return await getCurrentTabUrl();

    case 'GET_ALL_TABS':
      return await getAllTabUrls();

    case 'GET_HISTORY':
      return await getHistory(message.limit);

    case 'CLEAR_HISTORY':
      return await clearHistory();

    case 'EXTRACT_CLAUDE_CONVERSATION':
      return await extractClaudeConversation(message.tabId);

    case 'IMPORT_CLAUDE_CONVERSATION': {
      const conv = message.conversation as ClaudeConversation;
      const pairs = conv.pairs || [];
      if (pairs.length > 0) {
        // New pairs-based import
        const platform = conv.url.includes('chatgpt.com') || conv.url.includes('chat.openai.com')
          ? 'ChatGPT' : conv.url.includes('gemini.google.com') ? 'Gemini' : 'Claude';
        const sourceLabel = await runtimeT('claude.sourceLabel');
        const platformConversation = await runtimeT('claude.platformConversation', { platform });
        const lines: string[] = [`# ${conv.title}`, '', `**${sourceLabel}**: ${platformConversation}`, `**URL**: ${conv.url}`, '', '---', ''];
        for (const pair of pairs) {
          if (pair.question) { lines.push('## 👤 Human', '', pair.question, ''); }
          if (pair.answer) { lines.push(`## 🤖 ${platform}`, '', pair.answer, ''); }
          lines.push('---', '');
        }
        return await importText(lines.join('\n'), conv.title, senderTabId);
      }
      // Fallback: old message-based import
      const formattedText = formatConversationForImport(conv, message.selectedMessageIds);
      return await importText(formattedText, conv.title, senderTabId);
    }

    case 'FETCH_PODCAST': {
      const result = await fetchPodcast(message.url, { count: message.count });
      return result;
    }

    case 'FETCH_YOUTUBE': {
      return await fetchYouTube(message.url);
    }

    case 'FETCH_YOUTUBE_MORE': {
      return await fetchYouTubeMore(message.continuation);
    }

    case 'GET_FAILED_SOURCES': {
      // Ensure content script is injected, then forward
      try {
        await chrome.scripting.executeScript({
          target: { tabId: message.tabId },
          files: ['content-scripts/notebooklm.js'],
        });
      } catch { /* already injected */ }
      await new Promise((r) => setTimeout(r, 300));

      return new Promise((resolve) => {
        chrome.tabs.sendMessage(message.tabId, { type: 'GET_FAILED_SOURCES' }, (resp) => {
          if (chrome.runtime.lastError || !resp?.success) {
            console.log('[rescue] GET_FAILED_SOURCES error:', chrome.runtime.lastError?.message);
            resolve([]);
          } else {
            resolve(resp.data || []);
          }
        });
      });
    }

    case 'RESCUE_SOURCES': {
      return await rescueSources(message.urls, senderTabId);
    }

    case 'REPAIR_WECHAT_SOURCES': {
      return await repairWechatSources(message.urls, senderTabId);
    }

    case 'DOWNLOAD_PODCAST':
      // Handled via port connection (onConnect), not onMessage
      return { success: true };

    // ── Notebook Info (Refactored: Pure API approach) ──
    // Replaced the legacy two-phase strategy (API → content-script fallback)
    // with a single linear API fetch. The fallback required an open NLM tab
    // and was unreliable across account switches. The batchexecute API works
    // without any tabs open and correctly handles ?authuser=X for multi-account.
    case 'GET_NOTEBOOKS': {
      const notebooks = await fetchNotebooksApi(message.force);

      // Detect current notebook from any open NLM tab URL (UI convenience)
      let current: { id: string; title: string; url: string } | null = null;
      const nlmTabs = await chrome.tabs.query({ url: 'https://notebooklm.google.com/notebook/*' });
      if (nlmTabs.length > 0) {
        const tabUrl = nlmTabs[0].url || '';
        const match = tabUrl.match(/\/notebook\/([^/?#]+)/);
        if (match) {
          current = notebooks.find(nb => nb.id === match[1]) || null;
        }
      }

      return { current, notebooks };
    }

    default:
      console.error('[background] Unknown message type:', (message as any).type, message);
      throw new Error(`Unknown message type: ${(message as any).type}`);
  }
}
