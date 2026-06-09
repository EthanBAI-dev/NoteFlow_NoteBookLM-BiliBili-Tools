import { useState, useEffect, useCallback, useRef } from 'react';
import { ExternalLink } from 'lucide-react';
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
  const selectRef = useRef<HTMLSelectElement>(null);

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

        // Restore or auto-select notebook
        let target: NotebookInfo | null = null;
        if (savedSelection) {
          target = nbData.notebooks.find(nb => nb.id === savedSelection.id) || null;
        }
        if (!target) {
          target = nbData.current || nbData.notebooks[0] || null;
        }
        if (target) {
          // Also update URL property if not set
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

  const [selectedId, setSelectedId] = useState<string>('');

  // Sync selectedId from storage on mount and data change
  useEffect(() => {
    (async () => {
      const saved = await getSelectedNotebook();
      const id = saved?.id || data?.current?.id || notebooks[0]?.id || '';
      setSelectedId(id);
    })();
  }, [data, notebooks]);

  const handleSelect = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (!id) return;
    setSelectedId(id);
    const nb = notebooks.find(n => n.id === id);
    if (nb) {
      const enriched: NotebookInfo = {
        ...nb,
        url: nb.url || `https://notebooklm.google.com/notebook/${nb.id}`,
      };
      await setSelectedNotebook(enriched);
    }
  };

  const handleOpenNotebook = () => {
    const nb = notebooks.find(n => n.id === selectedId);
    if (nb) {
      const url = nb.url || `https://notebooklm.google.com/notebook/${nb.id}`;
      chrome.tabs.query({ url: 'https://notebooklm.google.com/*' }, (tabs) => {
        if (tabs.length > 0 && tabs[0].id) {
          chrome.tabs.update(tabs[0].id, { url, active: true });
        } else {
          chrome.tabs.create({ url });
        }
      });
    }
  };

  const handleCreateNotebook = () => {
    chrome.tabs.create({ url: 'https://notebooklm.google.com' });
  };

  return (
    <div className="flex items-center gap-2 min-w-0">
      {/* Native select — matching reference add_to_NotebookLM layout */}
      <select
        ref={selectRef}
        value={selectedId}
        onChange={handleSelect}
        disabled={loading}
        className="flex-1 min-w-0 h-9 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg px-3 pr-8 appearance-none cursor-pointer hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-colors overflow-hidden"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239ca3af' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 10px center',
        }}
      >
        {loading ? (
          <option value="" className="truncate">Loading...</option>
        ) : notebooks.length === 0 ? (
          <option value="" className="truncate">No notebooks</option>
        ) : (
          notebooks.map((nb) => (
            <option key={nb.id} value={nb.id} className="truncate">
              📓{nb.title}
            </option>
          ))
        )}
      </select>

      {/* Open notebook button — matching reference layout */}
      <button
        onClick={handleOpenNotebook}
        disabled={!selectedId || loading}
        className="flex-shrink-0 w-9 h-9 flex items-center justify-center bg-white border border-gray-200 rounded-lg text-gray-400 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        title={t('notebook.openInTab')}
      >
        <ExternalLink className="w-4 h-4" />
      </button>

      {/* Create notebook button — when no notebooks exist */}
      {!loading && notebooks.length === 0 && (
        <button
          onClick={handleCreateNotebook}
          className="flex-shrink-0 h-9 px-3 text-[11px] font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors whitespace-nowrap"
        >
          + New
        </button>
      )}
    </div>
  );
}
