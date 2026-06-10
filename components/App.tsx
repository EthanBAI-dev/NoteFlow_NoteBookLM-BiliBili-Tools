import { useState, useEffect, useCallback, useRef } from 'react';
import { History, MessageCircle, Headphones, Youtube, Tv2, RefreshCw, Upload } from 'lucide-react';
import type { ImportProgress } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n';
import { PodcastImport } from '@/components/PodcastImport';
import { ClaudeImport } from '@/components/ClaudeImport';
import { YouTubeImport } from '@/components/YouTubeImport';
import { BilibiliImport } from '@/components/BilibiliImport';
import { NotebookSelector } from '@/components/NotebookSelector';
import { GoogleAccountSelector } from '@/components/GoogleAccountSelector';
import { getOpState } from '@/services/op-state';
import { LayersIcon } from '@/components/LayersIcon';
import { WebImport } from '@/components/WebImport';
import { HistoryPanel } from '@/components/HistoryPanel';
import { RescueBanner } from '@/components/RescueBanner';
import { OnboardingTour } from '@/components/OnboardingTour';

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

  // ── Shared import handler (registered by active tab) ──
  const [hasImportHandler, setHasImportHandler] = useState(false);
  const importHandlerRef = useRef<(() => void) | null>(null);
  const registerImportHandler = useCallback((handler: (() => void) | null) => {
    importHandlerRef.current = handler;
    setHasImportHandler(handler !== null);
  }, []);

  const detectUrl = useCallback(async (url: string, tabId?: number) => {
    if (!url) return;
    const op = await getOpState();
    if (op?.active) return;
    if (/podcasts\.apple\.com\//.test(url) || /xiaoyuzhoufm\.com\/(episode|podcast)\//.test(url)) {
      setActiveTab('podcast');
      setInitialPodcastUrl(url);
    } else if (/youtube\.com\/(watch|playlist|shorts|@|channel|c\/|user\/)|youtu\.be\//.test(url)) {
      setActiveTab('youtube');
      setInitialYouTubeUrl(url);
    } else if (/bilibili\.com\/(video|space)/.test(url)) {
      setActiveTab('bilibili');
      setInitialBilibiliUrl(url);
    } else if (/claude\.ai\/|chatgpt\.com\/|chat\.openai\.com\/|gemini\.google\.com\//.test(url)) {
      setActiveTab('claude');
    } else if (/^https?:\/\//.test(url)) {
      // All other web pages → web (bookmark) tab
      setActiveTab('bookmark');
    }
    if (/notebooklm\.google\.com/.test(url) && tabId) {
      setNotebookLMTabId(tabId);
    }
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

    return () => {
      chrome.tabs.onUpdated.removeListener(handleTabUpdated);
      chrome.tabs.onActivated.removeListener(handleTabActivated);
      chrome.webNavigation.onHistoryStateUpdated.removeListener(handleHistoryStateUpdated);
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
          <button
            onClick={handleReadCurrentPage}
            className="px-2 py-1 text-[10px] font-medium text-gray-400 hover:text-notebooklm-blue hover:bg-notebooklm-light rounded-md transition-all duration-150 btn-press flex items-center gap-1"
            title={t('app.readCurrentPage')}
          >
            <RefreshCw className="w-3 h-3" />
            {t('app.readCurrentPage')}
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
            className="px-1.5 py-1 text-[10px] font-medium text-gray-400 hover:text-notebooklm-blue hover:bg-notebooklm-light rounded-md transition-all duration-150 btn-press"
            title={locale === 'zh' ? 'Switch to English' : '切换到中文'}
          >
            {locale === 'zh' ? 'EN' : '中'}
          </button>
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
         Group 1: Web Modules — tab-based content panels
         ════════════════════════════════════════════════════════ */}
      <div className="px-4 pt-3">
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
            <div className="flex border-b border-gray-200 px-2 gap-0.5" data-tour="tab-list">
          {[
            { value: 'bilibili', icon: Tv2, label: t('app.tabBilibili') },
            { value: 'youtube', icon: Youtube, label: t('app.tabYouTube') },
            { value: 'podcast', icon: Headphones, label: t('app.tabPodcast') },
            { value: 'bookmark', icon: LayersIcon, label: t('app.tabBookmarks') },
            { value: 'claude', icon: MessageCircle, label: t('app.tabAI') },
          ].map(({ value, icon: Icon, label }) => (
            <div
              key={value}
              data-tour={`tab-${value}`}
              className={cn(
                'flex-1 py-2 text-[11px] font-medium',
                'flex flex-col items-center gap-0.5 relative',
                'select-none',
                value === activeTab
                  ? 'text-notebooklm-blue'
                  : 'text-gray-300',
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </div>
          ))}
        </div>

        {activeTab === 'bilibili' && (
          <div className="p-4 animate-fade-in">
            <BilibiliImport initialUrl={initialBilibiliUrl} onProgress={setImportProgress} fetchTrigger={fetchTrigger} onImportHandlerChange={registerImportHandler} />
          </div>
        )}
        {activeTab === 'youtube' && (
          <div className="p-4 animate-fade-in">
            <YouTubeImport initialUrl={initialYouTubeUrl} onProgress={setImportProgress} fetchTrigger={fetchTrigger} onImportHandlerChange={registerImportHandler} />
          </div>
        )}
        {activeTab === 'podcast' && (
          <div className="p-4 animate-fade-in">
            <PodcastImport initialUrl={initialPodcastUrl} fetchTrigger={fetchTrigger} />
          </div>
        )}
        {activeTab === 'bookmark' && (
          <div className="p-4 animate-fade-in">
            <WebImport onProgress={setImportProgress} onImportHandlerChange={registerImportHandler} />
          </div>
        )}
        {activeTab === 'claude' && (
          <div className="p-4 animate-fade-in">
            <ClaudeImport onProgress={setImportProgress} onImportHandlerChange={registerImportHandler} />
          </div>
        )}
        </div>
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
    </div>
  );
}
