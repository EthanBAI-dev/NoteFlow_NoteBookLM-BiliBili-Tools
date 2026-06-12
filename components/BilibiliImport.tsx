import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Tv2, Loader2, CheckCircle, AlertCircle, ChevronDown, Download, Upload, User, PlayCircle, Heart, Layers, X } from 'lucide-react';
import type { ImportProgress } from '@/lib/types';
import { t } from '@/lib/i18n';
import { isBilibiliUrl, parseBilibiliUrl, isBilibiliSpaceUrl, parseBilibiliSpaceUrl } from '@/services/bilibili';
import type { BilibiliVideoItem, BilibiliSourceInfo } from '@/services/bilibili';
import { getOpState, clearOpState } from '@/services/op-state';
import { SourceInfoCard, SourceInfoCardSkeleton } from './SourceInfoCard';

type State = 'idle' | 'loading' | 'loaded' | 'fetching' | 'downloading' | 'uploading' | 'importing' | 'done' | 'error';
type FetchMode = 'single' | 'space' | 'favorite' | 'series' | 'season';
type ExportMode = 'separate' | 'merged';
type OutputFormat = 'md' | 'txt' | 'json' | 'srt';

const PAGE_SIZE = 100;
const OUTPUT_FORMATS: { value: OutputFormat; label: string }[] = [
  { value: 'md', label: '.md' },
  { value: 'txt', label: '.txt' },
  { value: 'json', label: '.json' },
  { value: 'srt', label: '.srt' },
];

const MODE_OPTIONS: { value: FetchMode; icon: typeof Tv2; labelKey: Parameters<typeof t>[0] }[] = [
  { value: 'single', icon: Tv2, labelKey: 'bilibili.modeSingle' },
  { value: 'season', icon: PlayCircle, labelKey: 'bilibili.modeSeason' },
  { value: 'series', icon: Layers, labelKey: 'bilibili.modeSeries' },
  { value: 'favorite', icon: Heart, labelKey: 'bilibili.modeFavorite' },
  { value: 'space', icon: User, labelKey: 'bilibili.modeSpace' },
];

function modeIcon(mode: FetchMode) {
  return MODE_OPTIONS.find(o => o.value === mode)?.icon || Tv2;
}

interface Props {
  initialUrl?: string;
  onProgress: (progress: ImportProgress | null) => void;
  fetchTrigger?: number;
  onImportHandlerChange?: (handler: (() => void) | null) => void;
}

/**
 * Auto-detect the best fetch mode from a Bilibili URL.
 * Resolve conflicts from most-specific to least-specific patterns.
 * After API fetch, the mode may be refined based on actual source.type.
 */
function detectFetchMode(url: string): FetchMode {
  if (isBilibiliSpaceUrl(url)) return 'space';
  if (/bilibili\.com\/list\/(watchlater|fav)/.test(url)) return 'favorite';
  if (/bilibili\.com\/list\/ml/.test(url)) return 'favorite';
  if (/bilibili\.com\/video\/.*\?p=\d+/.test(url)) return 'season';
  if (/bilibili\.com\/video\/BV/.test(url)) return 'single';
  return 'single';
}

/**
 * Refine fetchMode based on API response source type.
 */
function refineMode(source: BilibiliSourceInfo, _videos: BilibiliVideoItem[]): FetchMode {
  if (source.type === 'series') return 'series';
  if (source.isSeries) return 'season';
  return 'single';
}

