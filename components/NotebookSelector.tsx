import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronDown, Search, Pencil, RefreshCw } from 'lucide-react';
import type { NotebookInfo } from '@/lib/types';
import { useI18n } from '@/lib/i18n';
import { setSelectedNotebook, getSelectedNotebook } from '@/lib/config';

interface NotebookData {
  current: NotebookInfo | null;
  notebooks: NotebookInfo[];
}

export function NotebookSelector() {
  const { t } = useI18n();
  const [data, setData] = useState<NotebookData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>('');
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const fetchNotebooks = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const [resp, savedSelection] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_NOTEBOOKS', force }),
        getSelectedNotebook(),
      ]);
      if (resp?.success) {
        const nbData = resp.data as NotebookData;
        setData(nbData);

        let target: NotebookInfo | null = null;
        if (savedSelection) {
          target = nbData.notebooks.find(nb => nb.id === savedSelection.id) || null;
        }
        if (!target) {
          target = nbData.current || nbData.notebooks[0] || null;
        }
        if (target) {
          const enriched: NotebookInfo = {
            ...target,
            url: target.url || `https://notebooklm.google.com/notebook/${target.id}`,
          };
          await setSelectedNotebook(enriched);
        }
      }
    } catch (e) {
      console.error('[NotebookSelector] Fetch failed:', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchNotebooks();
  }, [fetchNotebooks]);

  // Listen for account switch events — force-refresh notebook list
  useEffect(() => {
    const handler = () => {
      console.log('[NotebookSelector] Account switched — force-refreshing notebooks');
      fetchNotebooks(true);
    };
    window.addEventListener('nlm-account-switched', handler);
    return () => window.removeEventListener('nlm-account-switched', handler);
  }, [fetchNotebooks]);

  const notebooks = data?.notebooks || [];

  // Sync selectedId from storage on mount and data change
  useEffect(() => {
    (async () => {
      const saved = await getSelectedNotebook();
      const id = saved?.id || data?.current?.id || notebooks[0]?.id || '';
      setSelectedId(id);
    })();
  }, [data, notebooks]);

  // Close dropdown / detail when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const selectedNotebook = notebooks.find(n => n.id === selectedId);

  const filteredNotebooks = searchQuery
    ? notebooks.filter(nb =>
        nb.title.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : notebooks;

  const handleSelect = async (nb: NotebookInfo) => {
    const enriched: NotebookInfo = {
      ...nb,
      url: nb.url || `https://notebooklm.google.com/notebook/${nb.id}`,
    };
    setSelectedId(nb.id);
    await setSelectedNotebook(enriched);
    setIsOpen(false);
    setSearchQuery('');
  };

  const handleOpenCurrentNotebook = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nb = selectedNotebook;
    if (!nb) return;
    const url = nb.url || `https://notebooklm.google.com/notebook/${nb.id}`;
    chrome.tabs.query({ url: 'https://notebooklm.google.com/*' }, (tabs) => {
      if (tabs.length > 0 && tabs[0].id) {
        chrome.tabs.update(tabs[0].id, { url, active: true });
      } else {
        chrome.tabs.create({ url });
      }
    });
  };

  const handleRefresh = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRefreshing(true);
    await fetchNotebooks(true);
    setTimeout(() => setRefreshing(false), 600);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const handleCreateNotebook = () => {
    chrome.tabs.create({ url: 'https://notebooklm.google.com' });
    setIsOpen(false);
  };

  const hasNotebooks = notebooks.length > 0;

  return (
    <div ref={containerRef} onKeyDown={handleKeyDown}>
      {/* Notebook label */}
      <label className="text-[11px] font-medium text-gray-500 tracking-wide">Notebook</label>

      {/* Unified container: title + 3 action buttons */}
      <div className="relative mt-1.5">
        <div
          className={`flex items-center w-full h-9 text-xs font-medium bg-white border border-gray-200 rounded-lg px-3 ${
            loading ? 'opacity-50' : ''
          }`}
        >
          {/* Left: selected notebook title */}
          <span className="flex-1 text-left truncate text-gray-700">
            {loading
              ? t('notebook.loading') || 'Loading...'
              : !hasNotebooks
                ? t('notebook.noNotebooks') || 'No notebooks'
                : selectedNotebook
                  ? selectedNotebook.title
                  : t('notebook.selectNotebook') || 'Select notebook'}
          </span>

          {/* Right: three action buttons — unified blue theme */}
          {!loading && hasNotebooks && (
            <div className="flex items-center gap-0.5 flex-shrink-0 ml-2">
              {/* Edit — open in NotebookLM */}
              <button
                onClick={handleOpenCurrentNotebook}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-blue-100 transition-all duration-150 group"
                title="Open notebook in NotebookLM"
              >
                <Pencil className="w-3.5 h-3.5 text-blue-600 group-hover:text-blue-700" />
              </button>

              {/* Refresh */}
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-blue-100 transition-all duration-150 disabled:opacity-40 group"
                title="Refresh notebook list"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-blue-600 group-hover:text-blue-700 ${refreshing ? 'animate-spin' : ''}`} />
              </button>

              {/* Custom dropdown trigger */}
              <button
                onClick={(e) => { e.stopPropagation(); setIsOpen(prev => !prev); }}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-blue-100 transition-all duration-150 group"
                title={isOpen ? 'Close notebook list' : 'Open notebook list'}
              >
                <ChevronDown
                  className={`w-3.5 h-3.5 text-blue-600 group-hover:text-blue-700 transition-transform duration-200 ${
                    isOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
            </div>
          )}
        </div>

        {/* Floating dropdown popover */}
        {isOpen && (
          <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
            {/* Search bar */}
            <div className="p-2.5 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder={t('notebook.searchPlaceholder') || 'Search notebooks...'}
                  className="w-full h-8 pl-8 pr-3 text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-md outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors placeholder:text-gray-400"
                />
              </div>
            </div>

            {/* Notebook list only */}
            <div className="max-h-60 overflow-y-auto py-1">
              {filteredNotebooks.length === 0 ? (
                <div className="px-3 py-6 text-xs text-gray-400 text-center">
                  {searchQuery
                    ? t('notebook.noSearchResults') || 'No matching notebooks'
                    : t('notebook.noNotebooks') || 'No notebooks'}
                </div>
              ) : (
                filteredNotebooks.map(nb => (
                  <div
                    key={nb.id}
                    onClick={() => handleSelect(nb)}
                    className={`flex items-center gap-1 px-3 py-2.5 text-xs cursor-pointer transition-colors hover:bg-blue-50 ${
                      nb.id === selectedId
                        ? 'text-blue-700 bg-blue-50 font-medium'
                        : 'text-gray-700'
                    }`}
                  >
                    <span className="flex-1 truncate">{nb.title}</span>
                  </div>
                ))
              )}
            </div>

            {/* Empty state: create notebook button */}
            {notebooks.length === 0 && !searchQuery && (
              <div className="border-t border-gray-100 p-2.5">
                <button
                  onClick={handleCreateNotebook}
                  className="w-full py-2 text-[11px] font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                >
                  + Create new notebook
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
