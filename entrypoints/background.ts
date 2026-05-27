import { parseRssFeed } from '@/services/rss-parser';
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
import { fetchYouTube, fetchYouTubeMore } from '@/services/youtube';
import {
  fetchBilibiliVideo,
  fetchVideoSubtitle,
  sanitizeBilibiliFilename,
  parseBilibiliUrl,
  mergeBilibiliSubtitles,
  parseBilibiliSpaceUrl,
  fetchBilibiliUserVideos,
} from '@/services/bilibili';
import type { BilibiliVideoItem, BilibiliSourceInfo } from '@/services/bilibili';
import { polishSubtitlesWithChunks } from '@/services/ai-polish';
import { setOpState, clearOpState, type OpState } from '@/services/op-state';
import { uploadToDrive } from '@/services/google-drive';
import JSZip from 'jszip';
import type { PodcastInfo, PodcastEpisode } from '@/services/podcast';

import {
  extractClaudeConversation,
  formatConversationForImport,
} from '@/services/claude-conversation';
import {
  addBookmark,
  removeBookmark,
  removeBookmarks,
  moveBookmark,
  getBookmarks,
  getCollections,
  createCollection,
  isBookmarked,
} from '@/services/bookmarks';
import type { MessageType, MessageResponse, ClaudeConversation } from '@/lib/types';

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

