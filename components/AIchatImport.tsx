import { useState, useEffect, useCallback } from 'react';
import {
  MessageCircle,
  Loader2,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Share2,
} from 'lucide-react';
import type { ClaudeConversation, ImportProgress } from '@/lib/types';
import { t } from '@/lib/i18n';
import { SourceInfoCard } from './SourceInfoCard';

interface Props {
  onProgress: (progress: ImportProgress | null) => void;
  onImportHandlerChange?: (handler: (() => void) | null) => void;
}

type ImportState = 'idle' | 'extracting' | 'ready' | 'importing' | 'success' | 'error';
type AIPlatform = 'claude' | 'chatgpt' | 'gemini' | null;

const PLATFORM_CONFIG: Record<string, { name: string; platform: AIPlatform; script: string; icon: string }> = {
  'claude.ai': { name: 'Claude', platform: 'claude', script: 'content-scripts/claude.js', icon: '🟤' },
  'chatgpt.com': { name: 'ChatGPT', platform: 'chatgpt', script: 'content-scripts/chatgpt.js', icon: '🟢' },
  'chat.openai.com': { name: 'ChatGPT', platform: 'chatgpt', script: 'content-scripts/chatgpt.js', icon: '🟢' },
  'gemini.google.com': { name: 'Gemini', platform: 'gemini', script: 'content-scripts/gemini.js', icon: '🔵' },
};

function detectPlatform(url: string) {
  try {
    const hostname = new URL(url).hostname;
    return PLATFORM_CONFIG[hostname] || null;
  } catch {
    return null;
  }
}

