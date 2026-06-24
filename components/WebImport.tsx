import { useState, useEffect, useMemo } from 'react';
import {
  Globe,
  ExternalLink,
} from 'lucide-react';
import type { ImportProgress } from '@/lib/types';
import { SourceInfoCard } from './SourceInfoCard';

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

interface Props {
  onImportHandlerChange?: (handler: (() => void) | null) => void;
  onProgress?: (progress: ImportProgress | null) => void;
}

export function WebImport({ onImportHandlerChange, onProgress }: Props) {
  const [windows, setWindows] = useState<WindowGroup[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [currentTabInfo, setCurrentTabInfo] = useState<{ url: string; title: string; favicon?: string } | null>(null);
  const [currentTabId, setCurrentTabId] = useState<number | null>(null);

  const lastTabUrlRef = useMemo(() => ({ current: '' }), []);

  useEffect(() => {
    loadTabs();
    loadCurrentTab();

    // Retry initial load — side panel may not have tab info immediately
    const retry = setTimeout(() => loadCurrentTab(), 500);
    return () => clearTimeout(retry);
  }, []);

  // Auto-select the current active tab when tabs list or currentTabId changes
  useEffect(() => {
    if (currentTabId === null) return;
    const allTabs = windows.flatMap((w) => w.tabs);
    const match = allTabs.find((t) => t.id === currentTabId);
    if (match) {
      setSelectedIds(new Set([match.id]));
    }
  }, [windows, currentTabId]);

  // Listen for tab switches/updates
  useEffect(() => {
    const handleActivated = (activeInfo: chrome.tabs.TabActiveInfo) => {
      chrome.tabs.get(activeInfo.tabId, (tab) => {
        if (!tab?.url || tab.url === lastTabUrlRef.current) return;
        lastTabUrlRef.current = tab.url;
        setCurrentTabId(activeInfo.tabId);
        setCurrentTabInfo({
          url: tab.url,
          title: tab.title || tab.url,
          favicon: tab.favIconUrl,
        });
        loadTabs();
      });
    };

    const handleUpdated = (_tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changeInfo.url && changeInfo.url !== lastTabUrlRef.current) {
        lastTabUrlRef.current = changeInfo.url;
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tab = tabs[0];
          if (!tab?.url) return;
          setCurrentTabId(tab.id!);
          setCurrentTabInfo({
            url: tab.url,
            title: tab.title || tab.url,
            favicon: tab.favIconUrl,
          });
          loadTabs();
        });
      }
    };

    chrome.tabs.onActivated.addListener(handleActivated);
    chrome.tabs.onUpdated.addListener(handleUpdated);

    return () => {
      chrome.tabs.onActivated.removeListener(handleActivated);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
    };
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
      if (tab?.url) {
        setCurrentTabId(tab.id!);
        setCurrentTabInfo({
          url: tab.url,
          title: tab.title || tab.url,
          favicon: tab.favIconUrl,
        });
      }
    });
  };

  const allTabs = useMemo(() => windows.flatMap((w) => w.tabs), [windows]);

  const canImport = useMemo(() => {
    return currentTabInfo?.url.startsWith('http') && !/notebooklm\.google\.com/.test(currentTabInfo.url);
  }, [currentTabInfo]);

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

  // ── Import selected URLs to NotebookLM ──
  const handleImport = async () => {
    const selected = allTabs.filter((t) => selectedIds.has(t.id));
    if (selected.length === 0) return;

    const urls = selected.map((t) => t.url);
    const total = urls.length;
    onProgress?.({ total, completed: 0, current: { url: urls[0], status: 'pending' as const }, items: urls.map((u) => ({ url: u, status: 'pending' as const })) });

    // Shared counter across all async closures — tracks true completed count
    let completedCount = 0;

    const results = await Promise.allSettled(
      urls.map(async (url) => {
        try {
          const resp = await chrome.runtime.sendMessage({ type: 'IMPORT_URL', url });
          return resp?.success ? 'success' : 'error';
        } catch {
          return 'error';
        } finally {
          // Use shared counter, not array index — prevents out-of-order regression
          completedCount++;
          const nextUrl = completedCount < total ? urls[completedCount] : undefined;
          onProgress?.({
            total,
            completed: completedCount,
            current: nextUrl ? { url: nextUrl, status: 'pending' as const } : undefined,
            items: urls.map((u) => ({ url: u, status: 'pending' as const })),
          });
        }
      })
    );

    const successCount = results.filter((r) => r.status === 'fulfilled' && r.value === 'success').length;

    // Force one final progress update with the correct count
    // (React may batch the rapid finally-block updates, so this guarantees the last state)
    onProgress?.({ total, completed: total, items: urls.map((u) => ({ url: u, status: 'pending' as const })) });
    await new Promise((r) => setTimeout(r, 300));
    onProgress?.(null);

    return { successCount, total };
  };

  // Register import handler for the global button
  useEffect(() => {
    onImportHandlerChange?.(selectedIds.size > 0 ? handleImport : null);
    return () => onImportHandlerChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onImportHandlerChange, selectedIds.size, allTabs]);

  return (
    <div className="space-y-3">
      {/* SourceInfoCard — show current tab info */}
      {currentTabInfo && (
        <div className="relative">
          <SourceInfoCard
            platform="web"
            title={currentTabInfo.title}
            favicon={currentTabInfo.favicon}
            subtitle={currentTabInfo.url}
          />
          {!canImport && (
            <span className="absolute top-2 right-2 z-10 text-[9px] text-red-500 bg-red-50 border border-red-200/60 px-1.5 py-0.5 rounded-full font-medium leading-none">
              不支持导入
            </span>
          )}
        </div>
      )}

      {/* ── Browser Tabs List ── */}
      {windows.length > 0 ? (
        <div>
          {/* Section label */}
          <label className="text-[11px] font-medium text-gray-500 tracking-wide">浏览窗口</label>

          {/* Tab list container */}
          <div className="mt-1.5 border border-border-strong rounded-lg shadow-soft overflow-hidden">
            {/* Top bar: count + select/deselect — inside the border */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50/80 border-b border-gray-100">
              <span className="text-xs text-gray-600">
                已选 {selectedIds.size} / {allTabs.length} 个标签页
              </span>
              <div className="flex gap-2 text-xs">
                <button onClick={selectAll} className="text-[#00a1d6] hover:underline">全选</button>
                <button onClick={deselectAll} className="text-gray-400 hover:underline">取消全选</button>
              </div>
            </div>

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
    </div>
  );
}
