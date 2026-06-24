import { useState, useEffect, useCallback, useRef } from 'react';
import { History, RefreshCw, Upload } from 'lucide-react';
import type { ImportProgress, YouTubeResult } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n';
import { PodcastImport } from '@/components/PodcastImport';
import { AIchatImport } from '@/components/AIchatImport';
import { YouTubeImport } from '@/components/YouTubeImport';
import { BilibiliImport } from '@/components/BilibiliImport';
import { NotebookSelector } from '@/components/NotebookSelector';
import { GoogleAccountSelector } from '@/components/GoogleAccountSelector';
import { getOpState } from '@/services/op-state';
import { WebImport } from '@/components/WebImport';
import { HistoryPanel } from '@/components/HistoryPanel';
import { RescueBanner } from '@/components/RescueBanner';
import { OnboardingTour } from '@/components/OnboardingTour';
import { SettingsPanel } from '@/components/SettingsPanel';

export default function App() {
  const { t, locale, setLocale } = useI18n();
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [importFinished, setImportFinished] = useState<{ success: boolean; message: string } | null>(null);
  const importFinishedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState('bilibili');
  const [initialPodcastUrl, setInitialPodcastUrl] = useState('');
  const [initialYouTubeUrl, setInitialYouTubeUrl] = useState('');
  const [initialBilibiliUrl, setInitialBilibiliUrl] = useState('');
  const [notebookLMTabId, setNotebookLMTabId] = useState<number | null>(null);
  const [fetchTrigger, setFetchTrigger] = useState(0);
  const [forceShowTour, setForceShowTour] = useState(false);

  // ── Pre-fetched YouTube result from background (via content script → YT_URL_CHANGED) ──
  const [prefetchedYouTubeResult, setPrefetchedYouTubeResult] = useState<YouTubeResult | null>(null);
  const prefetchedYouTubeUrlRef = useRef<string>('');

  // ── Shared import handler (registered by active tab) ──
  const [hasImportHandler, setHasImportHandler] = useState(false);
  const importHandlerRef = useRef<(() => void) | null>(null);
  const registerImportHandler = useCallback((handler: (() => void) | null) => {
    importHandlerRef.current = handler;
    setHasImportHandler(handler !== null);
  }, []);

  // ── Auto-show green success banner when import completes ──
  const prevImportProgressRef = useRef<ImportProgress | null>(null);
  useEffect(() => {
    const prev = prevImportProgressRef.current;
    const curr = importProgress;
    prevImportProgressRef.current = curr;

    if (curr) {
      if (importFinishedTimerRef.current) clearTimeout(importFinishedTimerRef.current);
      setImportFinished(null);
    }

    // Detect transition: non-null → null
    if (prev && !curr && prev.completed > 0) {
      const failed = prev.items ? prev.items.filter((i) => i.status === 'error').length : 0;
      const success = Math.max(prev.completed - failed, 0);
      const msg = `导入完成（成功 ${success} 个，失败 ${failed} 个）`;

      setImportFinished({ success: true, message: msg });
      importFinishedTimerRef.current = setTimeout(() => setImportFinished(null), 20000);
    }
  }, [importProgress]);

  const dismissFinished = useCallback(() => {
    if (importFinishedTimerRef.current) clearTimeout(importFinishedTimerRef.current);
    setImportFinished(null);
  }, []);

  // ── Tab/URL detection with debounce ──
  // During SPA navigation, Chrome fires onHistoryStateUpdated + onTabUpdated in
  // rapid succession. The debounce ensures only the final URL is processed,
  // preventing both stale state from reappearing and duplicate fetches.
  const lastDetectedUrlRef = useRef<string>('');
  const detectTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const detectUrl = useCallback(async (url: string, tabId?: number) => {
    if (!url) return;
    if (detectTimerRef.current) clearTimeout(detectTimerRef.current);

    detectTimerRef.current = setTimeout(async () => {
      if (url === lastDetectedUrlRef.current) return;
      lastDetectedUrlRef.current = url;

      // Clear any stale prefetched result when URL changes
      if (url !== prefetchedYouTubeUrlRef.current) {
        prefetchedYouTubeUrlRef.current = '';
        setPrefetchedYouTubeResult(null);
      }

      const op = await getOpState();
      if (op?.active) return;
      if (/podcasts\.apple\.com\//.test(url) || /xiaoyuzhoufm\.com\/(episode|podcast)\//.test(url)) {
        setActiveTab('podcast');
        setInitialPodcastUrl(url);
      } else if (/(?:youtube\.com|youtu\.be)\//.test(url)) {
        setActiveTab('youtube');
        setInitialYouTubeUrl(url);
        // Clear stale prefetched result so YouTubeImport does a fresh manual fetch
        prefetchedYouTubeUrlRef.current = '';
        setPrefetchedYouTubeResult(null);
      } else if (/bilibili\.com\//.test(url)) {
        setActiveTab('bilibili');
        setInitialBilibiliUrl(url);
      } else if (/claude\.ai\/|chatgpt\.com\/|chat\.openai\.com\/|gemini\.google\.com\//.test(url)) {
        setActiveTab('claude');
      } else if (/^https?:\/\//.test(url)) {
        setActiveTab('web');
      } else {
        setActiveTab('web');
      }
      if (/notebooklm\.google\.com/.test(url) && tabId) {
        setNotebookLMTabId(tabId);
      }
    }, 200);
  }, []);

  const handleReadCurrentPage = useCallback(() => {
    setFetchTrigger((prev) => prev + 1);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url || '';
      const tabId = tabs[0]?.id;
      detectUrl(url, tabId);
    });
  }, [detectUrl]);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url || '';
      const tabId = tabs[0]?.id;
      detectUrl(url, tabId);
    });

    const handleTabUpdated = (_tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (changeInfo.url && tab.active) {
        detectUrl(changeInfo.url, tab.id);
      }
    };

    const handleTabActivated = (activeInfo: chrome.tabs.TabActiveInfo) => {
      chrome.tabs.get(activeInfo.tabId, (tab) => {
        if (tab.url) {
          detectUrl(tab.url, tab.id);
        }
      });
    };

    // SPA route changes: History API pushState/replaceState + hash changes
    const handleHistoryStateUpdated = (
      details: chrome.webNavigation.WebNavigationTransitionCallbackDetails,
    ) => {
      if (details.tabId) {
        detectUrl(details.url, details.tabId);
      }
    };

    chrome.tabs.onUpdated.addListener(handleTabUpdated);
    chrome.tabs.onActivated.addListener(handleTabActivated);
    chrome.webNavigation.onHistoryStateUpdated.addListener(handleHistoryStateUpdated);

    // ── Listen for pre-fetched YouTube results from background ──
    const handleRuntimeMessage = (msg: Record<string, unknown>) => {
      if (msg.type === 'YT_FETCH_RESULT') {
        const { url, result, error } = msg as { type: string; url: string; result: YouTubeResult | null; error?: string };
        if (!url) return;

        if (result && url !== prefetchedYouTubeUrlRef.current) {
          // Valid result for a new URL
          prefetchedYouTubeUrlRef.current = url;
          setPrefetchedYouTubeResult(result);
          if (/(?:youtube\.com|youtu\.be)\//.test(url)) {
            setActiveTab('youtube');
            setInitialYouTubeUrl(url);
          }
        } else if (!result && /(?:youtube\.com|youtu\.be)\//.test(url)) {
          // Fetch failed (e.g. YouTube homepage, search — not a video/playlist/channel)
          // Clear stale result and let detectUrl trigger YouTubeImport to show error state
          if (url !== lastDetectedUrlRef.current) {
            prefetchedYouTubeUrlRef.current = '';
            setPrefetchedYouTubeResult(null);
            setActiveTab('youtube');
            setInitialYouTubeUrl(url);
          }
        }
      }
    };
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);

    return () => {
      chrome.tabs.onUpdated.removeListener(handleTabUpdated);
      chrome.tabs.onActivated.removeListener(handleTabActivated);
      chrome.webNavigation.onHistoryStateUpdated.removeListener(handleHistoryStateUpdated);
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
    };
  }, [detectUrl]);

  if (showHistory) {
    return <HistoryPanel onClose={() => setShowHistory(false)} />;
  }

  if (showSettings) {
    return (
      <SettingsPanel
        onClose={() => setShowSettings(false)}
        onReplayTour={() => {
          setShowSettings(false);
          setForceShowTour(true);
        }}
      />
    );
  }

  const handleSharedImport = () => {
    importHandlerRef.current?.();
  };

  return (
    <div className="min-h-[480px] bg-surface">
      {/* Header — frosted glass */}
      <div className="glass px-4 py-1.5 border-b border-border flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2 min-w-0">
          {/* GoogleAccountSelector — compact, in header */}
          <GoogleAccountSelector compact />
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
            className="p-1.5 text-gray-400 hover:text-notebooklm-blue hover:bg-notebooklm-light rounded-lg transition-all duration-150 btn-press"
            title={locale === 'zh' ? 'Switch to English' : '切换到中文'}
          >
            <span className="text-[11px] font-medium leading-none">{locale === 'zh' ? '中' : 'EN'}</span>
          </button>
          <button
            onClick={() => setShowHistory(true)}
            className="p-1.5 text-gray-400 hover:text-notebooklm-blue hover:bg-notebooklm-light rounded-lg transition-all duration-150 btn-press"
            title={t('app.importHistory')}
          >
            <History className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 text-gray-400 hover:text-notebooklm-blue hover:bg-notebooklm-light rounded-lg transition-all duration-150 btn-press"
            title="设置"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
          </button>
        </div>
      </div>

      {/* Progress indicator — blue bar */}
      {importProgress && (
        <div className="px-4 py-2.5 bg-notebooklm-light/60 border-b border-notebooklm-blue/10">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-notebooklm-blue font-medium text-xs">
              {t('app.importingProgress', { completed: importProgress.completed, total: importProgress.total })}
            </span>
            {importProgress.current && (
              <span className="text-blue-400/70 truncate max-w-[200px] text-xs font-mono">
                {importProgress.current.url}
              </span>
            )}
          </div>
          <div className="w-full bg-notebooklm-blue/10 rounded-full h-1 overflow-hidden">
            <div
              className="bg-gradient-to-r from-notebooklm-blue to-blue-500 h-1 rounded-full transition-all duration-500 ease-spring relative"
              style={{
                width: `${(importProgress.completed / importProgress.total) * 100}%`,
              }}
            >
              <div className="absolute inset-0 progress-shimmer rounded-full" />
            </div>
          </div>
        </div>
      )}

      {/* Success banner — green, shown after import completes */}
      {importFinished && (
        <div className="px-4 py-2.5 bg-emerald-50 border-b border-emerald-200/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span className="text-xs text-emerald-700 font-medium">{importFinished.message}</span>
          </div>
          <button
            onClick={dismissFinished}
            className="p-0.5 text-emerald-400 hover:text-emerald-600 rounded transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      {/* Rescue banner — shown when on NotebookLM page */}
      {notebookLMTabId && <RescueBanner tabId={notebookLMTabId} />}

      {/* ════════════════════════════════════════════════════════
         Content panel — auto-switched by browser URL detection
         ════════════════════════════════════════════════════════ */}
      <div className="px-4 pt-3 space-y-2">
        <div className="flex items-center">
          <label className="text-[11px] font-medium text-gray-500 tracking-wide">当前网站</label>
          <button
            onClick={handleReadCurrentPage}
            className="p-0.5 text-gray-400 hover:text-notebooklm-blue hover:bg-notebooklm-light rounded-md transition-all duration-150 btn-press"
            title={t('app.readCurrentPage')}
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
        {activeTab === 'bilibili' && (
          <div className="animate-fade-in">
            <BilibiliImport initialUrl={initialBilibiliUrl} onProgress={setImportProgress} fetchTrigger={fetchTrigger} onImportHandlerChange={registerImportHandler} />
          </div>
        )}
        {activeTab === 'youtube' && (
          <div className="animate-fade-in">
            <YouTubeImport
              initialUrl={initialYouTubeUrl}
              onProgress={setImportProgress}
              fetchTrigger={fetchTrigger}
              onImportHandlerChange={registerImportHandler}
              prefetchedResult={prefetchedYouTubeResult}
            />
          </div>
        )}
        {activeTab === 'podcast' && (
          <div className="animate-fade-in">
            <PodcastImport initialUrl={initialPodcastUrl} fetchTrigger={fetchTrigger} onProgress={setImportProgress} />
          </div>
        )}
        {activeTab === 'web' && (
          <div className="animate-fade-in">
            <WebImport onProgress={setImportProgress} onImportHandlerChange={registerImportHandler} />
          </div>
        )}
        {activeTab === 'claude' && (
          <div className="animate-fade-in">
            <AIchatImport onProgress={setImportProgress} onImportHandlerChange={registerImportHandler} fetchTrigger={fetchTrigger} />
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════
         Group 2: NotebookLM Settings — account, notebook list, import
         ════════════════════════════════════════════════════════ */}
      <div className="px-4 pt-4 pb-4 space-y-4">
        {/* Notebook selector */}
        <NotebookSelector />

        {/* Unified Import button */}
        <button
          onClick={handleSharedImport}
          disabled={!hasImportHandler}
          className="w-full py-2.5 bg-notebooklm-blue hover:bg-blue-600 text-white text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-btn hover:shadow-btn-hover transition-all duration-150 btn-press"
        >
          <Upload className="w-4 h-4" />
          {t('notebook.importToNlm')}
        </button>
      </div>

      {/* First-time onboarding tour */}
      <OnboardingTour forceShow={forceShowTour} onComplete={() => setForceShowTour(false)} />
    </div>
  );
}
