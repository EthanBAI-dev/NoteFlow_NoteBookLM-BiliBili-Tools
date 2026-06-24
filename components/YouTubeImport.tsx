import { useState, useMemo, useEffect, useRef } from 'react';
import { Youtube, Loader2, AlertCircle, PlayCircle, ListVideo, User } from 'lucide-react';
import type { ImportProgress, YouTubeResult, YouTubeVideoItem, YouTubeSourceInfo } from '@/lib/types';
import { t } from '@/lib/i18n';
import { isYouTubeUrl, parseYouTubeUrl } from '@/services/youtube';
import { SourceInfoCard, SourceInfoCardSkeleton } from './SourceInfoCard';

type State = 'idle' | 'loading' | 'loaded' | 'importing' | 'done' | 'error';

const PAGE_SIZE = 15;

const sourceIcons = {
  video: PlayCircle,
  playlist: ListVideo,
  channel: User,
};

interface Props {
  initialUrl?: string;
  onProgress: (progress: ImportProgress | null) => void;
  fetchTrigger?: number;
  onImportHandlerChange?: (handler: (() => void) | null) => void;
  /** Pre-fetched result from background (via content script → YT_URL_CHANGED) */
  prefetchedResult?: YouTubeResult | null;
}

export function YouTubeImport({ initialUrl, onProgress, fetchTrigger, onImportHandlerChange, prefetchedResult }: Props) {
  const [url, setUrl] = useState(initialUrl || '');
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState('');
  const [source, setSource] = useState<YouTubeSourceInfo | null>(null);
  const [videos, setVideos] = useState<YouTubeVideoItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<{ success: number; failed: number } | null>(null);
  const [continuation, setContinuation] = useState<string | undefined>();
  const [subtitleStatus, setSubtitleStatus] = useState<'available' | 'unavailable' | 'checking' | undefined>(undefined);

  // ── Fetch deduplication & lifecycle guard ──
  const fetchGenRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const displayedVideos = useMemo(() => videos, [videos]);

  const urlType = useMemo(() => {
    if (!url || !isYouTubeUrl(url)) return 'unknown';
    return parseYouTubeUrl(url).type;
  }, [url]);

  const SourceIcon = sourceIcons[urlType as keyof typeof sourceIcons] || Youtube;

  const handleFetch = (targetUrl?: string) => {
    const fetchUrl = targetUrl || url;
    if (!fetchUrl) { setError(t('youtube.enterLink')); setState('error'); setSource(null); return; }
    if (!isYouTubeUrl(fetchUrl)) { setError(t('youtube.unrecognized')); setState('error'); setSource(null); return; }
    const parsed = parseYouTubeUrl(fetchUrl);
    if (parsed.type === 'unknown') {
      // YouTube URL but not a video/playlist/channel page (e.g. homepage, search, trending)
      setError(`无法识别页面类型: ${fetchUrl}\n目前支持视频、播放列表和频道链接。`);
      setState('error');
      setSource(null);
      setVideos([]);
      setSelected(new Set());
      setContinuation(undefined);
      setSubtitleStatus(undefined);
      return;
    }

    const gen = ++fetchGenRef.current;
    setState('loading');
    setError('');
    setSource(null);
    setVideos([]);
    setResults(null);
    setContinuation(undefined);

    chrome.runtime.sendMessage(
      { type: 'FETCH_YOUTUBE', url: fetchUrl },
      (resp) => {
        if (!mountedRef.current || fetchGenRef.current !== gen) return; // stale
        if (resp?.success && resp.data) {
          const data = resp.data as YouTubeResult;
          setSource(data.source);
          setVideos(data.videos);
          setSelected(new Set(data.videos.slice(0, PAGE_SIZE).map((v) => v.id)));
          setContinuation(data.continuation);
          setState('loaded');
        } else {
          setState('error');
          setError(resp?.error || t('youtube.fetchFailed'));
        }
      },
    );
  };

  // Auto-fetch when opened from a YouTube tab (initialUrl provided)
  const lastAutoUrl = useRef<string | null>(null);
  const prefetchedHandledRef = useRef(false);
  useEffect(() => {
    if (initialUrl && isYouTubeUrl(initialUrl) && lastAutoUrl.current !== initialUrl) {
      // If background already pre-fetched data for this URL, skip auto-fetch
      if (prefetchedHandledRef.current) {
        prefetchedHandledRef.current = false;
        return;
      }
      lastAutoUrl.current = initialUrl;
      setUrl(initialUrl);
      // Pass initialUrl explicitly — avoids stale closure on url state
      handleFetch(initialUrl);
    }
  }, [initialUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Force re-fetch when user clicks "读取当前网页"
  useEffect(() => {
    if (fetchTrigger && fetchTrigger > 0 && initialUrl && isYouTubeUrl(initialUrl)) {
      lastAutoUrl.current = null;
      setUrl(initialUrl);
      handleFetch(initialUrl);
    }
  }, [fetchTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Apply pre-fetched result from background (content script → YT_URL_CHANGED flow) ──
  useEffect(() => {
    if (!prefetchedResult || !initialUrl) return;
    if (!isYouTubeUrl(initialUrl)) return;

    // Mark as handled so the auto-fetch effect skips
    prefetchedHandledRef.current = true;

    const data = prefetchedResult;
    setUrl(initialUrl);
    setSource(data.source);
    setVideos(data.videos);
    setSelected(new Set(data.videos.slice(0, PAGE_SIZE).map((v) => v.id)));
    setContinuation(data.continuation);
    setState('loaded');
  }, [prefetchedResult]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleImport = async () => {
    const toImport = videos.filter((v) => selected.has(v.id));
    if (toImport.length === 0) { setError(t('youtube.selectAtLeastOne')); setState('error'); return; }

    setState('importing');
    const urls = toImport.map((v) => v.url);

    let successCount = 0;
    let failedCount = 0;

    onProgress({
      total: urls.length,
      completed: 0,
      current: { url: urls[0], status: 'pending' },
      items: urls.map((u) => ({ url: u, status: 'pending' })),
    });

    for (let i = 0; i < urls.length; i++) {
      try {
        const resp: any = await chrome.runtime.sendMessage({ type: 'IMPORT_URL', url: urls[i] });
        if (resp?.success) {
          successCount++;
        } else {
          failedCount++;
        }
      } catch (err) {
        failedCount++;
      }

      onProgress({
        total: urls.length,
        completed: successCount + failedCount,
        current: i + 1 < urls.length ? { url: urls[i + 1], status: 'pending' } : undefined,
        items: urls.map((u) => ({ url: u, status: 'pending' })),
      });
    }

    onProgress(null);
    setResults({ success: successCount, failed: failedCount });
    setState('done');
  };

  // Register import handler for unified button
  useEffect(() => {
    onImportHandlerChange?.(selected.size > 0 && subtitleStatus !== 'unavailable' ? handleImport : null);
    return () => onImportHandlerChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onImportHandlerChange, handleImport, selected.size, subtitleStatus]);

  // ── YouTube Subtitle Detection ──
  useEffect(() => {
    if (state !== 'loaded' || !initialUrl) {
      setSubtitleStatus(undefined);
      return;
    }

    // Only detect for single video pages (/watch)
    if (!initialUrl.includes('/watch')) return;

    // Extract video ID from URL
    const videoId = new URL(initialUrl).searchParams.get('v');
    if (!videoId) {
      setSubtitleStatus('unavailable');
      return;
    }

    const gen = ++fetchGenRef.current;
    setSubtitleStatus('checking');

    chrome.runtime.sendMessage(
      { type: 'DETECT_YOUTUBE_SUBTITLES', videoId },
      (response: any) => {
        if (!mountedRef.current || fetchGenRef.current !== gen) return; // stale
        if (response?.data?.available) {
          setSubtitleStatus('available');
        } else {
          setSubtitleStatus('unavailable');
        }
      },
    );

    return () => { fetchGenRef.current = gen + 1; }; // invalidate pending on cleanup
  }, [state, initialUrl]);

  const toggleVideo = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(displayedVideos.map((v) => v.id)));
  const selectNone = () => setSelected(new Set());

  return (
    <div className="space-y-4">
      {/* Skeleton loader — shown while fetching data */}
      {state === 'loading' && <SourceInfoCardSkeleton platform="youtube" />}

      {/* Source Info — using SourceInfoCard with subtitle detection */}
      {source && (
        <SourceInfoCard
          platform="youtube"
          title={source.title}
          favicon="https://www.youtube.com/favicon.ico"
          subtitle={`${displayedVideos.length} ${t('youtube.videos')}`}
          subtitleStatus={subtitleStatus}
        />
      )}

      {/* Video List (playlist/channel) */}
      {displayedVideos.length > 1 && (
        <div>
          <label className="text-[11px] font-medium text-gray-500 tracking-wide">视频列表</label>
          <div className="mt-1.5 border border-border-strong rounded-lg shadow-soft overflow-hidden">
            {/* Top bar — inside the border */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50/80 border-b border-gray-100">
              <span className="text-xs text-gray-600">
                {t('youtube.selectedVideos', { selected: selected.size, total: displayedVideos.length })}
              </span>
              <div className="flex gap-2 text-xs">
                <button onClick={selectAll} className="text-red-500 hover:underline">{t('selectAll')}</button>
                <button onClick={selectNone} className="text-gray-400 hover:underline">{t('deselectAll')}</button>
              </div>
            </div>
            <div className="max-h-48 overflow-y-auto">
              {displayedVideos.map((video) => (
                <label
                  key={video.id}
                  className="flex items-start gap-3 p-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0 transition-colors duration-150"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(video.id)}
                    onChange={() => toggleVideo(video.id)}
                    className="mt-1 rounded border-gray-300 text-red-500 focus:ring-red-500"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 line-clamp-1">{video.title}</p>
                    {video.publishedAt && (
                      <p className="text-xs text-gray-400 mt-0.5">{video.publishedAt}</p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {results && (
        <div className="text-sm text-center">
          {results.failed === 0 ? (
            <span className="text-green-600">{t('successCount', { success: results.success })}</span>
          ) : (
            <span className="text-amber-600">{t('successFailCount', { success: results.success, failed: results.failed })}</span>
          )}
        </div>
      )}

      {/* Error — show SourceInfoCard with no-content badge for recognized YouTube URLs */}
      {state === 'error' && (
        url && isYouTubeUrl(url) ? (
          <SourceInfoCard
            platform="youtube"
            title="YouTube"
            favicon="https://www.youtube.com/favicon.ico"
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
