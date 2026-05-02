import { useState, useMemo, useEffect, useRef } from 'react';
import { Tv2, Loader2, CheckCircle, AlertCircle, PlayCircle, ChevronDown, Download, Upload, Cloud } from 'lucide-react';
import type { ImportProgress } from '@/lib/types';
import { t } from '@/lib/i18n';
import { isBilibiliUrl, parseBilibiliUrl } from '@/services/bilibili';
import type { BilibiliVideoItem, BilibiliSourceInfo } from '@/services/bilibili';

type State = 'idle' | 'loading' | 'loaded' | 'fetching' | 'downloading' | 'uploading' | 'importing' | 'done' | 'error';

const PAGE_SIZE = 100;

interface Props {
  initialUrl?: string;
  onProgress: (progress: ImportProgress | null) => void;
}

export function BilibiliImport({ initialUrl, onProgress }: Props) {
  const [url, setUrl] = useState(initialUrl || '');
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState('');
  const [source, setSource] = useState<BilibiliSourceInfo | null>(null);
  const [videos, setVideos] = useState<BilibiliVideoItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [doneMsg, setDoneMsg] = useState('');

  const displayedVideos = useMemo(() => videos.slice(0, displayCount), [videos, displayCount]);
  const canLoadMore = displayCount < videos.length;

  const videoKey = (v: BilibiliVideoItem) => `${v.bvid}-${v.page}`;

  const isValidBilibiliUrl = useMemo(() => isBilibiliUrl(url) && parseBilibiliUrl(url) !== null, [url]);

  const handleFetch = () => {
    if (!url) { setError(t('bilibili.enterLink')); setState('error'); return; }
    if (!isValidBilibiliUrl) { setError(t('bilibili.unrecognized')); setState('error'); return; }

    setState('loading');
    setError('');
    setSource(null);
    setVideos([]);
    setDoneMsg('');
    setDisplayCount(PAGE_SIZE);

    console.log('[popup] Sending FETCH_BILIBILI for:', url);
    chrome.runtime.sendMessage(
      { type: 'FETCH_BILIBILI', url },
      (resp) => {
        console.log('[popup] FETCH_BILIBILI response:', resp);
        if (resp?.success && resp.data) {
          const data = resp.data as { source: BilibiliSourceInfo; videos: BilibiliVideoItem[] };
          setSource(data.source);
          setVideos(data.videos);
          // Select all by default
          setSelected(new Set(data.videos.map(videoKey)));
          setDisplayCount(PAGE_SIZE);
          setState('loaded');
        } else {
          setState('error');
          setError(resp?.error || t('bilibili.fetchFailed'));
        }
      },
    );
  };

  // Auto-fetch when opened from a Bilibili tab
  const autoFetched = useRef(false);
  useEffect(() => {
    if (initialUrl && isBilibiliUrl(initialUrl) && !autoFetched.current) {
      autoFetched.current = true;
      handleFetch();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const getSelectedVideos = () => videos.filter(v => selected.has(videoKey(v)));

  const handleDownload = () => {
    const toProcess = getSelectedVideos();
    if (toProcess.length === 0) { setError(t('bilibili.selectAtLeastOne')); setState('error'); return; }

    setState('downloading');
    setError('');
    setDoneMsg('');

    chrome.runtime.sendMessage(
      { type: 'DOWNLOAD_BILIBILI_SUBTITLES', videos: toProcess, ownerName: source?.owner || '', desc: source?.desc || '' },
      (resp) => {
        if (resp?.success) {
          const { downloaded, skipped } = resp.data as { downloaded: number; skipped: number };
          setDoneMsg(skipped > 0
            ? `已下载 ${downloaded} 个字幕文件，${skipped} 个无字幕`
            : `已下载 ${downloaded} 个字幕文件`
          );
          setState('done');
        } else {
          setState('error');
          setError(resp?.error || t('bilibili.fetchFailed'));
        }
      },
    );
  };

  const handleDownloadMerged = () => {
    const toProcess = getSelectedVideos();
    if (toProcess.length === 0) { setError(t('bilibili.selectAtLeastOne')); setState('error'); return; }

    setState('downloading');
    setError('');
    setDoneMsg('');

    chrome.runtime.sendMessage(
      { type: 'DOWNLOAD_BILIBILI_MERGED', videos: toProcess, ownerName: source?.owner || '', desc: source?.desc || '', source: source },
      (resp) => {
        if (resp?.success) {
          setDoneMsg(`已合并下载 ${toProcess.length} 个视频内容`);
          setState('done');
        } else {
          setState('error');
          setError(resp?.error || t('bilibili.fetchFailed'));
        }
      },
    );
  };

  const handleDriveUpload = () => {
    const toProcess = getSelectedVideos();
    if (toProcess.length === 0) { setError(t('bilibili.selectAtLeastOne')); setState('error'); return; }

    setState('uploading');
    setError('');
    setDoneMsg('');

    chrome.runtime.sendMessage(
      { type: 'UPLOAD_BILIBILI_TO_DRIVE', videos: toProcess, ownerName: source?.owner || '', desc: source?.desc || '', source: source },
      (resp) => {
        if (resp?.success) {
          setDoneMsg(`已上传到 Google Drive（${resp.data?.fileName || 'Kapture_Notes'}），可在 NotebookLM 中通过 Drive 导入`);
          setState('done');
        } else {
          setState('error');
          setError(resp?.error || t('bilibili.driveUploadFailed'));
        }
      },
    );
  };

  const handleImport = () => {
    const toProcess = getSelectedVideos();
    if (toProcess.length === 0) { setError(t('bilibili.selectAtLeastOne')); setState('error'); return; }

    setState('importing');
    setError('');
    setDoneMsg('');

    const progress: ImportProgress = {
      total: toProcess.length,
      completed: 0,
      items: toProcess.map(v => ({ url: v.url, title: v.part || v.title, status: 'pending' })),
    };
    onProgress(progress);

    // If multiple videos, use MERGED import
    if (toProcess.length > 1) {
      chrome.runtime.sendMessage(
        { type: 'IMPORT_BILIBILI_MERGED', videos: toProcess, ownerName: source?.owner || '', desc: source?.desc || '', source: source },
        (resp) => {
          onProgress(null);
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
      // Single video import
      chrome.runtime.sendMessage(
        { type: 'IMPORT_BILIBILI_SUBTITLES', videos: toProcess, ownerName: source?.owner || '', desc: source?.desc || '' },
        (resp) => {
          onProgress(null);
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
    <div className="space-y-4">
      {/* Input */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
          <Tv2 className="w-4 h-4 text-[#00a1d6]" />
          {t('bilibili.link')}
        </label>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Tv2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !isWorking) handleFetch(); }}
              placeholder={t('bilibili.placeholder')}
              className="w-full pl-10 pr-3 py-2 border border-gray-200/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00a1d6]/40 focus:border-transparent placeholder:text-gray-400/70"
            />
          </div>
          <button
            onClick={handleFetch}
            disabled={!url || isWorking}
            className="px-4 py-1.5 bg-[#00a1d6] hover:bg-[#0090c0] text-white text-xs rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 shadow-btn hover:shadow-btn-hover transition-all duration-150 btn-press"
          >
            {state === 'loading' ? (
              <><Loader2 className="w-3 h-3 animate-spin" />{t('bilibili.querying')}</>
            ) : (
              <><Tv2 className="w-3 h-3" />{t('bilibili.query')}</>
            )}
          </button>
        </div>
      </div>

      {/* Source Info */}
      {source && (
        <div className="bg-sky-50 border border-sky-100/60 rounded-lg p-3 flex items-center gap-3 shadow-soft">
          <div className="w-10 h-10 rounded-lg bg-[#00a1d6]/10 flex items-center justify-center">
            <Tv2 className="w-5 h-5 text-[#00a1d6]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sky-900 truncate">{source.title}</p>
            <p className="text-xs text-sky-600">
              {source.owner && <span className="mr-2">UP主：{source.owner}</span>}
              {source.type === 'series' ? (
                <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-[10px] font-bold mr-2">合集</span>
              ) : source.isSeries ? (
                <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-bold mr-2">分P</span>
              ) : null}
              <span className="font-mono tabular-nums">{source.videoCount}</span> {source.isSeries ? t('bilibili.parts') : t('bilibili.singleVideo')}
            </p>
          </div>
        </div>
      )}

      {/* Parts List (multi-part video) */}
      {videos.length > 1 && (
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
          <div className="max-h-48 overflow-y-auto border border-border-strong rounded-lg shadow-soft">
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
          {/* Load More */}
          {canLoadMore && (
            <button
              onClick={() => setDisplayCount(c => Math.min(c + PAGE_SIZE, videos.length))}
              className="w-full mt-2 py-1.5 text-xs text-[#00a1d6] hover:text-[#0090c0] hover:bg-sky-50 border border-sky-200/60 rounded-lg flex items-center justify-center gap-1 transition-colors duration-150"
            >
              <ChevronDown className="w-3 h-3" />{t('bilibili.parts')} ({videos.length - displayCount} 更多)
            </button>
          )}
        </div>
      )}

      {/* Action Buttons */}
      {videos.length > 0 && (
        <div className="flex flex-col gap-2">
          {/* Hint */}
          <p className="text-xs text-gray-400 flex items-center gap-1">
            <AlertCircle className="w-3 h-3 flex-shrink-0" />
            {t('bilibili.noSubtitleHint')}
          </p>

          {/* Download Buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleDownload}
              disabled={selected.size === 0 || isWorking}
              className="flex-1 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-btn hover:shadow-btn-hover transition-all duration-150 btn-press"
            >
              {state === 'downloading' ? (
                <><Loader2 className="w-4 h-4 animate-spin" />{t('bilibili.fetchingSubtitles')}</>
              ) : state === 'done' && doneMsg ? (
                <><CheckCircle className="w-4 h-4" />{t('bilibili.downloadDone')}</>
              ) : videos.length === 1 ? (
                <><Download className="w-4 h-4" />{t('bilibili.downloadThis')}</>
              ) : (
                <><Download className="w-4 h-4" />{t('bilibili.downloadSubtitles', { count: selected.size })}</>
              )}
            </button>
            {videos.length > 1 && (
              <button
                onClick={handleDownloadMerged}
                disabled={selected.size === 0 || isWorking}
                title="合并下载 Markdown"
                className="px-3 py-2 bg-sky-100 hover:bg-sky-200 text-sky-700 text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all duration-150 btn-press"
              >
                <Download className="w-4 h-4" />
                合并
              </button>
            )}
          </div>

          {/* Upload to Google Drive Button */}
          <button
            onClick={handleDriveUpload}
            disabled={selected.size === 0 || isWorking}
            className="w-full py-2 bg-green-500 hover:bg-green-600 text-white text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-btn hover:shadow-btn-hover transition-all duration-150 btn-press"
          >
            {state === 'uploading' ? (
              <><Loader2 className="w-4 h-4 animate-spin" />{t('bilibili.uploadingToDrive')}</>
            ) : state === 'done' && doneMsg ? (
              <><CheckCircle className="w-4 h-4" />{t('bilibili.driveUploadDone')}</>
            ) : (
              <><Cloud className="w-4 h-4" />{t('bilibili.uploadToDrive', { count: selected.size })}</>
            )}
          </button>

          {/* Import to NotebookLM Button */}
          <button
            onClick={handleImport}
            disabled={selected.size === 0 || isWorking}
            className="w-full py-2 bg-[#00a1d6] hover:bg-[#0090c0] text-white text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-btn hover:shadow-btn-hover transition-all duration-150 btn-press"
          >
            {state === 'importing' ? (
              <><Loader2 className="w-4 h-4 animate-spin" />{t('bilibili.importing')}</>
            ) : state === 'done' ? (
              <><CheckCircle className="w-4 h-4" />{t('bilibili.importDone')}</>
            ) : videos.length === 1 ? (
              <><Upload className="w-4 h-4" />{t('bilibili.importThis')}</>
            ) : (
              <><Upload className="w-4 h-4" />{t('bilibili.importToNlm', { count: selected.size })}</>
            )}
          </button>
        </div>
      )}

      {/* Done Message */}
      {state === 'done' && doneMsg && (
        <div className="flex items-center gap-2 text-green-600 text-sm bg-green-50 border border-green-100/60 rounded-lg p-3">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {doneMsg}
        </div>
      )}

      {/* Single video quick action (when not multi-part) */}
      {videos.length === 1 && state === 'loaded' && (
        <div className="bg-sky-50 border border-sky-100/60 rounded-lg p-3 text-xs text-sky-700 space-y-0.5">
          <p className="font-medium">{videos[0].title}</p>
          <p className="text-sky-500">{videos[0].url}</p>
        </div>
      )}

      {/* Error */}
      {state === 'error' && (
        <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 border border-red-100/60 rounded-lg p-3 shadow-soft">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Help */}
      {!source && state === 'idle' && (
        <div className="text-xs text-gray-400 space-y-2 bg-surface-sunken rounded-xl p-3.5">
          <p>{t('bilibili.supportedFormats')}</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>{t('bilibili.formatVideo')}</li>
            <li>{t('bilibili.formatPart')}</li>
            <li>合集视频: bilibili.com/video/BVxxx (自动识别)</li>
          </ul>
          <p className="flex items-center gap-1 text-amber-500">
            <AlertCircle className="w-3 h-3 flex-shrink-0" />
            {t('bilibili.apiNote')}
          </p>
        </div>
      )}
    </div>
  );
}