// Lightweight markdown stripper for popup previews — pair.answer is now full
// Markdown, so symbols like **, ##, > would otherwise leak into the preview.
function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function AIchatImport({ onProgress, onImportHandlerChange }: Props) {
  const [state, setState] = useState<ImportState>('idle');
  const [error, setError] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState(false); // "Receiving end does not exist" flag
  const [conversation, setConversation] = useState<ClaudeConversation | null>(null);
  const [selectedPairIds, setSelectedPairIds] = useState<Set<string>>(new Set());
  const [platformInfo, setPlatformInfo] = useState<ReturnType<typeof detectPlatform>>(null);
  const [currentTabId, setCurrentTabId] = useState<number | null>(null);
  const [currentTabFavicon, setCurrentTabFavicon] = useState<string | undefined>();

  const [autoExtracted, setAutoExtracted] = useState(false);
  const [autoExtractError, setAutoExtractError] = useState(false);

  // Compute SourceInfoCard subtitle: show conversation title as second line
  const sourceSubtitle = conversation?.title
    ? `对话: ${conversation.title}`
    : state === 'extracting'
      ? '正在提取对话...'
      : undefined;

  // ── Detect platform from current tab on mount & on tab switch ──
  const detectCurrentPlatform = useCallback(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.url) return;
      const info = detectPlatform(tab.url);
      setPlatformInfo(info);
      setCurrentTabId(info ? (tab.id || null) : null);
      setCurrentTabFavicon(tab.favIconUrl || undefined);
    });
  }, []);

  useEffect(() => {
    detectCurrentPlatform();

    const handleActivated = () => detectCurrentPlatform();
    const handleUpdated = (_tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (changeInfo.url && tab.active) detectCurrentPlatform();
    };

    chrome.tabs.onActivated.addListener(handleActivated);
    chrome.tabs.onUpdated.addListener(handleUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(handleActivated);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
    };
  }, [detectCurrentPlatform]);

  // Reset extraction state when platform changes
  useEffect(() => {
    setConversation(null);
    setSelectedPairIds(new Set());
    setState('idle');
    setError('');
    setAutoExtracted(false);
    setNeedsRefresh(false);
    setAutoExtractError(false);
  }, [platformInfo]);

  const handleExtract = useCallback(async () => {
    if (!currentTabId || !platformInfo) return;

    setState('extracting');
    setError('');
    setNeedsRefresh(false);
    setAutoExtractError(false);

    try {
      await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        files: [platformInfo.script],
      });
    } catch { /* already injected */ }

    await new Promise((resolve) => setTimeout(resolve, 300));

    chrome.runtime.sendMessage(
      { type: 'EXTRACT_CLAUDE_CONVERSATION', tabId: currentTabId },
      (response) => {
        if (chrome.runtime.lastError) {
          setState('error');
          setNeedsRefresh(true);
          return;
        }
        if (response?.success && response.data) {
          const conv = response.data as ClaudeConversation;
          const pairs = conv.pairs || [];
          // 提取成功但没有对话名称和内容，视为提取失败，引导刷新
          if (!conv.title && pairs.length === 0) {
            setState('error');
            setNeedsRefresh(true);
            setAutoExtractError(true);
            return;
          }
          setConversation(conv);
          setSelectedPairIds(new Set(pairs.map((p) => p.id)));
          setState('ready');
        } else {
          setState('error');
          const errMsg = response?.error || t('claude.extractFailed');
          if (/receiving end does not exist/i.test(errMsg)) {
            setNeedsRefresh(true);
          } else {
            setError(errMsg);
          }
          setAutoExtractError(true);
        }
      }
    );
  }, [currentTabId, platformInfo]);

  const handleRefreshPage = useCallback(() => {
    if (!currentTabId) return;
    chrome.tabs.reload(currentTabId);
    setNeedsRefresh(false);
    setAutoExtractError(false);
    setError('');
    setState('idle');
  }, [currentTabId]);

  // Auto-extract when on a specific conversation page (not homepage)
  useEffect(() => {
    if (!currentTabId || !platformInfo || autoExtracted || state !== 'idle') return;
    chrome.tabs.get(currentTabId, (tab) => {
      if (chrome.runtime.lastError || !tab?.url) return;
      const url = tab.url;
      const isConversationPage =
        /claude\.ai\/chat\/[a-f0-9-]+/.test(url) ||
        /chatgpt\.com\/c\//.test(url) ||
        /chat\.openai\.com\/c\//.test(url) ||
        /gemini\.google\.com\/app\/[a-f0-9]+/.test(url);
      if (isConversationPage) {
        setAutoExtracted(true);
        handleExtract();
      }
    });
  }, [currentTabId, platformInfo, autoExtracted, state, handleExtract]);

  const handleImport = async () => {
    if (!conversation) return;
    const pairs = conversation.pairs || [];
    const selected = pairs.filter((p) => selectedPairIds.has(p.id));
    if (selected.length === 0) return;

    setState('importing');
    setError('');

    onProgress({
      total: 1,
      completed: 0,
      items: [{ url: conversation.url, status: 'importing' }],
    });

    chrome.runtime.sendMessage(
      {
        type: 'IMPORT_CLAUDE_CONVERSATION',
        conversation: { ...conversation, pairs: selected },
        selectedMessageIds: [], // Not used in new flow
      },
      (response) => {
        onProgress(null);
        if (response?.success) {
          setState('success');
          setTimeout(() => setState('ready'), 3000);
        } else {
          setState('error');
          setError(response?.error || t('importFailed'));
        }
      }
    );
  };

  // Register import handler for unified button
  useEffect(() => {
    onImportHandlerChange?.(selectedPairIds.size > 0 ? handleImport : null);
    return () => onImportHandlerChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onImportHandlerChange, handleImport, selectedPairIds.size, conversation]);

  const togglePair = (id: string) => {
    setSelectedPairIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleShareCard = async () => {
    if (!conversation) return;
    const pairs = conversation.pairs || [];
    const selected = pairs.filter((p) => selectedPairIds.has(p.id));
    if (selected.length === 0) return;

    await chrome.storage.local.set({
      shareCardData: {
        pairs: selected,
        title: conversation.title,
        platform: platformInfo?.name || 'AI',
        platformIcon: platformInfo?.icon || '🤖',
        url: conversation.url,
      },
    });

    chrome.tabs.create({ url: chrome.runtime.getURL('/share-card.html') });
  };

  const pairs = conversation?.pairs || [];
  const allSelected = pairs.length > 0 && selectedPairIds.size === pairs.length;

  // Not on a supported AI platform
  if (!platformInfo) {
    return (
      <div className="space-y-4">
        <div className="bg-amber-50/60 border border-amber-200/40 rounded-xl p-4 shadow-soft text-center">
          <MessageCircle className="w-10 h-10 text-amber-500 opacity-80 mx-auto mb-2" />
          <p className="text-sm font-medium text-amber-700">{t('claude.openAiPage')}</p>
          <p className="text-xs text-amber-600/70 mt-1">{t('claude.supported')}</p>
        </div>
      </div>
    );
  }

  // Initial / extracting state
  if (state === 'idle' || state === 'extracting' || (state === 'error' && !conversation)) {
    return (
      <div className="space-y-4">
        <SourceInfoCard
          platform="ai"
          title={platformInfo.name}
          subtitle={sourceSubtitle}
          favicon={currentTabFavicon}
          connectionLost={needsRefresh || autoExtractError}
        />

        {needsRefresh || autoExtractError ? (
          <button
            onClick={handleRefreshPage}
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-lg flex items-center justify-center gap-2 shadow-btn hover:shadow-btn-hover transition-all duration-150 btn-press"
          >
            <RefreshCw className="w-4 h-4" />
            刷新 {platformInfo?.name} 页面
          </button>
        ) : (
          <button
            onClick={handleExtract}
            disabled={state === 'extracting'}
            className="w-full py-3 bg-notebooklm-blue text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-btn hover:shadow-btn-hover transition-all duration-150 btn-press"
          >
            {state === 'extracting' ? (
              <><Loader2 className="w-4 h-4 animate-spin" />{t('claude.extracting')}</>
            ) : (
              <><MessageCircle className="w-4 h-4" />{t('claude.extractCurrent')}</>
            )}
          </button>
        )}

        {state === 'error' && !needsRefresh && (
          <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 border border-red-100/60 rounded-lg p-3 shadow-soft">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

      </div>
    );
  }

  // Ready state — show Q&A pairs
  return (
    <div className="space-y-4">
      {/* SourceInfoCard — shows connection-lost warning when needsRefresh */}
      <SourceInfoCard
        platform="ai"
        title={platformInfo.name}
        subtitle={sourceSubtitle}
        favicon={currentTabFavicon}
        connectionLost={needsRefresh || autoExtractError}
      />

      {/* Q&A pair list */}
      <div className="border border-border-strong rounded-lg shadow-soft overflow-hidden">
        {/* Top row: count on left, select/deselect on right (Bilibili-style) */}
        <div className="flex items-center justify-between px-3 py-2 bg-gray-50/80 border-b border-border-strong">
          <span className="text-sm text-gray-600">
            {t('claude.qaPairs', { total: pairs.length, selected: selectedPairIds.size })}
          </span>
          <div className="flex gap-2 text-xs">
            <button
              onClick={() => setSelectedPairIds(new Set(pairs.map((p) => p.id)))}
              disabled={allSelected}
              className="text-notebooklm-blue hover:underline disabled:opacity-40 disabled:no-underline"
            >
              {t('selectAll')}
            </button>
            <button
              onClick={() => setSelectedPairIds(new Set())}
              disabled={selectedPairIds.size === 0}
              className="text-gray-400 hover:underline disabled:opacity-40 disabled:no-underline"
            >
              {t('deselectAll')}
            </button>
          </div>
        </div>

        {/* Scrollable pair list */}
        <div className="max-h-[240px] overflow-y-auto">
          {pairs.map((pair, index) => (
            <label
              key={pair.id}
              className="flex items-start gap-3 p-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100/80 last:border-b-0"
            >
              <input
                type="checkbox"
                checked={selectedPairIds.has(pair.id)}
                onChange={() => togglePair(pair.id)}
                className="mt-1 rounded border-gray-300 text-notebooklm-blue focus:ring-notebooklm-blue"
              />
              <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-xs text-gray-700 line-clamp-2">
                    <span className="text-xs font-mono tabular-nums text-gray-400 mr-1">#{index + 1}</span>
                    <span className="text-gray-400">Q：</span>
                    {pair.question || t('claude.noQuestion')}
                  </p>
                  <p className="text-xs text-gray-500 line-clamp-2">
                    <span className="text-gray-400">A：</span>
                    {stripMarkdown(pair.answer).slice(0, 100) || t('claude.noAnswer')}
                    {pair.answer.length > 100 && '...'}
                  </p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Status */}
      {state === 'success' && (
        <div className="flex items-center gap-2 text-green-600 text-sm bg-green-50 border border-green-100/60 rounded-lg p-3 shadow-soft">
          <CheckCircle className="w-4 h-4" />
          {t('importSuccess')}
        </div>
      )}
      {state === 'error' && !needsRefresh && (
        <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 border border-red-100/60 rounded-lg p-3 shadow-soft">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

    </div>
  );
}
