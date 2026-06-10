import { useState, useEffect, useRef } from 'react';
import {
  Bookmark,
  BookmarkPlus,
  Loader2,
  CheckCircle,
  AlertCircle,
  Trash2,
  FileDown,
  Copy,
  FolderPlus,
  X,
  Upload,
  Tv2,
  Youtube,
  Headphones,
  MessageCircle,
  Globe,
} from 'lucide-react';
import type { ImportProgress } from '@/lib/types';
import type { BookmarkItem } from '@/services/bookmarks';
import type { PdfProgress } from '@/services/pdf-generator';
import { t } from '@/lib/i18n';
import { SourceInfoCard, type SourcePlatform } from './SourceInfoCard';

interface Props {
  onProgress: (progress: ImportProgress | null) => void;
  onImportHandlerChange?: (handler: (() => void) | null) => void;
}

type PanelState = 'idle' | 'loading' | 'importing' | 'exporting' | 'success' | 'error';

/** URL-based category detection — mirrors App.tsx detectUrl logic */
type BookmarkCategory = 'bilibili' | 'youtube' | 'podcast' | 'ai' | 'web';

const CATEGORY_ICONS: Record<BookmarkCategory, typeof Tv2> = {
  bilibili: Tv2,
  youtube: Youtube,
  podcast: Headphones,
  ai: MessageCircle,
  web: Globe,
};

