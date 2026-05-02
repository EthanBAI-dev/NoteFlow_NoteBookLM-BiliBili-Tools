import React, { useEffect, useState } from 'react'
import dayjs from 'dayjs'

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase =
  | 'detecting'       // Checking if we are on a Bilibili video page
  | 'no_tab'          // Could not get active tab
  | 'not_bilibili'    // Not a Bilibili video page
  | 'fetching_info'   // Fetching video info from Bilibili API
  | 'no_subtitle'     // Video found but no subtitles available
  | 'ready'           // Video info loaded, ready to extract
  | 'extracting'      // Fetching subtitle JSON
  | 'done'            // Markdown downloaded successfully
  | 'error'           // Something went wrong

interface VideoInfo {
  title: string
  author?: string
  url: string
  ctime?: number
  subtitleUrl?: string
  subtitleCount?: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}

function buildMarkdown(info: VideoInfo, lines: string[]): string {
  const date = dayjs().format('YYYY-MM-DD')
  const uploadDate = info.ctime
    ? dayjs(info.ctime * 1000).format('YYYY-MM-DD')
    : '未知'

  const header = [
    `# ${info.title}`,
    '',
    `**UP主**: ${info.author ?? '未知'}`,
    `**链接**: ${info.url}`,
    `**上传日期**: ${uploadDate}`,
    `**抓取日期**: ${date}`,
    '',
    '---',
    '',
  ].join('\n')

  const body = lines.join('\n')
  return header + body
}

