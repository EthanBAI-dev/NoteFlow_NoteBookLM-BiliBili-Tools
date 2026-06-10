import { useState, useMemo, useEffect, useRef } from 'react';
import { Headphones, Loader2, CheckCircle, AlertCircle, Download, Music, Radio } from 'lucide-react';
import type { PodcastInfo, PodcastEpisode } from '@/services/podcast';
import { t } from '@/lib/i18n';

type State = 'idle' | 'loading' | 'loaded' | 'downloading' | 'done' | 'error';
type Platform = 'unknown' | 'apple' | 'xiaoyuzhou';

function detectPlatform(url: string): Platform {
  if (/xiaoyuzhoufm\.com\/(episode|podcast)\//.test(url)) return 'xiaoyuzhou';
  if (/podcasts\.apple\.com\//.test(url)) return 'apple';
  return 'unknown';
}

const platformStyles = {
  apple: { color: 'purple', accent: 'bg-purple-500 hover:bg-purple-550', accentLight: 'bg-purple-50', textAccent: 'text-purple-600', textDark: 'text-purple-900', ring: 'focus:ring-purple-500', check: 'text-purple-500', border: 'border-purple-100/60' },
  xiaoyuzhou: { color: 'emerald', accent: 'bg-emerald-500 hover:bg-emerald-550', accentLight: 'bg-emerald-50', textAccent: 'text-emerald-600', textDark: 'text-emerald-900', ring: 'focus:ring-emerald-500', check: 'text-emerald-500', border: 'border-emerald-100/60' },
  unknown: { color: 'purple', accent: 'bg-purple-500 hover:bg-purple-550', accentLight: 'bg-purple-50', textAccent: 'text-purple-600', textDark: 'text-purple-900', ring: 'focus:ring-purple-500', check: 'text-purple-500', border: 'border-purple-100/60' },
};
const platformNames: Record<string, string> = {
  apple: 'Apple Podcasts',
  xiaoyuzhou: '小宇宙',
};
function getPlatformConfig(platform: string) {
  const styles = platformStyles[platform as keyof typeof platformStyles] || platformStyles.unknown;
  return { name: platformNames[platform] || t('app.tabPodcast'), ...styles };
}

interface Props {
  initialUrl?: string;
  fetchTrigger?: number;
  onProgress?: (progress: any) => void;
  onImportHandlerChange?: (handler: (() => void) | null) => void;
}

export function PodcastImport({ initialUrl, fetchTrigger }: Props) {
  const [url, setUrl] = useState(initialUrl || '');
  const [count, setCount] = useState<number | undefined>(undefined);
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState('');
  const [podcast, setPodcast] = useState<PodcastInfo | null>(null);
  const [episodes, setEpisodes] = useState<PodcastEpisode[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ current: number; total: number; title?: string }>({ current: 0, total: 0 });

  const platform = useMemo(() => detectPlatform(url), [url]);
  const theme = getPlatformConfig(platform);

  // Auto-fetch when initialUrl changes (tab switch / page nav)
  const lastAutoUrl = useRef<string | null>(null);
  useEffect(() => {
    if (!initialUrl) return;
    if (lastAutoUrl.current === initialUrl) return;
    lastAutoUrl.current = initialUrl;
    setUrl(initialUrl);
    setState('loading');
    setError('');
    setPodcast(null);
    setEpisodes([]);

    chrome.runtime.sendMessage(
      { type: 'FETCH_PODCAST', url: initialUrl, count },
      (resp) => {
        if (resp?.success && resp.data) {
          const data = resp.data as { podcast: PodcastInfo; episodes: PodcastEpisode[] };
          setPodcast(data.podcast);
          setEpisodes(data.episodes);
          setSelected(new Set(data.episodes.map((e) => e.id)));
          setState('loaded');
        } else {
          setState('error');
          setError(resp?.error || t('podcast.fetchFailed'));
        }
      },
    );
  }, [initialUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch on fetchTrigger (header refresh button)
  useEffect(() => {
    if (fetchTrigger && fetchTrigger > 0 && initialUrl) {
      lastAutoUrl.current = null;
      setUrl(initialUrl);
      setState('loading');
      setError('');
      setPodcast(null);
      setEpisodes([]);

      chrome.runtime.sendMessage(
        { type: 'FETCH_PODCAST', url: initialUrl, count },
        (resp) => {
          if (resp?.success && resp.data) {
            const data = resp.data as { podcast: PodcastInfo; episodes: PodcastEpisode[] };
            setPodcast(data.podcast);
            setEpisodes(data.episodes);
            setSelected(new Set(data.episodes.map((e) => e.id)));
            setState('loaded');
          } else {
            setState('error');
            setError(resp?.error || t('podcast.fetchFailed'));
          }
        },
      );
    }
  }, [fetchTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDownload = () => {
    const toDownload = episodes.filter((e) => selected.has(e.id));
    if (toDownload.length === 0) { setError(t('podcast.selectAtLeastOne')); setState('error'); return; }

    setState('downloading');
    setProgress({ current: 0, total: toDownload.length });

    const port = chrome.runtime.connect({ name: 'podcast-download' });
    port.postMessage({
      type: 'DOWNLOAD_PODCAST',
      podcast,
      episodes: toDownload,
    });

    port.onMessage.addListener((msg) => {
      if (msg.phase === 'downloading') {
        setProgress({ current: msg.current, total: msg.total, title: msg.title });
      } else if (msg.phase === 'done') {
        setState('done');
        port.disconnect();
      } else if (msg.phase === 'error') {
        setState('error');
        setError(msg.error || t('podcast.downloadFailed'));
        port.disconnect();
      }
    });

    port.onDisconnect.addListener(() => {
      if (state === 'downloading') setState('done');
    });
  };

  const toggleEpisode = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(episodes.map((e) => e.id)));
  const selectNone = () => setSelected(new Set());

  return (
    <div className="space-y-4">
      {/* Podcast Info */}
      {podcast && (
        <div className={`${theme.accentLight} border ${theme.border} rounded-lg p-3 flex items-center gap-3 shadow-soft`}>
          {podcast.artworkUrl && (
            <img src={podcast.artworkUrl} alt="" className="w-12 h-12 rounded-lg object-cover" />
          )}
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium ${theme.textDark} truncate`}>{podcast.name}</p>
            <p className={`text-xs ${theme.textAccent}`}>
              {podcast.artist}{podcast.artist && ' · '}<span className="font-mono tabular-nums">{episodes.length}</span> {t('podcast.episodes')}
              <span className="text-gray-400 ml-1">via {theme.name}</span>
            </p>
          </div>
        </div>
      )}

      {/* Episode List */}
      {episodes.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">
              {t('podcast.selectedEpisodes', { selected: selected.size, total: episodes.length })}
            </span>
            <div className="flex gap-2 text-xs">
              <button onClick={selectAll} className="text-notebooklm-blue hover:underline">{t('selectAll')}</button>
              <button onClick={selectNone} className="text-gray-400 hover:underline">{t('deselectAll')}</button>
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto border border-border-strong rounded-lg shadow-soft">
            {episodes.map((ep) => (
              <label
                key={ep.id}
                className="flex items-start gap-3 p-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0 transition-colors duration-150"
              >
                <input
                  type="checkbox"
                  checked={selected.has(ep.id)}
                  onChange={() => toggleEpisode(ep.id)}
                  className={`mt-1 rounded border-gray-300 ${theme.check} ${theme.ring}`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700 line-clamp-1">{ep.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {ep.releaseDate} {ep.durationMinutes > 0 && `· ${ep.durationMinutes} ${t('podcast.minutes')}`}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Download Button */}
      {episodes.length > 0 && (
        <button
          onClick={handleDownload}
          disabled={selected.size === 0 || state === 'downloading'}
          className={`w-full py-2.5 ${theme.accent} text-white text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-btn hover:shadow-btn-hover transition-all duration-150 btn-press`}
        >
          {state === 'downloading' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('podcast.downloading', { current: progress.current, total: progress.total })}
              {progress.title && <span className="text-white/60 text-xs truncate max-w-[150px]">· {progress.title}</span>}
            </>
          ) : state === 'done' ? (
            <>
              <CheckCircle className="w-4 h-4" />
              {t('podcast.downloadDone')}
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              {t('podcast.downloadSelected', { count: selected.size })}
            </>
          )}
        </button>
      )}

      {/* Error */}
      {state === 'error' && (
        <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 border border-red-100/60 rounded-lg p-3 shadow-soft">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

    </div>
  );
}
