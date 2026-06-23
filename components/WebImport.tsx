import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Loader2,
  CheckCircle,
  AlertCircle,
  Globe,
  Upload,
  FileDown,
  ExternalLink,
} from 'lucide-react';
import type { ImportProgress } from '@/lib/types';
import { t } from '@/lib/i18n';
import { SourceInfoCard } from './SourceInfoCard';

interface Props {
  onProgress: (progress: ImportProgress | null) => void;
  onImportHandlerChange?: (handler: (() => void) | null) => void;
}

interface TabItem {
  id: number;
  windowId: number;
  title: string;
  url: string;
  favicon?: string;
}

interface WindowGroup {
  windowId: number;
  tabs: TabItem[];
}

export function WebImport({ onProgress, onImportHandlerChange }: Props) {
  const [windows, setWindows] = useState<WindowGroup[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [state, setState] = useState<'idle' | 'importing' | 'exporting' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');
  const [pdfProgress, setPdfProgress] = useState<{ current: number; total: number } | null>(null);
  const [currentTabInfo, setCurrentTabInfo] = useState<{ url: string; title: string; favicon?: string } | null>(null);

  // Use a ref to avoid stale closure in port.onDisconnect
  const isExportingRef = useRef(false);

  // Load all browser tabs and current tab info
  useEffect(() => {
    loadTabs();
    loadCurrentTab();
  }, []);

  const loadTabs = () => {
    chrome.windows.getAll({ populate: true }, (ws) => {
      const groups: WindowGroup[] = ws.map((w) => ({
        windowId: w.id!,
        tabs: (w.tabs || [])
          .filter((tab) => tab.url && tab.url.startsWith('http') && !/notebooklm\.google\.com/.test(tab.url!))
          .map((tab) => ({
            id: tab.id!,
            windowId: w.id!,
            title: tab.title || tab.url!,
            url: tab.url!,
            favicon: tab.favIconUrl,
          })),
      })).filter((g) => g.tabs.length > 0);
      setWindows(groups);
    });
  };

  const loadCurrentTab = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab?.url && tab.url.startsWith('http') && !/notebooklm\.google\.com/.test(tab.url)) {
        setCurrentTabInfo({
          url: tab.url,
          title: tab.title || tab.url,
          favicon: tab.favIconUrl,
        });
      }
    });
  };

  const allTabs = useMemo(() => windows.flatMap((w) => w.tabs), [windows]);

  const toggleTab = (id: number) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const selectAll = () => setSelectedIds(new Set(allTabs.map((t) => t.id)));
  const deselectAll = () => setSelectedIds(new Set());

  // ── PDF Export for selected tabs ──
  const handleExportPdf = () => {
    const selected = allTabs.filter((t) => selectedIds.has(t.id));
    if (selected.length === 0) return;

    setState('exporting');
    setPdfProgress({ current: 0, total: selected.length });
    setError('');
    isExportingRef.current = true;

    const port = chrome.runtime.connect({ name: 'pdf-export' });

    port.postMessage({
      type: 'GENERATE_PDF',
      siteInfo: {
        title: t('app.tabBookmarks'),
        baseUrl: '',
        framework: 'unknown' as const,
        pages: selected.map((t) => ({ url: t.url, title: t.title, path: t.url })),
      },
    });

    port.onMessage.addListener((msg) => {
      if (msg.phase === 'fetching') {
        setPdfProgress({ current: msg.current || 0, total: msg.total || selected.length });
      } else if (msg.phase === 'rendering') {
        setPdfProgress({ current: msg.current || 0, total: msg.total || 1 });
      } else if (msg.phase === 'done') {
        isExportingRef.current = false;
        setPdfProgress(null);
        setState('success');
        setTimeout(() => setState('idle'), 3000);
        port.disconnect();
      } else if (msg.phase === 'error') {
        isExportingRef.current = false;
        setPdfProgress(null);
        setState('error');
        setError(msg.error || t('pdfFailed'));
        port.disconnect();
      }
    });

    // Fix: use ref instead of stale closure state check
    port.onDisconnect.addListener(() => {
      if (isExportingRef.current) {
        isExportingRef.current = false;
        setPdfProgress(null);
        setState('idle');
      }
    });
  };

  // ── Import selected tabs to NotebookLM ──
  const handleImportSelected = () => {
    const selected = allTabs.filter((t) => selectedIds.has(t.id));
    if (selected.length === 0) return;

    setState('importing');
    setError('');

    const urls = selected.map((t) => t.url);
    onProgress({ total: urls.length, completed: 0, items: urls.map((u) => ({ url: u, status: 'pending' as const })) });

    chrome.runtime.sendMessage({ type: 'RESCUE_SOURCES', urls }, (resp) => {
      onProgress(null);
      if (resp?.success) {
        setState('success');
        setTimeout(() => setState('idle'), 3000);
      } else {
        setState('error');
        setError(resp?.error || t('importFailed'));
      }
    });
  };

  // Register shared import handler
  useEffect(() => {
    onImportHandlerChange?.(selectedIds.size > 0 ? handleImportSelected : null);
    return () => onImportHandlerChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onImportHandlerChange, selectedIds.size, allTabs]);

  const isWorking = state === 'importing' || state === 'exporting';

  return (
    <div className="space-y-3">
      {/* SourceInfoCard — show current tab info */}
      {currentTabInfo && (
        <SourceInfoCard
          platform="web"
          title={currentTabInfo.title}
          favicon={currentTabInfo.favicon}
          subtitle={currentTabInfo.url}
        />
      )}

      {/* ── Browser Tabs List ── */}
      {windows.length > 0 ? (
        <div>
          {/* Top bar: count + select/deselect (Bilibili style) */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">
              已选 {selectedIds.size} / {allTabs.length} 个标签页
            </span>
            <div className="flex gap-2 text-xs">
              <button onClick={selectAll} className="text-[#00a1d6] hover:underline">全选</button>
              <button onClick={deselectAll} className="text-gray-400 hover:underline">取消全选</button>
            </div>
          </div>

          {/* Tab list container: Bilibili style */}
          <div className="border border-border-strong rounded-lg shadow-soft overflow-hidden">
            <div className="max-h-[240px] overflow-y-auto">
              {windows.map((win) => (
                <div key={win.windowId}>
                  {/* Window header */}
                  <div className="px-3 py-1.5 bg-gray-50/80 border-b border-gray-100 text-[11px] text-gray-400 font-medium flex items-center gap-1.5 sticky top-0">
                    <Globe className="w-3 h-3" />
                    {win.tabs.length > 1 ? `窗口 (${win.tabs.length} 个标签页)` : '窗口'}
                  </div>

                  {win.tabs.map((tab) => (
                    <label
                      key={tab.id}
                      className="flex items-center gap-2 p-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100/60 last:border-b-0 transition-colors duration-150"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(tab.id)}
                        onChange={() => toggleTab(tab.id)}
                        className="rounded border-gray-300 text-[#00a1d6] focus:ring-[#00a1d6]"
                      />
                      {tab.favicon ? (
                        <img src={tab.favicon} className="w-4 h-4 flex-shrink-0 rounded-sm" alt="" />
                      ) : (
                        <Globe className="w-4 h-4 text-gray-300 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-700 truncate">{tab.title}</p>
                        <p className="text-[10px] text-gray-400 truncate">{tab.url}</p>
                      </div>
                      <a
                        href={tab.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex-shrink-0 p-1 text-gray-300 hover:text-gray-500 rounded"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </label>
                  ))}
                </div>
              ))}
            </div>

            {/* Bottom action bar: PDF export + Import */}
            <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-50/80 border-t border-gray-100">
              <button
                onClick={handleExportPdf}
                disabled={selectedIds.size === 0 || isWorking}
                className="flex-1 py-1.5 text-xs rounded-md border border-emerald-500/40 text-emerald-600 bg-white hover:bg-emerald-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-emerald-600 transition-all duration-150 btn-press flex items-center justify-center gap-1"
              >
                {state === 'exporting' && pdfProgress ? (
                  <><Loader2 className="w-3 h-3 animate-spin" />导出中 ({pdfProgress.current}/{pdfProgress.total})</>
                ) : (
                  <><FileDown className="w-3 h-3" />导出 PDF ({selectedIds.size})</>
                )}
              </button>
              <button
                onClick={handleImportSelected}
                disabled={selectedIds.size === 0 || isWorking}
                className="flex-1 py-1.5 text-xs rounded-md border border-notebooklm-blue/40 text-notebooklm-blue bg-white hover:bg-notebooklm-blue hover:text-white disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-notebooklm-blue transition-all duration-150 btn-press flex items-center justify-center gap-1"
              >
                <Upload className="w-3 h-3" />
                导入 NotebookLM ({selectedIds.size})
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-8 text-gray-400">
          <Globe className="w-8 h-8 mb-2 opacity-50" />
          <p className="text-xs">没有可导入的网页</p>
          <p className="text-[10px] text-gray-300 mt-1">请打开需要导入的网页后重试</p>
        </div>
      )}

      {/* ── Status Messages ── */}
      {state === 'success' && (
        <div className="flex items-center gap-2 text-green-600 text-sm bg-green-50 border border-green-100/60 rounded-lg p-3">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {t('importSuccess')}
        </div>
      )}
      {state === 'error' && (
        <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 border border-red-100/60 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}