export default defineBackground(() => {
  console.log('Flow2Note background service started');

  // Click toolbar icon → open side panel (must be at top level, not just onInstalled)
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  // Create context menus on install
  chrome.runtime.onInstalled.addListener((details) => {
    // Open welcome page on first install
    if (details.reason === 'install') {
      chrome.tabs.create({ url: chrome.runtime.getURL('/welcome.html') });
    }

    // Menu item for importing current page
    chrome.contextMenus.create({
      id: MENU_ID_PAGE,
      title: '导入此页面到 NotebookLM',
      contexts: ['page'],
    });

    // Menu item for importing a link
    chrome.contextMenus.create({
      id: MENU_ID_LINK,
      title: '导入此链接到 NotebookLM',
      contexts: ['link'],
    });
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

        const { videos, ownerName, desc, source, aiPolish } = msg as any;
        const isMerged = msg.type === 'BILIBILI_DOWNLOAD_MERGED';

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
              const result = await fetchVideoSubtitle(video, ownerName, desc);
              results.push(result);
              if (i < videos.length - 1) {
                await new Promise(r => setTimeout(r, 1500));
              }
            }
            let mergedMd = mergeBilibiliSubtitles(results, source);
            if (aiPolish) {
              const allBodies = results.flatMap(r => (r as any).rawBody || []);
              const polished = await polishSubtitlesWithChunks(mergedMd, allBodies.length > 0 ? allBodies : undefined, (c, t) => {
                sendProgress({ phase: 'polishing', current: c, total: t, title: `AI 润色 ${c}/${t}` });
              });
              if (!polished.success && polished.error) {
                sendProgress({ phase: 'error', error: `AI 润色失败：${polished.error}，请稍后重试` });
                clearOpState();
                return;
              }
              if (polished.success) mergedMd = polished.polished;
            }
            const filename = `${sanitizeBilibiliFilename(source.title)}_合并内容.md`;
            const encoded = btoa(unescape(encodeURIComponent(mergedMd)));
            const dataUrl = `data:text/markdown;base64,${encoded}`;
            await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
            sendProgress({ phase: 'done' });
            clearOpState();
          } else {
            let downloaded = 0; let skipped = 0;
            for (let i = 0; i < videos.length; i++) {
              const video = videos[i];
              sendProgress({ phase: 'downloading', current: i + 1, total: videos.length, title: video.part || video.title, bvid: video.bvid });
              const result = await fetchVideoSubtitle(video, ownerName, desc);
              if (!result.markdown) { skipped++; }
              else {
                let markdown = result.markdown;
                if (aiPolish) {
                  const polished = await polishSubtitlesWithChunks(markdown, result.rawBody, (c, t) => {
                    sendProgress({ phase: 'polishing', current: c, total: t, title: `${video.part || video.title} ${c}/${t}` });
                  });
                  if (!polished.success && polished.error) {
                    sendProgress({ phase: 'error', error: `AI 润色失败：${polished.error}，请稍后重试` });
                    clearOpState();
                    return;
                  }
                  if (polished.success) markdown = polished.polished;
                }
                const displayTitle = video.part ? `${video.title} - ${video.part}` : video.title;
                const filename = `${sanitizeBilibiliFilename(displayTitle)}.md`;
                const encoded = btoa(unescape(encodeURIComponent(markdown)));
                const dataUrl = `data:text/markdown;base64,${encoded}`;
                await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
                downloaded++;
              }
              if (i < videos.length - 1) {
                await new Promise(r => setTimeout(r, 1500));
              }
            }
            sendProgress({ phase: 'done', downloaded, skipped });
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
function detectBlockedContent(markdown: string, html: string, url: string): string | null {
  // Too short — no real content
  if (markdown.length < 50) {
    return '内容太少，可能是付费/登录墙';
  }

  // WeChat-specific: blocked page has no rich_media_content and empty title
  if (url.includes('mp.weixin.qq.com')) {
    const hasContent = /rich_media_content|js_content/.test(html);
    const hasTitle = /<title>[^<]{2,}<\/title>/.test(html);
    if (!hasContent && !hasTitle) {
      return '微信公众号反爬拦截，需在微信内打开';
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
      return '页面被反爬机制拦截';
    }
  }

  // Content ratio check: if markdown is mostly boilerplate (very few words relative to HTML size)
  const wordCount = markdown.split(/\s+/).filter((w) => w.length > 1).length;
  const htmlSize = html.length;
  if (htmlSize > 10000 && wordCount < 30) {
    return '页面内容为空壳，可能需要登录';
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
        results.push({ url, status: 'error', error: `HTTP ${resp.status}` });
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
      const contentIssue = detectBlockedContent(markdown, html, url);
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
        error: success ? undefined : '导入 NotebookLM 失败',
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
        const r: RescueResult = { url, status: 'error', error: `HTTP ${resp.status}` };
        results.push(r);
        sendProgress?.({ phase: 'item-done', url, result: r });
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
      const contentIssue = detectBlockedContent(markdown, html, url);
      if (contentIssue) {
        const r: RescueResult = { url, status: 'error', error: contentIssue };
        results.push(r);
        sendProgress?.({ phase: 'item-done', url, result: r });
        continue;
      }
      const content = `# ${title}\n\nSource: ${url}\n\n${markdown}`;
      const success = await importText(content, title, targetTabId, RESCUE_PREFIX);
      const r: RescueResult = { url, status: success ? 'success' : 'error', title, error: success ? undefined : '导入 NotebookLM 失败' };
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
        const r: RescueResult = { url, status: 'error', error: extracted?.error || '无法提取内容' };
        results.push(r);
        sendProgress?.({ phase: 'item-done', url, result: r });
        continue;
      }
      if (extracted.content.length < 100) {
        const r: RescueResult = { url, status: 'error', error: '提取到的内容太少，可能被拦截' };
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
        const r: RescueResult = { url, status: success ? 'success' : 'error', title, content: rawContent, error: success ? undefined : '导入 NotebookLM 失败' };
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
    return { success: false, error: 'X.com: 未找到文章或推文内容' };
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
    return { success: false, error: '华为文档内容提取失败' };
  }

  // ── WeChat / Generic extractor ──
  const contentEl = document.querySelector('#js_content')
    || document.querySelector('.rich_media_content')
    || document.querySelector('article')
    || document.querySelector('.rich_media_area_primary');
  const titleEl = document.querySelector('.rich_media_title, #activity-name, h1');
  const title = titleEl?.textContent?.trim() || document.title || '';
  if (!contentEl || contentEl.textContent?.trim().length === 0) {
    return { success: false, error: '页面内容为空，可能需要在微信中验证' };
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
          error: extracted?.error || '无法提取内容',
        });
        continue;
      }

      // Content quality check
      if (extracted.content.length < 100) {
        results.push({
          url,
          status: 'error',
          error: '提取到的内容太少，可能被拦截',
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
          error: success ? undefined : '导入 NotebookLM 失败',
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

  // ── Force Intercept Bilibili Messages (Defensive) ──
  if (type === 'FETCH_BILIBILI') {
    const { url } = message as { url: string };
    const parsed = parseBilibiliUrl(url);
    if (!parsed) throw new Error('无法解析的哔哩哔哩链接');
    return await fetchBilibiliVideo(parsed.bvid);
  }
  if (type === 'FETCH_BILIBILI_SPACE') {
    const { mid } = message as { mid: string };
    return await fetchBilibiliUserVideos(mid);
  }
  if (type === 'DOWNLOAD_BILIBILI_SUBTITLES') {
    const { videos, ownerName, desc } = message as any;
    let downloaded = 0; let skipped = 0;
    console.log(`[background] Starting download for ${videos.length} videos...`);
    for (const video of videos) {
      console.log(`[background] Fetching ${video.bvid} (${videos.indexOf(video) + 1}/${videos.length})`);
      const result = await fetchVideoSubtitle(video, ownerName, desc);
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
  if (type === 'DOWNLOAD_BILIBILI_ZIP') {
    const { videos, ownerName, desc } = message as any;
    const zip = new JSZip();
    let added = 0;
    console.log(`[background] Starting ZIP download for ${videos.length} videos...`);
    for (const video of videos) {
      console.log(`[background] Fetching ${video.bvid} (${videos.indexOf(video) + 1}/${videos.length})`);
      const result = await fetchVideoSubtitle(video, ownerName, desc);
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
    const { videos, ownerName, desc, aiPolish } = message as any;
    let imported = 0; let skipped = 0;
    setOpState({ active: true, phase: 'importing', kind: 'import', current: 0, total: videos.length, title: '准备导入…', timestamp: Date.now() });
    for (const video of videos) {
      setOpState({ active: true, phase: 'importing', kind: 'import', current: videos.indexOf(video), total: videos.length, title: video.part || video.title, timestamp: Date.now() });
      const result = await fetchVideoSubtitle(video, ownerName, desc);
      if (!result.markdown) { skipped++; continue; }
      let markdown = result.markdown;
      if (aiPolish) {
        setOpState({ active: true, phase: 'importing', kind: 'import', current: videos.indexOf(video), total: videos.length, title: `AI润色 ${video.part || video.title}`, timestamp: Date.now() });
        const polished = await polishSubtitlesWithChunks(markdown, result.rawBody);
        if (!polished.success && polished.error) {
          clearOpState();
          throw new Error(`AI 润色失败：${polished.error}，请稍后重试`);
        }
        if (polished.success) markdown = polished.polished;
      }
      const displayTitle = video.part ? `${video.title} - ${video.part}` : video.title;
      const success = await importText(markdown, displayTitle, senderTabId);
      if (success) { imported++; } else { skipped++; }
      if (videos.indexOf(video) < videos.length - 1) await new Promise(r => setTimeout(r, 2500));
    }
    clearOpState();
    if (imported === 0 && skipped > 0) {
      throw new Error('导入失败：无法导入到 NotebookLM。请确保已在扩展中选择了一个笔记本，且已在 Chrome 中登录 notebooklm.google.com');
    }
    return { imported, skipped };
  }

  if (type === 'IMPORT_BILIBILI_MERGED') {
    const { videos, ownerName, desc, source, aiPolish } = message as any;
    const results = [];
    setOpState({ active: true, phase: 'importing', kind: 'import', current: 0, total: videos.length, title: '获取字幕…', timestamp: Date.now() });
    console.log(`[background] Starting merged import for ${videos.length} videos...`);
    for (const video of videos) {
      console.log(`[background] Processing ${video.bvid} (${videos.indexOf(video) + 1}/${videos.length})`);
      setOpState({ active: true, phase: 'importing', kind: 'import', current: videos.indexOf(video), total: videos.length, title: video.part || video.title, timestamp: Date.now() });
      const result = await fetchVideoSubtitle(video, ownerName, desc);
      results.push(result);
      if (videos.indexOf(video) < videos.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    const validResults = results.filter(r => r.markdown !== null);
    if (validResults.length === 0) {
      clearOpState();
      throw new Error('所选视频都没有字幕');
    }
    let mergedMd = mergeBilibiliSubtitles(results, source);
    if (aiPolish) {
      const allBodies2 = results.flatMap(r => (r as any).rawBody || []);
      setOpState({ active: true, phase: 'polishing', kind: 'import', current: 0, total: 1, title: 'AI润色合并内容…', timestamp: Date.now() });
      const polished = await polishSubtitlesWithChunks(mergedMd, allBodies2.length > 0 ? allBodies2 : undefined);
      if (!polished.success && polished.error) {
        clearOpState();
        throw new Error(`AI 润色失败：${polished.error}，请稍后重试`);
      }
      if (polished.success) mergedMd = polished.polished;
    }
    const success = await importText(mergedMd, `合并内容：${source.title}`, senderTabId);
    clearOpState();
    return { success };
  }

  if (type === 'DOWNLOAD_BILIBILI_MERGED') {
    const { videos, ownerName, desc, source } = message as any;
    const results = [];
    console.log(`[background] Starting merged download for ${videos.length} videos...`);
    for (const video of videos) {
      console.log(`[background] Fetching ${video.bvid} (${videos.indexOf(video) + 1}/${videos.length})`);
      const result = await fetchVideoSubtitle(video, ownerName, desc);
      results.push(result);
      if (videos.indexOf(video) < videos.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    const mergedMd = mergeBilibiliSubtitles(results, source);
    const filename = `${sanitizeBilibiliFilename(source.title)}_合并内容.md`;
    const encoded = btoa(unescape(encodeURIComponent(mergedMd)));
    const dataUrl = `data:text/markdown;base64,${encoded}`;
    await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
    return { success: true };
  }

  if (type === 'UPLOAD_BILIBILI_TO_DRIVE') {
    const { videos, ownerName, desc, source } = message as any;
    const results = [];
    console.log(`[background] Starting Drive upload for ${videos.length} videos...`);
    for (const video of videos) {
      console.log(`[background] Fetching ${video.bvid} (${videos.indexOf(video) + 1}/${videos.length})`);
      const result = await fetchVideoSubtitle(video, ownerName, desc);
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

    case 'PARSE_RSS':
      return await parseRssFeed(message.rssUrl);

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
        const lines: string[] = [`# ${conv.title}`, '', `**来源**: ${platform} 对话`, `**URL**: ${conv.url}`, '', '---', ''];
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

    case 'EXPORT_PDF':
    case 'DOWNLOAD_PODCAST':
      // Handled via port connection (onConnect), not onMessage
      return { success: true };

    // ── Bookmarks ──
    case 'ADD_BOOKMARK':
      return await addBookmark(message.url, message.title, message.favicon, message.collection);

    case 'REMOVE_BOOKMARK':
      await removeBookmark(message.id);
      return true;

    case 'REMOVE_BOOKMARKS':
      await removeBookmarks(message.ids);
      return true;

    case 'GET_BOOKMARKS':
      return await getBookmarks();

    case 'GET_COLLECTIONS':
      return await getCollections();

    case 'CREATE_COLLECTION':
      await createCollection(message.name);
      return true;

    case 'MOVE_BOOKMARK':
      await moveBookmark(message.id, message.collection);
      return true;

    case 'MOVE_BOOKMARKS':
      for (const id of message.ids) {
        await moveBookmark(id, message.collection);
      }
      return true;

    case 'IS_BOOKMARKED':
      return await isBookmarked(message.url);

    // ── Notebook Info ──
    case 'GET_NOTEBOOKS': {
      // Primary: fetch via batchexecute API (works without open NLM tabs)
      const apiNotebooks = await fetchNotebooksApi(message.force);
      if (apiNotebooks.length > 0) {
        // Detect current notebook from any open NLM tab URL
        let current: { id: string; title: string; url: string } | null = null;
        const nlmTabs = await chrome.tabs.query({ url: 'https://notebooklm.google.com/notebook/*' });
        if (nlmTabs.length > 0) {
          const tabUrl = nlmTabs[0].url || '';
          const match = tabUrl.match(/\/notebook\/([^/?#]+)/);
          if (match) {
            current = apiNotebooks.find(nb => nb.id === match[1]) || null;
          }
        }
        return { current, notebooks: apiNotebooks };
      }

      // Fallback: content-script approach (requires open NLM tabs)
      console.log('[background] API fetch returned empty, falling back to content script');
      const fallbackTabs = await chrome.tabs.query({ url: 'https://notebooklm.google.com/*' });
      const notebooks: Array<{ id: string; title: string; url: string }> = [];
      const seen = new Set<string>();
      let fallbackCurrent: { id: string; title: string; url: string } | null = null;

      for (const tab of fallbackTabs) {
        if (!tab.id) continue;
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content-scripts/notebooklm.js'],
          }).catch(() => {});

          const resp = await new Promise<{ success: boolean; data?: { current: { id: string; title: string; url: string } | null; list: Array<{ id: string; title: string; url: string }> } }>((resolve) => {
            chrome.tabs.sendMessage(tab.id!, { type: 'GET_NOTEBOOK_INFO' }, (r) => {
              if (chrome.runtime.lastError) resolve({ success: false });
              else resolve(r || { success: false });
            });
          });

          if (resp.success && resp.data) {
            if (resp.data.current && !seen.has(resp.data.current.id)) {
              seen.add(resp.data.current.id);
              fallbackCurrent = resp.data.current;
              notebooks.push(resp.data.current);
            }
            for (const nb of resp.data.list) {
              if (!seen.has(nb.id)) {
                seen.add(nb.id);
                notebooks.push(nb);
              }
            }
          }
        } catch {
          // Tab may not be ready
        }
      }
      return { current: fallbackCurrent, notebooks };
    }

    default:
      console.error('[background] Unknown message type:', (message as any).type, message);
      throw new Error(`Unknown message type: ${(message as any).type}`);
  }
}
