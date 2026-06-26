/**
 * Bilibili service.
 * Extracts subtitles from Bilibili videos and series (合集/分P)
 * for download as Markdown files or direct import into NotebookLM.
 *
 * Subtitle fetching uses FlowToLM's proven approach:
 *   view API (bvid → aid + cid) → WBI API (aid + cid → subtitle tracks) → download subtitle JSON
 *
 * All requests use credentials: 'include' for authenticated access.
 */

import type { BilibiliVideoItem } from '@/lib/types';
export type { BilibiliVideoItem };

export interface BilibiliSourceInfo {
  bvid: string;
  title: string;
  owner: string;
  desc: string;
  videoCount: number;
  isSeries: boolean;
  type: 'video' | 'series' | 'season';
}

export interface BilibiliResult {
  source: BilibiliSourceInfo;
  videos: BilibiliVideoItem[];
}

export interface BilibiliSubtitleBody {
  from: number;
  to: number;
  content: string;
}

// ── URL Parsing ──

export function isBilibiliUrl(url: string): boolean {
  return /bilibili\.com\/video\//.test(url);
}

export function parseBilibiliUrl(url: string): { bvid: string; page: number } | null {
  try {
    const urlObj = new URL(url);
    const pathMatch = urlObj.pathname.match(/\/video\/(BV[a-zA-Z0-9]+|av\d+)/i);
    if (!pathMatch) return null;
    const bvid = pathMatch[1];
    const page = parseInt(urlObj.searchParams.get('p') || '1', 10);
    return { bvid, page };
  } catch {
    return null;
  }
}

export function isBilibiliSpaceUrl(url: string): boolean {
  return /space\.bilibili\.com\/\d+/.test(url);
}

