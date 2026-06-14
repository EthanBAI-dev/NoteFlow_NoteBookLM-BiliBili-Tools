import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Loader2, CheckCircle, AlertCircle, ChevronDown, Download, X } from 'lucide-react';
import type { ImportProgress } from '@/lib/types';
import { t } from '@/lib/i18n';
import { isBilibiliUrl, parseBilibiliUrl, isBilibiliSpaceUrl, parseBilibiliSpaceUrl, isBilibiliFavUrl } from '@/services/bilibili';
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
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dlProgress, setDlProgress] = useState<{ current: number; total: number; title?: string } | null>(null);
  const abortRef = useRef<{ port?: chrome.runtime.Port; cancel: () => void }>({ cancel: () => {} });
  const [subtitleStatus, setSubtitleStatus] = useState<'available' | 'unavailable' | 'checking' | undefined>(undefined);

  // ── Resizable list height ──
  const [listHeight, setListHeight] = useState<number>(144); // default ~9 rows (36*4)
  const listRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startY = e.clientY;
    const startHeight = listRef.current?.offsetHeight || listHeight;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = ev.clientY - startY;
      const newHeight = Math.max(80, Math.min(400, startHeight + delta));
      setListHeight(newHeight);
    };

    const onMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [listHeight]);

  // ── Fetch deduplication & lifecycle guard ──
  const fetchGenRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

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

  const doFetch = useCallback((mode: FetchMode, targetUrlOverride?: string) => {
    const targetUrl = targetUrlOverride || url || initialUrl || '';
    if (!targetUrl) { setError(t('bilibili.enterLink')); setState('error'); return; }

    const gen = ++fetchGenRef.current;
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
          if (!mountedRef.current || fetchGenRef.current !== gen) return; // stale
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
    } else if (mode === 'favorite') {
      if (!isBilibiliFavUrl(targetUrl)) {
        setError(t('bilibili.unrecognized')); setState('error'); return;
      }
      chrome.runtime.sendMessage(
        { type: 'FETCH_BILIBILI_FAVORITE', url: targetUrl },
        (resp) => {
          if (!mountedRef.current || fetchGenRef.current !== gen) return; // stale
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
          if (!mountedRef.current || fetchGenRef.current !== gen) return; // stale
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
      doFetch(mode, initialUrl); // Pass URL explicitly to avoid stale closure on `url` state
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
      doFetch(mode, initialUrl); // Pass URL explicitly to avoid stale closure on `url` state
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

    const gen = ++fetchGenRef.current;
    setSubtitleStatus('checking');
    const bvid = firstVideo.bvid;
    const cid = firstVideo.cid || 0;

    const controller = new AbortController();

    fetch(`https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`, { credentials: 'include', signal: controller.signal })
      .then(r => r.json())
      .then(data => {
        if (!mountedRef.current || fetchGenRef.current !== gen) return; // stale
        const subtitles = data?.data?.subtitle?.subtitles;
        setSubtitleStatus(subtitles && subtitles.length > 0 ? 'available' : 'unavailable');
      })
      .catch(() => {
        if (!mountedRef.current || fetchGenRef.current !== gen) return; // stale
        setSubtitleStatus('unavailable');
      });

    return () => controller.abort();
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

  const handleDownload = (modeOverride?: ExportMode) => {
    const toProcess = getSelectedVideos();
    if (toProcess.length === 0) { setError(t('bilibili.selectAtLeastOne')); setState('error'); return; }

    const effectiveMode = modeOverride || exportMode;
    setExportMode(effectiveMode);
    setState('downloading');
    setError('');
    setDoneMsg('');
    setDlProgress({ current: 0, total: toProcess.length });

    const msgType = effectiveMode === 'merged' ? 'BILIBILI_DOWNLOAD_MERGED' : 'BILIBILI_DOWNLOAD_SEPARATE';
    const port = chrome.runtime.connect({ name: 'bilibili-download' });
    abortRef.current = { port, cancel: () => {} };
    let cancelled = false;

    port.postMessage({
      type: msgType,
      videos: toProcess,
      ownerName: source?.owner || '',
      desc: source?.desc || '',
      source: source,
      outputFormat: outputFormat,
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

  // Register download handler for unified App-level "导入 NotebookLM" button
  useEffect(() => {
    onImportHandlerChange?.(selected.size > 0 && subtitleStatus !== 'unavailable' ? () => handleDownload() : null);
    return () => onImportHandlerChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onImportHandlerChange, handleDownload, selected.size, subtitleStatus]);

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
          subtitle={[
            source.owner ? `UP主：${source.owner}` : '',
            `${source.videoCount || videos.length} 个视频`,
          ].filter(Boolean).join('|')}
          inlineTags
          tags={subtitleStatus !== 'unavailable' ? [
            source.type === 'series' ? '合集' : source.isSeries && videos.length > 1 ? '视频选集' : '',
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
          {/* Top row: selected count + 全选/取消全选 */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">
              {t('bilibili.selectedParts', { selected: selected.size, total: displayedVideos.length })}
            </span>
            <div className="flex gap-2 text-xs">
              <button onClick={selectAll} className="text-[#00a1d6] hover:underline">{t('selectAll')}</button>
              <button onClick={selectNone} className="text-gray-400 hover:underline">{t('deselectAll')}</button>
            </div>
          </div>

          {/* Unified container: list + action bar + resize handle */}
          <div className="border border-border-strong rounded-lg shadow-soft overflow-hidden">
            <div
              ref={listRef}
              className="overflow-y-auto"
              style={{ height: listHeight }}
            >
              {displayedVideos.map((video) => {
                const key = videoKey(video);
                const handleSingleDownload = () => {
                  chrome.runtime.sendMessage(
                    { type: 'DOWNLOAD_BILIBILI_SINGLE_SUBTITLE', video: video, ownerName: source?.owner || '', desc: source?.desc || '' },
                    (resp) => {
                      if (resp?.success) {
                        setDoneMsg(`"${video.part || video.title}" 字幕下载完成`);
                      } else {
                        setError(resp?.error || '字幕下载失败');
                        setState('error');
                      }
                    }
                  );
                };

                return (
                  <label
                    key={key}
                    className="flex items-start gap-2 p-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0 transition-colors duration-150"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={() => toggleVideo(key)}
                      className="mt-1 rounded border-gray-300 text-[#00a1d6] focus:ring-[#00a1d6]"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700 truncate">
                        <span className="text-gray-400 mr-1">P{video.page}</span>
                        {video.part || video.title}
                      </p>
                      {video.duration ? (
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {Math.floor(video.duration / 60)}:{String(video.duration % 60).padStart(2, '0')}
                        </p>
                      ) : (
                        <p className="text-[11px] text-gray-300 mt-0.5">--:--</p>
                      )}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleSingleDownload(); }}
                      className="flex-shrink-0 px-2 py-1 text-[11px] rounded-md border border-gray-300 bg-white/70 text-gray-400 hover:bg-white hover:text-gray-600 hover:border-gray-400 transition-all duration-150 btn-press"
                    >
                      TXT
                    </button>
                  </label>
                );
              })}
            </div>

            {/* Resize handle — between list and action bar */}
            <div
              onMouseDown={handleResizeStart}
              className="flex items-center justify-center py-0.5 cursor-ns-resize select-none bg-gray-50/50 hover:bg-gray-100/80 transition-colors duration-150 border-t border-gray-100"
            >
              <div className="flex items-center gap-1">
                <div className="w-0.5 h-3 rounded-full bg-gray-300" />
                <div className="w-0.5 h-3 rounded-full bg-gray-300" />
                <div className="w-0.5 h-3 rounded-full bg-gray-300" />
              </div>
            </div>

            {/* Bottom action bar — output format + 分开 + 合并 */}
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 bg-gray-50/80 border-t border-gray-100">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-gray-500">{t('bilibili.outputType')}</span>
                <select
                  value={outputFormat}
                  onChange={(e) => setOutputFormat(e.target.value as OutputFormat)}
                  className="text-[11px] border border-gray-200/60 rounded-md px-1.5 py-0.5 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-[#00a1d6]/40"
                >
                  {OUTPUT_FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleDownload('separate')}
                  disabled={selected.size === 0 || isWorking}
                  className="px-2.5 py-1 text-[11px] rounded-md text-[#00a1d6] border border-[#00a1d6]/30 bg-white hover:bg-[#00a1d6] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-[#00a1d6] transition-all duration-150 btn-press flex items-center gap-1"
                  title="分开下载"
                >
                  <Download className="w-3 h-3" />
                  分开
                </button>
                <button
                  onClick={() => handleDownload('merged')}
                  disabled={selected.size === 0 || isWorking}
                  className="px-2.5 py-1 text-[11px] rounded-md text-[#00a1d6] border border-[#00a1d6]/30 bg-white hover:bg-[#00a1d6] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-[#00a1d6] transition-all duration-150 btn-press flex items-center gap-1"
                  title="合并下载"
                >
                  <Download className="w-3 h-3" />
                  合并
                </button>
              </div>
            </div>
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

      {/* Lock Overlay — shown during download/import */}
      {isLocked && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6 w-[280px] text-center space-y-4 animate-fade-in">
            <div className="w-12 h-12 mx-auto rounded-full bg-[#00a1d6]/10 flex items-center justify-center">
            <Download className="w-6 h-6 text-[#00a1d6]" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-800">正在导出字幕…</p>
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