function downloadMarkdown(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename.replace(/[/\\?%*:|"<>]/g, '_')}.md`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Main injection logic (runs in the page context via chrome.scripting) ─────

// This function is injected into the Bilibili page to fetch all subtitle data.
// It must be self-contained (no closures from outer scope).
async function extractSubtitlesInPage(): Promise<{
  ok: boolean
  error?: string
  title?: string
  author?: string
  url?: string
  ctime?: number
  lines?: string[]
  subtitleLang?: string
}> {
  // 1. Parse bvid/aid from current URL
  const pathname = location.pathname
  const searchParams = new URLSearchParams(location.search)
  let aidOrBvid = searchParams.get('bvid')
  if (!aidOrBvid) {
    const parts = pathname.replace(/\/$/, '').split('/')
    aidOrBvid = parts[parts.length - 1]
  }
  if (!aidOrBvid) {
    return { ok: false, error: '无法从当前页面 URL 解析视频 ID' }
  }

  // 2. Fetch video info (title, aid, cid, author)
  let title = ''
  let author: string | undefined
  let ctime: number | undefined
  let aid: number | undefined
  let cid: string | undefined
  let url = location.origin + location.pathname
  let subtitles: any[] = []

  try {
    if (aidOrBvid.toLowerCase().startsWith('av')) {
      aid = parseInt(aidOrBvid.slice(2))
      const pages = await fetch(
        `https://api.bilibili.com/x/player/pagelist?aid=${aid}`,
        { credentials: 'include' }
      ).then(r => r.json()).then(r => r.data)
      if (!pages || !pages[0]) return { ok: false, error: '无法获取分P信息' }
      cid = String(pages[0].cid)
      title = pages[0].part || '未知标题'
      ctime = pages[0].ctime
      author = pages[0].owner?.name
    } else {
      const info = await fetch(
        `https://api.bilibili.com/x/web-interface/view?bvid=${aidOrBvid}`,
        { credentials: 'include' }
      ).then(r => r.json())
      if (!info?.data) return { ok: false, error: '无法获取视频信息（可能需要登录）' }
      const d = info.data
      title = d.title
      aid = d.aid
      cid = String(d.cid)
      ctime = d.ctime
      author = d.owner?.name
    }
  } catch (e: any) {
    return { ok: false, error: '获取视频信息失败: ' + e.message }
  }

  // 3. Fetch subtitle list
  try {
    const playerRes = await fetch(
      `https://api.bilibili.com/x/player/wbi/v2?aid=${aid}&cid=${cid}`,
      { credentials: 'include' }
    ).then(r => r.json())
    subtitles = playerRes?.data?.subtitle?.subtitles ?? []
    subtitles = subtitles.filter((s: any) => s.subtitle_url)
  } catch (e: any) {
    return { ok: false, error: '获取字幕列表失败: ' + e.message }
  }

  if (!subtitles || subtitles.length === 0) {
    return { ok: false, error: '该视频暂无字幕（CC字幕）' }
  }

  // 4. Pick the best subtitle: prefer zh-CN, then zh, then first
  const preferOrder = ['zh-CN', 'zh-Hans', 'zh']
  let best = subtitles.find((s: any) => preferOrder.some(lang => s.lan === lang))
  if (!best) best = subtitles[0]

  // 5. Fetch the actual subtitle JSON
  let subtitleBody: any[] = []
  let subtitleUrl = best.subtitle_url as string
  if (subtitleUrl.startsWith('//')) subtitleUrl = 'https:' + subtitleUrl
  if (subtitleUrl.startsWith('http://')) subtitleUrl = subtitleUrl.replace('http://', 'https://')

  try {
    const subJson = await fetch(subtitleUrl).then(r => r.json())
    subtitleBody = subJson?.body ?? []
  } catch (e: any) {
    return { ok: false, error: '下载字幕文件失败: ' + e.message }
  }

  // 6. Clean subtitle lines
  const lines: string[] = subtitleBody.map((item: any) => {
    return (item.content ?? '').replace(/<[^>]*>/g, '').trim()
  }).filter((line: string) => line.length > 0)

  return {
    ok: true,
    title,
    author,
    url,
    ctime,
    lines,
    subtitleLang: best.lan_doc || best.lan || '',
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PopupApp() {
  const [phase, setPhase] = useState<Phase>('detecting')
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null)
  const [statusMsg, setStatusMsg] = useState('正在检测当前页面...')
  const [errorMsg, setErrorMsg] = useState('')
  const [activeTabId, setActiveTabId] = useState<number | null>(null)

  // ── Auto-detect on mount ──────────────────────────────────────────────────
  useEffect(() => {
    detectPage()
  }, [])

  async function detectPage() {
    setPhase('detecting')
    setStatusMsg('正在检测当前页面...')

    let tab: chrome.tabs.Tab | undefined
    try {
      const [t] = await chrome.tabs.query({ active: true, currentWindow: true })
      tab = t
    } catch {
      setPhase('no_tab')
      setStatusMsg('无法获取当前标签页')
      return
    }

    if (!tab?.id || !tab?.url) {
      setPhase('no_tab')
      setStatusMsg('无法获取当前标签页')
      return
    }

    const isBilibili = /^https?:\/\/(www\.)?bilibili\.com\/(video|list)/.test(tab.url)
    if (!isBilibili) {
      setPhase('not_bilibili')
      setStatusMsg('请切换到 Bilibili 视频页面')
      return
    }

    setActiveTabId(tab.id)
    setPhase('fetching_info')
    setStatusMsg('正在加载视频信息...')

    // Inject a small script to get window.__INITIAL_STATE__ title quickly
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const title = document.title?.replace(' - 哔哩哔哩', '').replace('_哔哩哔哩_bilibili', '').trim()
          const pathname = location.pathname
          const searchParams = new URLSearchParams(location.search)
          let aidOrBvid = searchParams.get('bvid')
          if (!aidOrBvid) {
            const parts = pathname.replace(/\/$/, '').split('/')
            aidOrBvid = parts[parts.length - 1]
          }
          return { title, aidOrBvid, url: location.origin + location.pathname }
        },
      })

      const pageData = results[0]?.result as { title: string; aidOrBvid: string; url: string } | null
      if (pageData?.aidOrBvid) {
        setVideoInfo({
          title: pageData.title || '（加载中...）',
          url: pageData.url,
        })
        setPhase('ready')
        setStatusMsg('视频检测成功！点击按钮提取字幕。')
      } else {
        setPhase('not_bilibili')
        setStatusMsg('无法识别当前视频页面，请刷新后再试。')
      }
    } catch (e: any) {
      setPhase('error')
      setErrorMsg('检测失败: ' + (e.message ?? String(e)))
    }
  }

  // ── Main extraction flow ───────────────────────────────────────────────────
  async function handleExtract() {
    if (!activeTabId) return
    setPhase('extracting')
    setStatusMsg('正在获取字幕数据...')

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        func: extractSubtitlesInPage,
      })

      const result = results[0]?.result
      if (!result) {
        setPhase('error')
        setErrorMsg('脚本注入失败，请检查权限。')
        return
      }

      if (!result.ok) {
        setPhase('no_subtitle')
        setErrorMsg(result.error ?? '未知错误')
        return
      }

      // Build Markdown
      const info: VideoInfo = {
        title: result.title!,
        author: result.author,
        url: result.url!,
        ctime: result.ctime,
        subtitleCount: result.lines!.length,
      }
      setVideoInfo(info)

      const mdContent = buildMarkdown(info, result.lines!)
      downloadMarkdown(info.title, mdContent)

      setPhase('done')
      setStatusMsg(`成功！已下载 ${result.lines!.length} 条字幕为 Markdown 文件。`)
    } catch (e: any) {
      setPhase('error')
      setErrorMsg('提取失败: ' + (e.message ?? String(e)))
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const isLoading = phase === 'detecting' || phase === 'fetching_info' || phase === 'extracting'
  const canExtract = phase === 'ready' || phase === 'done'
  const isDone = phase === 'done'

  return (
    <div className="popup-container">
      {/* Header */}
      <div className="popup-header">
        <div className="logo-icon">⚡</div>
        <div className="header-text">
          <h1>FlowToLM</h1>
          <p>Bilibili → Markdown → NotebookLM</p>
        </div>
      </div>

      <div className="popup-content">
        {/* Video info / status card */}
        <div
          className={`video-info-card fade-in ${
            phase === 'not_bilibili' || phase === 'no_tab' || phase === 'error' || phase === 'no_subtitle'
              ? 'not-found'
              : phase === 'ready' || phase === 'done'
              ? 'found'
              : 'loading'
          }`}
        >
          <div className="card-row">
            <span className="card-icon">
              {isLoading ? (
                <span className="spinner" />
              ) : phase === 'ready' || phase === 'done' ? (
                '🎬'
              ) : (
                '⚠️'
              )}
            </span>
            <div className="card-body">
              <div className="card-label">
                {phase === 'ready' || phase === 'done' ? '检测到视频' : '状态'}
              </div>

              {videoInfo && (phase === 'ready' || phase === 'done') ? (
                <>
                  <div className="card-title">{videoInfo.title}</div>
                  {videoInfo.author && (
                    <div className="card-meta">
                      <span>👤 {videoInfo.author}</span>
                    </div>
                  )}
                  {isDone && videoInfo.subtitleCount !== undefined && (
                    <div className="subtitle-badge">
                      ✅ {videoInfo.subtitleCount} 条字幕已导出
                    </div>
                  )}
                </>
              ) : (
                <div
                  className={`status-text ${
                    phase === 'error' || phase === 'no_subtitle' || phase === 'not_bilibili' || phase === 'no_tab'
                      ? 'error'
                      : isDone
                      ? 'success'
                      : ''
                  }`}
                >
                  {phase === 'error' || phase === 'no_subtitle'
                    ? errorMsg
                    : statusMsg}
                </div>
              )}

              {isLoading && (
                <div className="progress-bar-wrapper">
                  <div className="progress-bar-fill" style={{ width: '60%' }} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Main action button */}
        <button
          id="btn-extract-subtitles"
          className={`btn-extract ${isDone ? 'success-state' : ''}`}
          onClick={isDone ? detectPage : canExtract ? handleExtract : detectPage}
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <span className="spinner" />
              处理中...
            </>
          ) : isDone ? (
            '✅ 下载成功！点击重新检测'
          ) : canExtract ? (
            '⬇️ 提取当前集字幕'
          ) : (
            '🔄 重新检测'
          )}
        </button>
      </div>

      {/* Footer */}
      <div className="popup-footer">
        <span className="footer-text">FlowToLM v1.0 · Phase 1</span>
      </div>
    </div>
  )
}