export function parseBilibiliSpaceUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const match = urlObj.pathname.match(/\/(\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ── Favorite / Collection List Parsing ──

export function isBilibiliFavUrl(url: string): boolean {
  return /bilibili\.com\/(list\/(watchlater|fav|ml)|medialist\/play\/ml)/.test(url);
}

export function parseBilibiliFavUrl(url: string): { type: 'watchlater' | 'fav' | 'ml'; id: string | null } | null {
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname;

    // /list/watchlater
    if (/\/list\/watchlater/.test(path)) {
      return { type: 'watchlater', id: null };
    }

    // /list/fav/{id} or /list/ml/{id}
    const favMatch = path.match(/\/list\/(fav|ml)\/(\d+)/);
    if (favMatch) {
      return { type: favMatch[1] as 'fav' | 'ml', id: favMatch[2] };
    }

    // /medialist/play/ml{id}
    const mlPlayMatch = path.match(/\/medialist\/play\/ml(\d+)/);
    if (mlPlayMatch) {
      return { type: 'ml', id: mlPlayMatch[1] };
    }

    return null;
  } catch {
    return null;
  }
}

// ── API Helpers ──

const BILIBILI_HEADERS = {
  'Referer': 'https://www.bilibili.com',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

async function apiFetch(url: string): Promise<unknown> {
  const resp = await fetch(url, {
    credentials: 'include',
    headers: BILIBILI_HEADERS,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  const json = await resp.json() as { code: number; message?: string; data: unknown };
  if (json.code !== 0) {
    throw new Error(`Bilibili API error ${json.code}: ${json.message || 'Unknown error'}`);
  }
  return json.data;
}

// ── Fetch Video Info ──

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function fetchBilibiliVideo(bvid: string): Promise<BilibiliResult> {
  const data = await apiFetch(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`) as any;

  const mainTitle: string = data?.title || bvid;
  const owner: string = data?.owner?.name || '';
  const desc: string = data?.desc || '';
  const aid: number | undefined = data?.aid;
  const pages: any[] = data?.pages || [];

  if (pages.length > 1) {
    const videos: BilibiliVideoItem[] = pages.map((p: any) => ({
      bvid,
      cid: p.cid,
      aid,
      title: mainTitle,
      part: p.part || `P${p.page}`,
      page: p.page,
      url: `https://www.bilibili.com/video/${bvid}?p=${p.page}`,
      duration: p.duration,
    }));

    return {
      source: {
        bvid,
        title: mainTitle,
        owner,
        desc,
        videoCount: videos.length,
        isSeries: true,
        type: 'video',
      },
      videos,
    };
  }

  if (data?.ugc_season && data.ugc_season.sections) {
    const sections = data.ugc_season.sections;
    const allVideos: BilibiliVideoItem[] = [];
    let pageNum = 1;

    for (const section of sections) {
      if (!section?.archives || !Array.isArray(section.archives)) continue;
      for (const archive of section.archives) {
        allVideos.push({
          bvid: archive.bvid,
          cid: archive.cid,
          title: archive.title || mainTitle,
          part: undefined,
          page: pageNum++,
          url: `https://www.bilibili.com/video/${archive.bvid}`,
          duration: archive.duration,
        });
      }
    }

    if (allVideos.length > 0) {
      return {
        source: {
          bvid,
          title: data.ugc_season.title || mainTitle,
          owner,
          desc,
          videoCount: allVideos.length,
          isSeries: true,
          type: 'series',
        },
        videos: allVideos,
      };
    }
  }

  const singleVideo: BilibiliVideoItem[] = [{
    bvid,
    cid: data.cid || (pages[0]?.cid),
    aid,
    title: mainTitle,
    page: 1,
    url: `https://www.bilibili.com/video/${bvid}`,
    duration: data.duration,
  }];

  return {
    source: {
      bvid,
      title: mainTitle,
      owner,
      desc,
      videoCount: 1,
      isSeries: false,
      type: 'video',
    },
    videos: singleVideo,
  };
}

// ── Fetch UP主主页 Videos ──

export interface BilibiliSpaceResult {
  source: BilibiliSourceInfo;
  videos: BilibiliVideoItem[];
}

export async function fetchBilibiliUserVideos(mid: string): Promise<BilibiliSpaceResult> {
  const allVideos: BilibiliVideoItem[] = [];
  let pageNum = 1;
  const ps = 50;

  // Fetch user info
  const infoData = await apiFetch(`https://api.bilibili.com/x/space/wbi/acc/info?mid=${mid}`) as any;
  const owner = infoData?.name || '';
  const title = `${owner} 的视频列表`;

  // Fetch video list (paginate up to 200 videos)
  let hasMore = true;
  while (hasMore && allVideos.length < 200) {
    const listData = await apiFetch(
      `https://api.bilibili.com/x/space/wbi/arc/search?mid=${mid}&ps=${ps}&pn=${pageNum}`
    ) as any;

    const vlist = listData?.list?.vlist || [];
    for (const v of vlist) {
      allVideos.push({
        bvid: v.bvid,
        cid: 0, // Will be resolved later during subtitle fetch
        title: v.title,
        page: pageNum,
        url: `https://www.bilibili.com/video/${v.bvid}`,
        duration: v.length ? parseInt(v.length, 10) : undefined,
      });
    }

    const total = listData?.page?.count || 0;
    hasMore = allVideos.length < total && vlist.length > 0;
    pageNum++;
  }

  return {
    source: {
      bvid: mid,
      title,
      owner,
      desc: '',
      videoCount: allVideos.length,
      isSeries: true,
      type: 'series',
    },
    videos: allVideos,
  };
}

// ── Fetch Favorite / Collection List Videos ──

export interface BilibiliFavListResult {
  source: BilibiliSourceInfo;
  videos: BilibiliVideoItem[];
}

/**
 * Fetch videos from a Bilibili favorite/collection list.
 * Supports: watch later, favorite folders (/list/fav/{media_id}), media lists (/list/ml/{id}).
 */
export async function fetchBilibiliFavoriteList(url: string): Promise<BilibiliFavListResult> {
  const parsed = parseBilibiliFavUrl(url);
  if (!parsed) throw new Error('无法解析的收藏夹链接');

  const { type } = parsed;
  let title = '';
  let owner = '';
  const allVideos: BilibiliVideoItem[] = [];

  if (type === 'watchlater') {
    // 稍后再看: no pagination needed, returns all items
    const data = await apiFetch('https://api.bilibili.com/x/v2/history/toview') as any;
    title = '稍后再看';
    const list: any[] = data?.list || data?.data?.list || [];
    let page = 1;
    for (const v of list) {
      allVideos.push({
        bvid: v.bvid,
        cid: v.cid || 0,
        aid: v.aid,
        title: v.title || '',
        part: undefined,
        page: page++,
        url: `https://www.bilibili.com/video/${v.bvid}`,
        duration: v.duration,
      });
      if (!owner && v.owner?.name) owner = v.owner.name;
    }
  } else {
    // Fav folder or media list: use medialist resource/list API
    const bizId = parsed.id;
    if (!bizId) throw new Error('无法解析的收藏夹 ID');

    let ps = 20;
    let pn = 1;
    let hasMore = true;
    let infoTitle = '';
    let infoOwner = '';

    while (hasMore && allVideos.length < 200) {
      const data = await apiFetch(
        `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${bizId}&ps=${ps}&pn=${pn}&platform=web`
      ) as any;

      if (!infoTitle) {
        infoTitle = data?.info?.title || type === 'ml' ? '媒体列表' : '收藏夹';
        infoOwner = data?.info?.upper?.name || '';
      }

      const medias: any[] = data?.medias || [];
      for (const m of medias) {
        allVideos.push({
          bvid: m.bvid,
          cid: 0, // Resolved later
          aid: m.aid,
          title: m.title || m.name || '',
          part: undefined,
          page: m.page || allVideos.length + 1,
          url: `https://www.bilibili.com/video/${m.bvid}`,
          duration: m.duration,
        });
      }

      hasMore = data?.has_more === true && medias.length > 0;
      pn++;
    }

    title = infoTitle;
    owner = infoOwner;
  }

  return {
    source: {
      bvid: parsed.id || type,
      title,
      owner,
      desc: '',
      videoCount: allVideos.length,
      isSeries: true,
      type: 'series',
    },
    videos: allVideos,
  };
}

// ── Fetch Subtitles (FlowToLM approach) ──

interface SubtitleTrack {
  lan: string;
  lan_doc: string;
  subtitle_url: string;
}

function pickBestSubtitle(subtitles: SubtitleTrack[]): SubtitleTrack | null {
  if (subtitles.length === 0) return null;
  const zhCN = subtitles.find(t => t.lan === 'zh-CN' || t.lan === 'zh-Hans');
  if (zhCN) return zhCN;
  const anyZh = subtitles.find(t => t.lan.startsWith('zh') || t.lan_doc.includes('中'));
  if (anyZh) return anyZh;
  return subtitles[0];
}

// ── Format Subtitle as Markdown ──

export function smartMergeSubtitles(subtitles: BilibiliSubtitleBody[]): string {
  let finalArticle = '';
  let currentParagraph = '';
  let lastContent = '';

  for (let i = 0; i < subtitles.length; i++) {
    const current = subtitles[i];
    const next = subtitles[i + 1];

    let text = current.content?.trim() || '';
    if (!text) continue;

    if (text.length <= 1 && /^[\s，。！？、；：""''（）【】《》\.!\?,;:()\[\]{}'"\s-]+$/.test(text)) continue;

    if (text === lastContent) continue;
    lastContent = text;

    currentParagraph += text;

    if (next) {
      const timeGap = next.from - current.to;
      if (timeGap > 0.6) {
        finalArticle += currentParagraph.replace(/[，。！？、；：]+$/g, '') + '。\n\n';
        currentParagraph = '';
      } else {
        currentParagraph += '，';
      }
    } else {
      finalArticle += currentParagraph.replace(/[，。！？、；：]+$/g, '') + '。';
    }
  }

  return finalArticle;
}

export function buildSubtitleMarkdown(
  title: string,
  videoUrl: string,
  part: string | undefined,
  owner: string,
  desc: string,
  subtitleBody: BilibiliSubtitleBody[],
  stripTimestamps: boolean = true,
): string {
  const displayTitle = part ? `${title} - ${part}` : title;
  const mergedText = stripTimestamps
    ? smartMergeSubtitles(subtitleBody)
    : buildSubtitleWithTimestamps(subtitleBody);
  const estimatedWords = Math.round(mergedText.length * 0.7);
  const cleanDesc = desc?.trim() || '暂无简介';

  const lines: string[] = [
    `# 视频标题：[Bilibili] ${displayTitle}`,
    '',
    `- **UP主：** ${owner || '未知'}`,
    `- **链接：** ${videoUrl}`,
    `- **简介：** ${cleanDesc}`,
    `字数：${estimatedWords.toLocaleString()} 字`,
    '',
    '---',
    '',
    '## 视频正文',
    '',
    mergedText,
  ];

  return lines.join('\n');
}

// ── Format converters ──

type SubtitleFormat = 'md' | 'txt' | 'json' | 'srt';

export function convertSubtitleOutput(
  format: SubtitleFormat,
  markdown: string,
  rawBody?: BilibiliSubtitleBody[],
  stripTimestamps: boolean = true,
): { content: string; ext: string; mime: string } {
  switch (format) {
    case 'txt':
      return {
        content: rawBody
          ? buildSubtitlePlainText(rawBody, stripTimestamps)
          : markdown.replace(/^# .+\n\n?/gm, '').replace(/\*\*/g, '').replace(/\n{3,}/g, '\n\n').trim(),
        ext: '.txt',
        mime: 'text/plain',
      };
    case 'json':
      return {
        content: rawBody ? buildSubtitleJson(rawBody) : JSON.stringify({ text: markdown }),
        ext: '.json',
        mime: 'application/json',
      };
    case 'srt':
      return {
        content: rawBody ? buildSubtitleSrt(rawBody) : markdown,
        ext: '.srt',
        mime: 'text/plain',
      };
    default:
      return { content: markdown, ext: '.md', mime: 'text/markdown' };
  }
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function buildSubtitleSrt(
  subtitleBody: BilibiliSubtitleBody[],
): string {
  return subtitleBody.map((body, i) => {
    const from = formatTimestamp(body.from);
    const to = formatTimestamp(body.to);
    const text = body.content.replace(/<[^>]+>/g, '').trim();
    return `${i + 1}\n${from} --> ${to}\n${text}\n`;
  }).join('\n');
}

export function buildSubtitleJson(
  subtitleBody: BilibiliSubtitleBody[],
): string {
  return JSON.stringify(subtitleBody.map((b, i) => ({
    index: i + 1,
    from: b.from,
    to: b.to,
    content: b.content.replace(/<[^>]+>/g, '').trim(),
  })), null, 2);
}

/**
 * Build plain subtitle text with timestamp markers preserved.
 * Format: [MM:SS,mmm] content
 */
export function buildSubtitleWithTimestamps(
  subtitleBody: BilibiliSubtitleBody[],
): string {
  return subtitleBody
    .map(b => {
      const ts = formatTimestamp(b.from);
      const text = b.content.replace(/<[^>]+>/g, '').trim();
      if (!text) return '';
      return `[${ts}] ${text}`;
    })
    .filter(Boolean)
    .join('\n');
}

export function buildSubtitlePlainText(
  subtitleBody: BilibiliSubtitleBody[],
  stripTimestamps: boolean = true,
): string {
  if (stripTimestamps) {
    return subtitleBody.map(b => b.content.replace(/<[^>]+>/g, '').trim()).join('\n');
  }
  return buildSubtitleWithTimestamps(subtitleBody);
}

export function mergeBilibiliSubtitles(
  results: { video: BilibiliVideoItem; markdown: string | null }[],
  source: BilibiliSourceInfo,
): string {
  const validResults = results.filter(r => r.markdown !== null);

  let totalChars = 0;
  const chapterLines: string[] = [];

  for (const res of validResults) {
    const videoTitle = res.video.part
      ? `P${res.video.page} ${res.video.part}`
      : `P${res.video.page} ${res.video.title}`;
    chapterLines.push('', '---', '');
    chapterLines.push(`## ${videoTitle}`);
    chapterLines.push('');

    const bodyMatch = res.markdown?.match(/## 视频正文\n\n([\s\S]+)/);
    if (bodyMatch) {
      const body = bodyMatch[1].trim();
      totalChars += body.length;
      chapterLines.push(body);
    } else {
      chapterLines.push(res.markdown || '');
      totalChars += (res.markdown || '').length;
    }
  }

  const estimatedWords = Math.round(totalChars * 0.7);

  const lines: string[] = [
    `# 字幕 提取：${source.title}（共 ${validResults.length} 集）`,
    '',
    `- **UP主：** ${source.owner || '未知'}`,
    `- **简介：** ${source.desc?.trim() || '暂无简介'}`,
    `字数：${estimatedWords.toLocaleString()} 字`,
    ...chapterLines,
    '',
    '---',
    '',
    `总字数：${estimatedWords.toLocaleString()} 字`,
  ];

  return lines.join('\n');
}

// ── Main Subtitle Fetch (FlowToLM approach) ──

export interface SubtitleFetchResult {
  video: BilibiliVideoItem;
  markdown: string | null;
  error: string | null;
  lan_doc?: string;
  rawBody?: BilibiliSubtitleBody[];
}

/**
 * Fetch subtitle for one video.
 *
 * FlowToLM's proven pipeline:
 *   1. view API → get aid + cid (with credentials)
 *   2. WBI API → get subtitle tracks (with credentials)
 *   3. Download subtitle JSON (simple fetch)
 *   4. Build Markdown
 */
export async function fetchVideoSubtitle(
  video: BilibiliVideoItem,
  ownerName: string,
  desc: string,
  stripTimestamps: boolean = true,
): Promise<SubtitleFetchResult> {
  let { bvid, cid, aid } = video;

  try {
    // Step 1: Ensure we have aid + cid (via view API)
    if (!aid || !cid) {
      console.log(`[Bilibili] Fetching view info for ${bvid}...`);
      const viewUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
      const viewRes = await fetch(viewUrl, {
        credentials: 'include',
        headers: { 'Referer': 'https://www.bilibili.com' },
      });
      if (!viewRes.ok) throw new Error(`View API HTTP ${viewRes.status}`);
      const viewData = await viewRes.json();
      if (viewData.code !== 0 || !viewData.data) {
        throw new Error(`View API error: ${viewData.message || 'Unknown'}`);
      }
      if (!cid) cid = viewData.data.cid;
      if (!aid) aid = viewData.data.aid;
      if (!aid || !cid) throw new Error(`无法获取 ${bvid} 的 aid/cid`);
    }

    console.log(`[Bilibili] WBI: aid=${aid}, cid=${cid}`);

    // Step 2: Get subtitle tracks via WBI API
    const wbiUrl = `https://api.bilibili.com/x/player/wbi/v2?aid=${aid}&cid=${cid}`;
    const wbiRes = await fetch(wbiUrl, {
      credentials: 'include',
      headers: { 'Referer': 'https://www.bilibili.com' },
    });
    if (!wbiRes.ok) throw new Error(`WBI API HTTP ${wbiRes.status}`);
    const wbiData = await wbiRes.json();

    const subtitles: SubtitleTrack[] = (wbiData?.data?.subtitle?.subtitles || [])
      .filter((s: any) => s.subtitle_url)
      .map((s: any) => ({
        lan: s.lan || '',
        lan_doc: s.lan_doc || s.lan || '',
        subtitle_url: s.subtitle_url || '',
      }));

    const track = pickBestSubtitle(subtitles);
    if (!track) {
      return { video: { ...video, cid, aid }, markdown: null, error: 'no_subtitle' };
    }

    console.log(`[Bilibili] Selected: ${track.lan_doc} (${track.lan}), ${subtitles.length} tracks total`);

    // Step 3: Download subtitle JSON
    let subtitleUrl = track.subtitle_url;
    if (subtitleUrl.startsWith('//')) subtitleUrl = `https:${subtitleUrl}`;
    else if (subtitleUrl.startsWith('http://')) subtitleUrl = subtitleUrl.replace('http://', 'https://');

    const subRes = await fetch(subtitleUrl);
    if (!subRes.ok) throw new Error(`Subtitle download HTTP ${subRes.status}`);

    const subJson = await subRes.json();
    const bodies: BilibiliSubtitleBody[] = subJson.body || [];
    if (bodies.length === 0) {
      return { video: { ...video, cid, aid }, markdown: null, error: 'empty_subtitle' };
    }

    // Step 4: Build Markdown
    const markdown = buildSubtitleMarkdown(
      video.title,
      video.url,
      video.part,
      ownerName,
      desc,
      bodies,
      stripTimestamps,
    );

    return {
      video: { ...video, cid, aid },
      markdown,
      error: null,
      lan_doc: track.lan_doc,
      rawBody: bodies,
    };
  } catch (err) {
    console.error(`[Bilibili] 提取字幕异常 bvid=${bvid} cid=${cid}`, err);
    return {
      video,
      markdown: null,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Strip SRT-style timestamp markers and numbering from subtitle text.
 * Handles formats like:
 *   `1\n00:00:01,000 --> 00:00:04,500\ncontent text`
 *   `[00:01:23] content text`
 *   `(00:01:23) content text`
 * Relies on buildSubtitlePlainText when raw body is available for best results.
 */
export function stripBilibiliTimestamps(text: string): string {
  return text
    // Remove SRT numbering lines (standalone numbers)
    .replace(/^\d+\n/gm, '')
    // Remove SRT/ASS timestamp range lines
    .replace(/^\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*$/gm, '')
    // Remove bracket timestamps like [00:01:23] or (00:01:23)
    .replace(/[[(]\d{1,2}:\d{2}(?::\d{2})?[)\]]\s*/g, '')
    // Remove standalone timestamp prefixes
    .replace(/^\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*/gm, '')
    // Clean up multiple blank lines left after removal
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sanitizeBilibiliFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}
