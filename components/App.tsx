import { useState, useEffect, useCallback, useRef } from 'react';
import { History, RefreshCw, Upload, User, LogOut, CircleUserRound } from 'lucide-react';
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
import { LoginPanel } from '@/components/LoginPanel';
import { signOut, restoreSession } from '@/lib/auth';

export default function App() {
  const { t, locale, setLocale } = useI18n();
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [activeTab, setActiveTab] = useState('bilibili');
  const [initialPodcastUrl, setInitialPodcastUrl] = useState('');
  const [initialYouTubeUrl, setInitialYouTubeUrl] = useState('');
  const [initialBilibiliUrl, setInitialBilibiliUrl] = useState('');
  const [notebookLMTabId, setNotebookLMTabId] = useState<number | null>(null);
  const [fetchTrigger, setFetchTrigger] = useState(0);
  const [currentUser, setCurrentUser] = useState<{ id: string; email?: string; avatar_url?: string; name?: string } | null>(null);
  const [showLogin, setShowLogin] = useState(false);

  // Restore session on mount
  useEffect(() => {
    (async () => {
      const { session } = await restoreSession();
      if (session?.user) {
        setCurrentUser({
          id: session.user.id,
          email: session.user.email || undefined,
          avatar_url: session.user.user_metadata?.avatar_url || undefined,
          name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || undefined,
        });
      }
    })();
  }, []);

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

  const handleSharedImport = () => {
    importHandlerRef.current?.();
  };

  return (
    <div className="min-h-[480px] bg-surface">
      {/* Header — frosted glass */}
      <div className="glass px-3.5 py-1.5 border-b border-border flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-1">
          {/* Language toggle — moved as the only header-left element */}
          <button
            onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
            className="px-1.5 py-1 text-[10px] font-medium text-gray-400 hover:text-notebooklm-blue hover:bg-notebooklm-light rounded-md transition-all duration-150 btn-press"
            title={locale === 'zh' ? 'Switch to English' : '切换到中文'}
          >
            {locale === 'zh' ? 'EN' : '中'}
          </button>
        </div>
        <div className="flex items-center gap-1">
          {/* User / Login button */}
          {currentUser ? (
            <>
              {currentUser.avatar_url ? (
                <img
                  src={currentUser.avatar_url}
                  alt=""
                  className="w-5 h-5 rounded-full border border-gray-200 cursor-pointer"
                  onClick={() => setShowLogin(true)}
                />
              ) : (
                <button
                  onClick={() => setShowLogin(true)}
                  className="w-5 h-5 rounded-full bg-notebooklm-blue/10 flex items-center justify-center hover:bg-notebooklm-blue/20 transition-colors"
                >
                  <User className="w-3 h-3 text-notebooklm-blue" />
                </button>
              )}
              <button
                onClick={async () => { await signOut(); setCurrentUser(null); }}
                className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all duration-150 btn-press"
                title="退出登录"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <button
              onClick={() => setShowLogin(true)}
              className="p-1.5 text-gray-400 hover:text-notebooklm-blue hover:bg-notebooklm-light rounded-lg transition-all duration-150 btn-press"
              title="登录"
            >
              <CircleUserRound className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setShowHistory(true)}
            className="p-1.5 text-gray-400 hover:text-notebooklm-blue hover:bg-notebooklm-light rounded-lg transition-all duration-150 btn-press"
            title={t('app.importHistory')}
          >
            <History className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Progress indicator */}
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
            <PodcastImport initialUrl={initialPodcastUrl} fetchTrigger={fetchTrigger} />
          </div>
        )}
        {activeTab === 'web' && (
          <div className="animate-fade-in">
            <WebImport onProgress={setImportProgress} onImportHandlerChange={registerImportHandler} />
          </div>
        )}
        {activeTab === 'claude' && (
          <div className="animate-fade-in">
            <AIchatImport onProgress={setImportProgress} onImportHandlerChange={registerImportHandler} />
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════
         Group 2: NotebookLM Settings — account, notebook list, import
         ════════════════════════════════════════════════════════ */}
      <div className="px-4 pt-4 pb-4 space-y-4">
        {/* NotebookLM Account selector */}
        <GoogleAccountSelector />

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
      <OnboardingTour />

      {/* Login Modal */}
      {showLogin && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={(e) => { if (e.target === e.currentTarget) setShowLogin(false); }}
        >
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            <button
              onClick={() => setShowLogin(false)}
              className="absolute top-3 right-3 p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 z-10"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <LoginPanel onAuthSuccess={() => setShowLogin(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