export function BilibiliImport({ initialUrl, onProgress, fetchTrigger, onImportHandlerChange }: Props) {
  const [url, setUrl] = useState(initialUrl || '');
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState('');
  const [source, setSource] = useState<BilibiliSourceInfo | null>(null);
  const [videos, setVideos] = useState<BilibiliVideoItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [doneMsg, setDoneMsg] = useState('');

  const [fetchMode, setFetchMode] = useState<FetchMode>('single');
  const [exportMode, setExportMode] = useState<ExportMode>('merged');
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('md');
  const [aiPolish, setAiPolish] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dlProgress, setDlProgress] = useState<{ current: number; total: number; title?: string } | null>(null);
  const [activeAction, setActiveAction] = useState<'export' | 'import'>('export');
  const abortRef = useRef<{ port?: chrome.runtime.Port; cancel: () => void }>({ cancel: () => {} });
  const [subtitleStatus, setSubtitleStatus] = useState<'available' | 'unavailable' | 'checking' | undefined>(undefined);

  const isLocked = state === 'downloading' || state === 'importing';
  const isLockedRef = useRef(false);
  isLockedRef.current = isLocked;

  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  const displayedVideos = useMemo(() => videos.slice(0, displayCount), [videos, displayCount]);
  const canLoadMore = displayCount < videos.length;

  const videoKey = (v: BilibiliVideoItem) => `${v.bvid}-${v.page}`;

  const doFetch = useCallback((mode: FetchMode) => {
    if (!url && !initialUrl) return;

    const targetUrl = url || initialUrl || '';
    if (!targetUrl) { setError(t('bilibili.enterLink')); setState('error'); return; }

    setState('loading');
    setError('');
    setSource(null);
    setVideos([]);
    setDoneMsg('');
    setDisplayCount(PAGE_SIZE);

    if (mode === 'space') {
      if (!isBilibiliSpaceUrl(targetUrl) || !parseBilibiliSpaceUrl(targetUrl)) {
        setError(t('bilibili.spaceUnrecognized')); setState('error'); return;
      }
      const mid = parseBilibiliSpaceUrl(targetUrl);
      chrome.runtime.sendMessage(
        { type: 'FETCH_BILIBILI_SPACE', mid: mid! },
        (resp) => {
          if (resp?.success && resp.data) {
            const data = resp.data as { source: BilibiliSourceInfo; videos: BilibiliVideoItem[] };
            setSource(data.source);
            setVideos(data.videos);
            setSelected(new Set(data.videos.map(videoKey)));
            setDisplayCount(PAGE_SIZE);
            setFetchMode(refineMode(data.source, data.videos));
            setState('loaded');
          } else {
            setState('error');
            setError(resp?.error || t('bilibili.fetchFailed'));
          }
        },
      );
    } else {
      if (!isBilibiliUrl(targetUrl) || !parseBilibiliUrl(targetUrl)) {
        setError(t('bilibili.unrecognized')); setState('error'); return;
      }
      chrome.runtime.sendMessage(
        { type: 'FETCH_BILIBILI', url: targetUrl },
        (resp) => {
          if (resp?.success && resp.data) {
            const data = resp.data as { source: BilibiliSourceInfo; videos: BilibiliVideoItem[] };
            setSource(data.source);
            setVideos(data.videos);
            setSelected(new Set(data.videos.map(videoKey)));
            setDisplayCount(PAGE_SIZE);
            setFetchMode(refineMode(data.source, data.videos));
            setState('loaded');
          } else {
            setState('error');
            setError(resp?.error || t('bilibili.fetchFailed'));
          }
        },
      );
    }
  }, [t, url, initialUrl]);

  const handleFetch = useCallback(() => {
    doFetch(fetchMode);
  }, [doFetch, fetchMode]);

  // On first mount: recover lock if popup was closed during an operation
  useEffect(() => {
    getOpState().then((op) => {
      if (op?.active) {
        setState(op.phase === 'importing' ? 'importing' : 'downloading');
        setDlProgress({ current: op.current || 0, total: op.total || 0, title: op.title || '' });
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-detect mode when initialUrl changes (tab switch / page nav)
  const lastAutoUrl = useRef<string | null>(null);
  useEffect(() => {
    if (!initialUrl) return;
    if (isLockedRef.current) return;
    getOpState().then((op) => {
      if (op?.active) return;
      if (isLockedRef.current) return;
      if (lastAutoUrl.current === initialUrl) return;
      lastAutoUrl.current = initialUrl;
      setUrl(initialUrl);
      const mode = detectFetchMode(initialUrl);
      setFetchMode(mode);
      doFetch(mode);
    });
  }, [initialUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // FetchTrigger: re-read current page (user clicks header button)
  useEffect(() => {
    if (isLockedRef.current) return;
    if (fetchTrigger && fetchTrigger > 0 && initialUrl) {
      lastAutoUrl.current = null;
      setUrl(initialUrl);
      const mode = detectFetchMode(initialUrl);
      setFetchMode(mode);
      doFetch(mode);
    }
  }, [fetchTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Subtitle detection ──
  useEffect(() => {
    if (state !== 'loaded') {
      setSubtitleStatus(undefined);
      return;
    }

    const firstVideo = videos[0];
    if (!firstVideo) return;

    setSubtitleStatus('checking');
    const bvid = firstVideo.bvid;
    const cid = firstVideo.cid || 0;

    fetch(`https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        const subtitles = data?.data?.subtitle?.subtitles;
        setSubtitleStatus(subtitles && subtitles.length > 0 ? 'available' : 'unavailable');
      })
      .catch(() => setSubtitleStatus('unavailable'));
  }, [state, videos]);

  const getSelectedVideos = () => videos.filter(v => selected.has(videoKey(v)));

  const handleCancel = () => {
    abortRef.current.cancel();
    if (abortRef.current.port) {
      try { abortRef.current.port.disconnect(); } catch {}
      abortRef.current.port = undefined;
    }
    clearOpState();
    setDlProgress(null);
    setState('idle');
    setError('操作已取消');
  };

  const handleDownload = () => {
    const toProcess = getSelectedVideos();
    if (toProcess.length === 0) { setError(t('bilibili.selectAtLeastOne')); setState('error'); return; }

    setState('downloading');
    setError('');
    setDoneMsg('');
    setDlProgress({ current: 0, total: toProcess.length });

    const msgType = exportMode === 'merged' ? 'BILIBILI_DOWNLOAD_MERGED' : 'BILIBILI_DOWNLOAD_SEPARATE';
    const port = chrome.runtime.connect({ name: 'bilibili-download' });
    abortRef.current = { port, cancel: () => {} };
    let cancelled = false;

    port.postMessage({
      type: msgType,
      videos: toProcess,
      ownerName: source?.owner || '',
      desc: source?.desc || '',
      source: source,
      aiPolish,
    });

    port.onMessage.addListener((msg) => {
      if (cancelled) return;
      if (msg.phase === 'downloading') {
        setDlProgress({ current: Number(msg.current), total: Number(msg.total), title: String(msg.title || '') });
      } else if (msg.phase === 'polishing') {
        const cur = Number(msg.current || 0);
        const tot = Number(msg.total || 0);
        const pct = tot > 0 ? Math.round((cur / tot) * 100) : 0;
        setDlProgress({ current: cur, total: tot, title: `AI 润色 ${pct}% (${cur}/${tot})` });
      } else if (msg.phase === 'done') {
        setDlProgress(null);
        port.disconnect();
        abortRef.current = { cancel: () => {} };
        if (msg.downloaded !== undefined) {
          const { downloaded, skipped } = msg as any;
          setDoneMsg(skipped > 0
            ? `已下载 ${downloaded} 个字幕文件，${skipped} 个无字幕`
            : `已下载 ${downloaded} 个字幕文件`
          );
        } else {
          setDoneMsg(`已合并下载 ${toProcess.length} 个视频内容`);
        }
        setState('done');
      } else if (msg.phase === 'error') {
        setDlProgress(null);
        port.disconnect();
        abortRef.current = { cancel: () => {} };
        setState('error');
        setError(String(msg.error || t('bilibili.fetchFailed')));
      }
    });

    port.onDisconnect.addListener(() => {
      abortRef.current = { cancel: () => {} };
    });

    abortRef.current.cancel = () => { cancelled = true; };
  };

  const handleImport = () => {
    const toProcess = getSelectedVideos();
    if (toProcess.length === 0) { setError(t('bilibili.selectAtLeastOne')); setState('error'); return; }

    setState('importing');
    setError('');
    setDoneMsg('');
    setDlProgress({ current: 0, total: toProcess.length });

    const progress: ImportProgress = {
      total: toProcess.length,
      completed: 0,
      items: toProcess.map(v => ({ url: v.url, title: v.part || v.title, status: 'pending' })),
    };
    onProgress(progress);

    if (exportMode === 'merged' && toProcess.length > 1) {
      chrome.runtime.sendMessage(
        { type: 'IMPORT_BILIBILI_MERGED', videos: toProcess, ownerName: source?.owner || '', desc: source?.desc || '', source: source, aiPolish },
        (resp) => {
          onProgress(null);
          setDlProgress(null);
          if (resp?.success) {
            setDoneMsg(`已成功合并导入 ${toProcess.length} 个视频内容`);
            setState('done');
          } else {
            setState('error');
            setError(resp?.error || t('importFailed'));
          }
        },
      );
    } else {
      chrome.runtime.sendMessage(
        { type: 'IMPORT_BILIBILI_SUBTITLES', videos: toProcess, ownerName: source?.owner || '', desc: source?.desc || '', aiPolish },
        (resp) => {
          onProgress(null);
          setDlProgress(null);
          if (resp?.success) {
            const { imported, skipped } = resp.data as { imported: number; skipped: number };
            setDoneMsg(skipped > 0
              ? `已导入 ${imported} 个字幕，${skipped} 个无字幕`
              : `已导入 ${imported} 个字幕`
            );
            setState('done');
          } else {
            setState('error');
            setError(resp?.error || t('importFailed'));
          }
        },
      );
    }
  };

  // Register import handler for unified button
  useEffect(() => {
    onImportHandlerChange?.(selected.size > 0 && subtitleStatus !== 'unavailable' ? handleImport : null);
    return () => onImportHandlerChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onImportHandlerChange, handleImport, selected.size, source, subtitleStatus]);

  const toggleVideo = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(displayedVideos.map(videoKey)));
  const selectNone = () => setSelected(new Set());

  const isWorking = state === 'loading' || state === 'downloading' || state === 'uploading' || state === 'importing' || state === 'fetching';

  return (
    <div className="space-y-3">
      {/* Skeleton loader — shown while fetching data */}
      {state === 'loading' && <SourceInfoCardSkeleton platform="bilibili" />}

      {/* Source Info — using SourceInfoCard with subtitle detection */}
      {source && (
        <SourceInfoCard
          platform="bilibili"
          title={source.title}
          favicon="https://www.bilibili.com/favicon.ico"
          subtitle={source.owner ? `UP主：${source.owner}` : undefined}
          tags={subtitleStatus !== 'unavailable' ? [
            source.type === 'series' ? '合集' : source.isSeries && videos.length > 1 ? '分P' : '',
            `${source.videoCount} ${source.isSeries ? t('bilibili.parts') : t('bilibili.singleVideo')}`,
          ].filter(Boolean) : undefined}
          subtitleStatus={subtitleStatus}
        />
      )}

      {/* Subtitle unavailable notice */}
      {state === 'loaded' && subtitleStatus === 'unavailable' && (
        <div className="flex items-center gap-2 text-amber-600 text-sm bg-amber-50 border border-amber-100/60 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          该视频没有可用字幕，无法导入
        </div>
      )}

      {/* Video List — hidden when no subtitles */}
      {subtitleStatus !== 'unavailable' && videos.length > 1 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">
              {t('bilibili.selectedParts', { selected: selected.size, total: displayedVideos.length })}
            </span>
            <div className="flex gap-2 text-xs">
              <button onClick={selectAll} className="text-[#00a1d6] hover:underline">{t('selectAll')}</button>
              <button onClick={selectNone} className="text-gray-400 hover:underline">{t('deselectAll')}</button>
            </div>
          </div>
          <div className="max-h-36 overflow-y-auto border border-border-strong rounded-lg shadow-soft">
            {displayedVideos.map((video) => {
              const key = videoKey(video);
              return (
                <label
                  key={key}
                  className="flex items-start gap-3 p-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0 transition-colors duration-150"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(key)}
                    onChange={() => toggleVideo(key)}
                    className="mt-1 rounded border-gray-300 text-[#00a1d6] focus:ring-[#00a1d6]"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 line-clamp-1">
                      <span className="text-gray-400 mr-1">P{video.page}</span>
                      {video.part || video.title}
                    </p>
                    {video.duration && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {Math.floor(video.duration / 60)}:{String(video.duration % 60).padStart(2, '0')}
                      </p>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
          {canLoadMore && (
            <button
              onClick={() => setDisplayCount(c => Math.min(c + PAGE_SIZE, videos.length))}
              className="w-full mt-2 py-1.5 text-xs text-[#00a1d6] hover:text-[#0090c0] hover:bg-sky-50 border border-sky-200/60 rounded-lg flex items-center justify-center gap-1 transition-colors duration-150"
            >
              <ChevronDown className="w-3 h-3" />加载更多（{videos.length - displayCount} 个）
            </button>
          )}
        </div>
      )}

      {/* Tabs: 导出字幕 | 导入notebookLM — hidden when no subtitles */}
      {subtitleStatus !== 'unavailable' && videos.length > 0 && (
        <div>
          <div className="flex border-b border-gray-200 mb-3">
            <button
              onClick={() => setActiveAction('export')}
              className={`flex-1 py-2 text-xs font-medium transition-colors duration-150 border-b-2 -mb-px ${
                activeAction === 'export'
                  ? 'border-[#00a1d6] text-[#00a1d6]'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <Download className="w-3.5 h-3.5 inline mr-1" />
              {t('bilibili.tabExport')}
            </button>
            <button
              onClick={() => setActiveAction('import')}
              className={`flex-1 py-2 text-xs font-medium transition-colors duration-150 border-b-2 -mb-px ${
                activeAction === 'import'
                  ? 'border-[#00a1d6] text-[#00a1d6]'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <Upload className="w-3.5 h-3.5 inline mr-1" />
              {t('bilibili.tabImport')}
            </button>
          </div>

          {activeAction === 'export' ? (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">{t('bilibili.outputType')}</p>
              <div className="flex items-center gap-1.5">
                <div className="flex rounded-lg border border-gray-200/60 overflow-hidden">
                  <button
                    onClick={() => setExportMode('separate')}
                    className={`px-2.5 py-1 text-[11px] font-medium transition-colors duration-150 ${
                      exportMode === 'separate'
                        ? 'bg-[#00a1d6] text-white'
                        : 'bg-white text-gray-400 hover:text-gray-500'
                    }`}
                  >
                    {t('bilibili.separate')}
                  </button>
                  <button
                    onClick={() => setExportMode('merged')}
                    className={`px-2.5 py-1 text-[11px] font-medium transition-colors duration-150 border-l border-gray-200/60 ${
                      exportMode === 'merged'
                        ? 'bg-[#00a1d6] text-white'
                        : 'bg-white text-gray-400 hover:text-gray-500'
                    }`}
                  >
                    {t('bilibili.merged')}
                  </button>
                </div>
                <select
                  value={outputFormat}
                  onChange={(e) => setOutputFormat(e.target.value as OutputFormat)}
                  className="text-[11px] border border-gray-200/60 rounded-lg px-2 py-1 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-[#00a1d6]/40"
                >
                  {OUTPUT_FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
                <div className="flex-1" />
                <span className="text-[11px] text-gray-500">{t('bilibili.aiPolish')}</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={aiPolish}
                    onChange={(e) => setAiPolish(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-7 h-4 bg-gray-200 peer-focus:outline-none peer-focus:ring-1 peer-focus:ring-[#00a1d6]/40 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#00a1d6]"></div>
                </label>
              </div>

              <button
                onClick={handleDownload}
                disabled={selected.size === 0 || isWorking || subtitleStatus === 'unavailable' || subtitleStatus === 'checking'}
                className="w-full py-2.5 bg-sky-500 hover:bg-sky-600 text-white text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-btn hover:shadow-btn-hover transition-all duration-150 btn-press"
              >
                {state === 'downloading' ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />{t('bilibili.fetchingSubtitles')}</>
                ) : (
                  <><Download className="w-4 h-4" />{t('bilibili.downloadOneClick')}（{selected.size}）</>
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">{t('bilibili.importType')}</p>
              <div className="flex rounded-lg border border-gray-200/60 overflow-hidden">
                <button
                  onClick={() => setExportMode('separate')}
                  className={`px-2.5 py-1 text-[11px] font-medium transition-colors duration-150 ${
                    exportMode === 'separate'
                      ? 'bg-[#00a1d6] text-white'
                      : 'bg-white text-gray-400 hover:text-gray-500'
                  }`}
                >
                  {t('bilibili.separate')}
                </button>
                <button
                  onClick={() => setExportMode('merged')}
                  className={`px-2.5 py-1 text-[11px] font-medium transition-colors duration-150 border-l border-gray-200/60 ${
                    exportMode === 'merged'
                      ? 'bg-[#00a1d6] text-white'
                      : 'bg-white text-gray-400 hover:text-gray-500'
                  }`}
                >
                  {t('bilibili.merged')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lock Overlay — shown during download/import */}
      {isLocked && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6 w-[280px] text-center space-y-4 animate-fade-in">
            <div className="w-12 h-12 mx-auto rounded-full bg-[#00a1d6]/10 flex items-center justify-center">
              {state === 'downloading' ? (
                <Download className="w-6 h-6 text-[#00a1d6]" />
              ) : (
                <Upload className="w-6 h-6 text-[#00a1d6]" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-800">
                {state === 'downloading' ? '正在导出字幕…' : '正在导入 NotebookLM…'}
              </p>
              {dlProgress && (
                <p className="text-xs text-gray-400 mt-1">
                  {dlProgress.title || `${dlProgress.current}/${dlProgress.total}`}
                </p>
              )}
            </div>
            {dlProgress && dlProgress.total > 0 && (
              <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-[#00a1d6] h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${Math.round((dlProgress.current / dlProgress.total) * 100)}%` }}
                />
              </div>
            )}
            <div className="flex items-center justify-center gap-1 text-[#00a1d6]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span className="text-xs text-gray-400">处理中…</span>
            </div>
            <button
              onClick={handleCancel}
              className="w-full py-2 text-xs font-medium text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg border border-gray-200 transition-colors duration-150 flex items-center justify-center gap-1"
            >
              <X className="w-3 h-3" />
              取消操作
            </button>
          </div>
        </div>
      )}

      {/* Done Message */}
      {state === 'done' && doneMsg && (
        <div className="flex items-center gap-2 text-green-600 text-sm bg-green-50 border border-green-100/60 rounded-lg p-3">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {doneMsg}
        </div>
      )}

      {/* Error — show SourceInfoCard with no-content badge for recognized Bilibili URLs */}
      {state === 'error' && (
        /bilibili\.com\//.test(url) ? (
          <SourceInfoCard
            platform="bilibili"
            title="Bilibili"
            favicon="https://www.bilibili.com/favicon.ico"
            subtitle={url}
            noContent
          />
        ) : (
          <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 border border-red-100/60 rounded-lg p-3 shadow-soft">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )
      )}
    </div>
  );
}