function getCategory(url: string): BookmarkCategory {
  if (/bilibili\.com\/(video|space)/.test(url)) return 'bilibili';
  if (/youtube\.com\/(watch|playlist|shorts|@|channel|c\/|user\/)|youtu\.be\//.test(url)) return 'youtube';
  if (/podcasts\.apple\.com\//.test(url) || /xiaoyuzhoufm\.com\/(episode|podcast)\//.test(url)) return 'podcast';
  if (/claude\.ai\/|chatgpt\.com\/|chat\.openai\.com\/|gemini\.google\.com\//.test(url)) return 'ai';
  return 'web';
}

export function WebImport({ onProgress, onImportHandlerChange }: Props) {
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeCollection, setActiveCollection] = useState<string>('all');
  const [activeCategory, setActiveCategory] = useState<BookmarkCategory | 'all'>('all');
  const [state, setState] = useState<PanelState>('idle');
  const [error, setError] = useState('');
  const [currentTabInfo, setCurrentTabInfo] = useState<{ url: string; title: string; favicon?: string } | null>(null);
  const [isCurrentBookmarked, setIsCurrentBookmarked] = useState(false);
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [pdfState, setPdfState] = useState<'idle' | 'fetching' | 'generating' | 'done' | 'copied'>('idle');
  const [pdfProgress, setPdfProgress] = useState<PdfProgress | null>(null);

  // ── Track last-seen tab URL to avoid redundant refreshes ──
  const lastTabUrlRef = useRef<string>('');

  // Load bookmarks and current tab info
  useEffect(() => {
    loadData();
    loadCurrentTab();
  }, []);

  // ── Listen for tab switches/updates to refresh currentTabInfo ──
  // This is the KEY fix: when user switches between two web-type sites
  // (e.g. github.com → stackoverflow.com), the bookmark tab stays
  // mounted, so the mount-only useEffect above won't re-fire.
  // By listening to Chrome tab events directly, we detect URL changes
  // regardless of tab-type transitions.
  useEffect(() => {
    const handleActivated = (activeInfo: chrome.tabs.TabActiveInfo) => {
      chrome.tabs.get(activeInfo.tabId, (tab) => {
        if (!tab?.url || tab.url === lastTabUrlRef.current) return;
        lastTabUrlRef.current = tab.url;
        console.log(`[WebImport] Tab activated: ${tab.url.slice(0, 80)}`);
        if (tab.url.startsWith('http') && !/notebooklm\.google\.com/.test(tab.url)) {
          setCurrentTabInfo({
            url: tab.url,
            title: tab.title || tab.url,
            favicon: tab.favIconUrl,
          });
          chrome.runtime.sendMessage({ type: 'IS_BOOKMARKED', url: tab.url }, (resp) => {
            if (resp?.success) setIsCurrentBookmarked(resp.data);
          });
          // Also refresh bookmark/collection data
          loadData();
        }
      });
    };

    const handleUpdated = (_tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changeInfo.url && changeInfo.url !== lastTabUrlRef.current) {
        lastTabUrlRef.current = changeInfo.url;
        console.log(`[WebImport] Tab updated: ${changeInfo.url.slice(0, 80)}`);
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tab = tabs[0];
          if (!tab?.url || !tab.url.startsWith('http') || /notebooklm\.google\.com/.test(tab.url)) return;
          setCurrentTabInfo({
            url: tab.url,
            title: tab.title || tab.url,
            favicon: tab.favIconUrl,
          });
          chrome.runtime.sendMessage({ type: 'IS_BOOKMARKED', url: tab.url }, (resp) => {
            if (resp?.success) setIsCurrentBookmarked(resp.data);
          });
          loadData();
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

  const loadData = () => {
    chrome.runtime.sendMessage({ type: 'GET_BOOKMARKS' }, (resp) => {
      if (resp?.success) setBookmarks(resp.data || []);
    });
    chrome.runtime.sendMessage({ type: 'GET_COLLECTIONS' }, (resp) => {
      if (resp?.success) setCollections(resp.data || []);
    });
  };

  const loadCurrentTab = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab?.url?.startsWith('http') && !/notebooklm\.google\.com/.test(tab.url)) {
        setCurrentTabInfo({
          url: tab.url,
          title: tab.title || tab.url,
          favicon: tab.favIconUrl,
        });
        chrome.runtime.sendMessage({ type: 'IS_BOOKMARKED', url: tab.url }, (resp) => {
          if (resp?.success) setIsCurrentBookmarked(resp.data);
        });
      }
    });
  };

  const handleAddBookmark = (collection?: string) => {
    if (!currentTabInfo) return;
    chrome.runtime.sendMessage(
      { type: 'ADD_BOOKMARK', url: currentTabInfo.url, title: currentTabInfo.title, favicon: currentTabInfo.favicon, collection },
      (resp) => {
        if (resp?.success) {
          setIsCurrentBookmarked(true);
          loadData();
        }
      }
    );
  };

  const handleRemove = (id: string) => {
    chrome.runtime.sendMessage({ type: 'REMOVE_BOOKMARK', id }, () => {
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      loadData();
      if (currentTabInfo) {
        chrome.runtime.sendMessage({ type: 'IS_BOOKMARKED', url: currentTabInfo.url }, (resp) => {
          if (resp?.success) setIsCurrentBookmarked(resp.data);
        });
      }
    });
  };

  const handleRemoveSelected = () => {
    if (selectedIds.size === 0) return;
    chrome.runtime.sendMessage({ type: 'REMOVE_BOOKMARKS', ids: Array.from(selectedIds) }, () => {
      setSelectedIds(new Set());
      loadData();
    });
  };

  const handleCreateCollection = () => {
    if (!newCollectionName.trim()) return;
    chrome.runtime.sendMessage({ type: 'CREATE_COLLECTION', name: newCollectionName.trim() }, () => {
      setNewCollectionName('');
      setShowNewCollection(false);
      loadData();
    });
  };

  const handleExport = (mode: 'pdf' | 'clipboard') => {
    const items = filteredBookmarks.filter((b) => selectedIds.has(b.id));
    if (items.length === 0) return;

    setPdfState('fetching');
    setPdfProgress(null);
    setError('');

    const siteInfo = {
      title: activeCollection === 'all' ? t('bookmark.collection') : activeCollection,
      baseUrl: '',
      framework: 'unknown' as const,
      pages: items.map((b) => ({ url: b.url, title: b.title, path: b.url })),
    };

    const port = chrome.runtime.connect({ name: 'pdf-export' });
    port.postMessage({ type: mode === 'clipboard' ? 'GENERATE_CLIPBOARD' : 'GENERATE_PDF', siteInfo });

    port.onMessage.addListener(async (msg) => {
      if (msg.phase === 'fetching') {
        setPdfState('fetching');
        setPdfProgress({ phase: 'fetching', current: msg.current, total: msg.total, currentPage: msg.currentPage });
      } else if (msg.phase === 'rendering') {
        setPdfState('generating');
        setPdfProgress({ phase: 'rendering', current: 1, total: 1 });
      } else if (msg.phase === 'clipboard') {
        try {
          await navigator.clipboard.writeText(msg.markdown);
          setPdfState('copied');
        } catch {
          setState('error');
          setError(t('clipboardFailed'));
          setPdfState('idle');
        }
      } else if (msg.phase === 'done') {
        if (mode === 'pdf') setPdfState('done');
        port.disconnect();
      } else if (msg.phase === 'error') {
        setState('error');
        setError(msg.error || t('pdfFailed'));
        setPdfState('idle');
        port.disconnect();
      }
    });

    port.onDisconnect.addListener(() => {
      if (pdfState !== 'done' && pdfState !== 'copied') setPdfState('done');
    });
  };

  const handleImportToNotebookLM = () => {
    const items = filteredBookmarks.filter((b) => selectedIds.has(b.id));
    if (items.length === 0) return;

    setState('importing');
    setError('');
    const urls = items.map((b) => b.url);

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

  // Register import handler for unified button
  useEffect(() => {
    onImportHandlerChange?.(selectedIds.size > 0 ? handleImportToNotebookLM : null);
    return () => onImportHandlerChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onImportHandlerChange, handleImportToNotebookLM, selectedIds.size]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  // Filter by collection first, then by category
  const collectionFiltered = activeCollection === 'all'
    ? bookmarks
    : bookmarks.filter((b) => b.collection === activeCollection);

  const filteredBookmarks = activeCategory === 'all'
    ? collectionFiltered
    : collectionFiltered.filter((b) => getCategory(b.url) === activeCategory);

  // Category counts from all bookmarks (not filtered by collection)
  const categoryCounts = (() => {
    const counts: Record<string, number> = {};
    for (const b of bookmarks) {
      const cat = getCategory(b.url);
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  })();

  const selectAll = () => setSelectedIds(new Set(filteredBookmarks.map((b) => b.id)));
  const deselectAll = () => setSelectedIds(new Set());

  const handleMoveSelected = (targetCollection: string) => {
    if (selectedIds.size === 0) return;
    chrome.runtime.sendMessage(
      { type: 'MOVE_BOOKMARKS', ids: Array.from(selectedIds), collection: targetCollection },
      () => {
        setSelectedIds(new Set());
        loadData();
      }
    );
  };

  const handleMoveItem = (id: string, targetCollection: string) => {
    chrome.runtime.sendMessage(
      { type: 'MOVE_BOOKMARK', id, collection: targetCollection },
      () => loadData()
    );
  };

  return (
    <div className="space-y-3">
      {/* Source Info Card — matches Bilibili/YouTube design pattern */}
      {currentTabInfo && (
        <div className="space-y-2">
          <SourceInfoCard
            platform={getCategory(currentTabInfo.url) as SourcePlatform}
            title={currentTabInfo.title}
            favicon={currentTabInfo.favicon}
            subtitle={currentTabInfo.url}
          />
          {/* Compact action row */}
          <div className="flex items-center gap-1.5 justify-end">
            {isCurrentBookmarked ? (
              <span className="flex items-center gap-1 text-[10px] text-notebooklm-blue bg-blue-50/80 px-2 py-1 rounded-md border border-blue-200/40">
                <Bookmark className="w-2.5 h-2.5 fill-current" />
                {t('bookmark.bookmarked')}
              </span>
            ) : (
              <button
                onClick={() => handleAddBookmark()}
                className="btn-press flex items-center gap-1 px-2.5 py-1 bg-notebooklm-blue text-white text-[10px] rounded-md hover:bg-notebooklm-blue-dark transition-colors"
              >
                <BookmarkPlus className="w-2.5 h-2.5" />
                {t('bookmark.addBookmark')}
              </button>
            )}
            <button
              onClick={() => {
                if (!currentTabInfo?.url) return;
                chrome.runtime.sendMessage(
                  { type: 'IMPORT_URL', url: currentTabInfo.url },
                  (resp) => {
                    if (resp?.success) {
                      setState('success');
                      setTimeout(() => setState('idle'), 2000);
                    } else {
                      setError(resp?.error || t('importFailed'));
                      setState('error');
                    }
                  }
                );
                setState('importing');
              }}
              disabled={state === 'importing'}
              className="btn-press flex items-center gap-1 px-2.5 py-1 bg-amber-500 text-white text-[10px] rounded-md hover:bg-amber-600 transition-colors"
            >
              {state === 'importing' ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Upload className="w-2.5 h-2.5" />}
              {t('bookmark.importNow')}
            </button>
          </div>
        </div>
      )}

      {/* Category filter tabs (auto-categorization by URL) */}
      {bookmarks.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto flex-wrap">
          {(['all', 'bilibili', 'youtube', 'podcast', 'ai', 'web'] as const).map((cat) => {
            const count = cat === 'all' ? bookmarks.length : (categoryCounts[cat] || 0);
            if (count === 0 && cat !== 'all') return null;
            const Icon = cat === 'all' ? Bookmark : CATEGORY_ICONS[cat as BookmarkCategory];
            return (
              <button
                key={cat}
                onClick={() => { setActiveCategory(cat); deselectAll(); }}
                className={`btn-press flex items-center gap-1 px-2.5 py-1 text-xs rounded-full whitespace-nowrap transition-colors ${
                  activeCategory === cat
                    ? 'bg-notebooklm-blue text-white shadow-sm'
                    : 'bg-gray-100/60 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <Icon className="w-3 h-3" />
                {cat === 'all' ? t('bookmark.all') : cat} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Collection tabs */}
      {collections.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto">
          <button
            onClick={() => { setActiveCollection('all'); deselectAll(); }}
            className={`btn-press px-2.5 py-1 text-xs rounded-full whitespace-nowrap transition-colors ${
              activeCollection === 'all' ? 'bg-gray-200 text-gray-700' : 'bg-gray-100/60 text-gray-500 hover:bg-gray-200'
            }`}
          >
            📁 {t('bookmark.all')} ({bookmarks.length})
          </button>
          {collections.map((col) => {
            const count = bookmarks.filter((b) => b.collection === col).length;
            return (
              <button
                key={col}
                onClick={() => { setActiveCollection(col); deselectAll(); }}
                className={`btn-press px-2.5 py-1 text-xs rounded-full whitespace-nowrap transition-colors ${
                  activeCollection === col ? 'bg-gray-200 text-gray-700' : 'bg-gray-100/60 text-gray-500 hover:bg-gray-200'
                }`}
              >
                📁 {col} ({count})
              </button>
            );
          })}
          <button
            onClick={() => setShowNewCollection(!showNewCollection)}
            className="btn-press p-1 text-gray-400 hover:text-gray-600 rounded"
            title={t('bookmark.newCollection')}
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* New collection input */}
      {showNewCollection && (
        <div className="flex gap-2">
          <input
            type="text"
            value={newCollectionName}
            onChange={(e) => setNewCollectionName(e.target.value)}
            placeholder={t('bookmark.collectionName')}
            className="flex-1 px-3 py-1.5 border border-gray-200/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreateCollection(); }}
          />
          <button onClick={handleCreateCollection} className="btn-press px-3 py-1.5 bg-notebooklm-blue text-white text-xs rounded-lg hover:bg-notebooklm-blue-dark">
            {t('create')}
          </button>
          <button onClick={() => setShowNewCollection(false)} className="btn-press p-1.5 text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Bookmark list */}
      {filteredBookmarks.length > 0 ? (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500 font-mono tabular-nums">
              {selectedIds.size > 0 ? t('bookmark.selectedItems', { count: selectedIds.size }) : t('bookmark.totalItems', { count: filteredBookmarks.length })}
            </span>
            <div className="flex gap-2 text-xs">
              <button onClick={selectAll} className="btn-press text-notebooklm-blue hover:underline">{t('selectAll')}</button>
              <button onClick={deselectAll} className="btn-press text-gray-400 hover:underline">{t('cancel')}</button>
              {selectedIds.size > 0 && (
                <>
                  {collections.length > 0 && (
                    <select
                      onChange={(e) => { if (e.target.value) { handleMoveSelected(e.target.value); e.target.value = ''; } }}
                      className="text-xs text-gray-500 bg-transparent border border-gray-200 rounded px-1 py-0.5 cursor-pointer hover:border-gray-300"
                      defaultValue=""
                    >
                      <option value="" disabled>{t('bookmark.moveTo')}</option>
                      {collections.filter((c) => c !== activeCollection || activeCollection === 'all').map((col) => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  )}
                  <button onClick={handleRemoveSelected} className="btn-press text-red-400 hover:text-red-600">{t('delete')}</button>
                </>
              )}
            </div>
          </div>

          <div className="max-h-[200px] overflow-y-auto border border-border-strong rounded-lg shadow-soft">
            {filteredBookmarks.map((item) => {
              const cat = getCategory(item.url);
              const CatIcon = CATEGORY_ICONS[cat];
              return (
                <label
                  key={item.id}
                  className="flex items-center gap-2 p-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100/60 last:border-b-0 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    onChange={() => toggleSelect(item.id)}
                    className="rounded border-gray-300 text-notebooklm-blue focus:ring-blue-500"
                  />
                  <CatIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  {item.favicon && <img src={item.favicon} className="w-4 h-4 flex-shrink-0" alt="" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700 truncate">{item.title}</p>
                    <p className="text-[10px] text-gray-400 truncate">{item.url}</p>
                  </div>
                  {collections.length > 1 && (
                    <select
                      value=""
                      onChange={(e) => { e.preventDefault(); e.stopPropagation(); if (e.target.value) { handleMoveItem(item.id, e.target.value); e.target.value = ''; } }}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      className="text-[10px] text-gray-400 bg-transparent border border-gray-200/60 rounded px-1 py-0.5 cursor-pointer hover:border-gray-300 flex-shrink-0 max-w-[60px]"
                    >
                      <option value="" disabled>{t('bookmark.moveToCollection')}</option>
                      {collections.filter((c) => c !== item.collection).map((col) => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  )}
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRemove(item.id); }}
                    className="btn-press p-1 text-gray-300 hover:text-red-500 flex-shrink-0"
                    title={t('delete')}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </label>
              );
            })}
          </div>

          {/* Action buttons */}
          {selectedIds.size > 0 && (
            <div className="space-y-2">
              {pdfState === 'fetching' || pdfState === 'generating' ? (
                <button
                  disabled
                  className="btn-press w-full py-2 bg-emerald-500 text-white text-sm rounded-lg disabled:opacity-70 flex items-center justify-center gap-2"
                >
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {pdfState === 'fetching'
                    ? t('pdfFetching', { current: pdfProgress?.current || 0, total: pdfProgress?.total || selectedIds.size })
                    : t('pdfGeneratingSimple')}
                </button>
              ) : pdfState === 'done' || pdfState === 'copied' ? (
                <p className="text-sm text-emerald-600 flex items-center justify-center gap-1.5 py-1">
                  <CheckCircle className="w-4 h-4" />
                  {pdfState === 'copied' ? t('clipboardCopied') : t('pdfDownloaded')}
                </p>
              ) : (
                <div className="flex gap-1.5">
                  <button
                    onClick={() => handleExport('pdf')}
                    disabled={state === 'importing'}
                    className="btn-press flex-1 py-2 bg-emerald-500 text-white text-sm rounded-lg hover:bg-emerald-500/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 shadow-btn hover:shadow-btn-hover transition-all duration-150"
                  >
                    <FileDown className="w-4 h-4" />
                    {t('downloadPdf')}
                  </button>
                  <button
                    onClick={() => handleExport('clipboard')}
                    disabled={state === 'importing'}
                    className="btn-press py-2 px-2.5 bg-emerald-500 text-white rounded-lg hover:bg-emerald-500/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center shadow-btn hover:shadow-btn-hover transition-all duration-150"
                    title={t('copyToClipboard')}
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      ) : null}

      {/* Status messages */}
      {state === 'success' && (
        <div className="flex items-center gap-2 text-green-600 text-sm bg-green-50 rounded-lg p-3 shadow-soft border border-green-100">
          <CheckCircle className="w-4 h-4" />{t('importSuccess')}
        </div>
      )}
      {state === 'error' && (
        <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 rounded-lg p-3 shadow-soft border border-red-100">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
        </div>
      )}
      {pdfState === 'done' && (
        <p className="text-xs text-emerald-600 text-center">{t('bookmark.pdfSaved')}</p>
      )}

    </div>
  );
}
