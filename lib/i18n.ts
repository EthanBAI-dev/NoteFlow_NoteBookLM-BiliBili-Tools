import { useMemo, useSyncExternalStore } from 'react';

export type Locale = 'zh' | 'en';

const zh = {
  // ── Common ──
  'selectAll': '全选',
  'deselectAll': '取消全选',
  'cancel': '取消',
  'importing': '正在导入...',
  'importFailed': '导入失败',
  'importSuccess': '导入成功！',
  'retryFailed': '重试失败',
  'retry': '重试',
  'collapse': '收起',
  'details': '详情',
  'load': '加载',
  'delete': '删除',
  'create': '创建',
  'close': '关闭',
  'import': '导入',
  'analyze': '分析',
  'invalidUrl': '请输入有效的 URL',
  'pdfFailed': 'PDF 生成失败',
  'pdfDownloaded': 'PDF 已下载',
  'pdfFetching': '抓取页面 {current}/{total}...',
  'pdfGenerating': '生成 PDF {current}/{total}...',
  'pdfGeneratingSimple': '生成 PDF...',
  'clipboardCopied': '已复制到剪贴板',
  'clipboardFailed': '复制失败',
  'copyToClipboard': '复制',
  'downloadPdf': '下载 PDF',
  'successCount': '成功 {success} 个',
  'successFailCount': '成功 {success} 个，失败 {failed} 个',
  'successArticles': '成功 {success} 篇',
  'successFailArticles': '成功 {success} 篇，失败 {failed} 篇',
  'selectAtLeastOnePage': '请至少选择一个页面',
  'selectAtLeastOneArticle': '请至少选择一篇文章',

  // ── App ──
  'app.importHistory': '导入历史',
  'app.importingProgress': '正在导入 {completed}/{total}',
  'app.tabBookmarks': '网页导入',
  'app.tabPodcast': '播客',
  'app.tabAI': 'AI 对话',
  'app.tabMore': '更多',

  // ── Notebook Selector ──
  'notebook.openInTab': '在标签页中打开',
  'notebook.loading': '加载中...',
  'notebook.noNotebooks': '暂无笔记本',
  'notebook.selectNotebook': '选择笔记本',
  'notebook.searchPlaceholder': '搜索笔记本...',
  'notebook.noSearchResults': '没有匹配的笔记本',
  'notebook.importToNlm': '一键导入 NotebookLM',

  // ── PodcastImport ──
  'podcast.link': '播客链接',
  'podcast.enterLink': '请输入播客链接',
  'podcast.unrecognized': '无法识别链接，支持 Apple Podcasts 和小宇宙',
  'podcast.fetchFailed': '获取失败',
  'podcast.selectAtLeastOne': '请至少选择一集',
  'podcast.downloadFailed': '下载失败',
  'podcast.placeholder': '粘贴 Apple Podcasts 或小宇宙链接...',
  'podcast.latest': '最新',
  'podcast.all': '全部',
  'podcast.episodes': '集',
  'podcast.querying': '查询中...',
  'podcast.query': '查询',
  'podcast.minutes': '分钟',
  'podcast.selectedEpisodes': '已选 {selected}/{total} 集',
  'podcast.downloading': '下载中 {current}/{total}',
  'podcast.downloadDone': '下载完成',
  'podcast.downloadSelected': '下载选中 ({count} 集)',
  'podcast.supportedFormats': '支持的链接格式：',
  'podcast.formatApple': 'Apple Podcasts：podcasts.apple.com/.../id123456',
  'podcast.formatXyz1': '小宇宙单集：xiaoyuzhoufm.com/episode/...',
  'podcast.formatXyz2': '小宇宙节目：xiaoyuzhoufm.com/podcast/...',

  // ── BilibiliImport ──
  'app.tabBilibili': '哔哩哔哩',
  'bilibili.link': '哔哩哔哩 链接',
  'bilibili.enterLink': '请输入哔哩哔哩视频链接',
  'bilibili.unrecognized': '无法识别的链接，请输入 bilibili.com/video/BVxxx 格式的链接',
  'bilibili.fetchFailed': '获取视频信息失败',
  'bilibili.noSubtitle': '此视频没有字幕',
  'bilibili.placeholder': '粘贴哔哩哔哩视频链接...',
  'bilibili.parts': '个分P',
  'bilibili.querying': '获取中...',
  'bilibili.query': '获取',
  'bilibili.fetchSubtitles': '获取字幕',
  'bilibili.fetchingSubtitles': '获取字幕中...',
  'bilibili.downloadSubtitles': '下载字幕文件 ({count})',
  'bilibili.uploadToDrive': '上传到 Google Drive ({count})',
  'bilibili.uploadingToDrive': '上传到 Google Drive 中...',
  'bilibili.driveUploadDone': '已上传到 Google Drive',
  'bilibili.driveUploadFailed': '上传到 Google Drive 失败',
  'bilibili.importToNlm': '导入到 NotebookLM ({count})',
  'bilibili.importing': '导入中...',
  'bilibili.importDone': '导入完成',
  'bilibili.downloadDone': '下载完成',
  'bilibili.selectedParts': '已选 {selected}/{total} 个分P',
  'bilibili.selectAtLeastOne': '请至少选择一个视频',
  'bilibili.singleVideo': '单个视频',
  'bilibili.downloadThis': '下载字幕文件',
  'bilibili.importThis': '导入到 NotebookLM',
  'bilibili.noSubtitleHint': '没有字幕的分P将被跳过',
  'bilibili.subtitleLang': '字幕语言：{lang}',
  'bilibili.supportedFormats': '支持的链接格式：',
  'bilibili.formatVideo': '单视频: bilibili.com/video/BVxxx',
  'bilibili.formatPart': '分P视频: bilibili.com/video/BVxxx?p=2',
  'bilibili.apiNote': '字幕获取需要登录哔哩哔哩账号',

  // ── Bilibili Modes ──
  'bilibili.fetchMode': '获取方式',
  'bilibili.modeSingle': '单个视频',
  'bilibili.modeSpace': '个人主页',
  'bilibili.modeFavorite': '收藏夹',
  'bilibili.modeSeries': '合集',
  'bilibili.modeSeason': '视频选集',
  'bilibili.spacePlaceholder': '粘贴 UP主主页链接 (space.bilibili.com/xxx)...',
  'bilibili.spaceUnrecognized': '无法识别的链接，请输入 space.bilibili.com/xxx 格式的 UP主主页链接',
  'bilibili.fetchVideos': '获取',
  'bilibili.fetchingVideos': '获取中...',
  'bilibili.separate': '分P',
  'bilibili.merged': '合并',
  'bilibili.outputType': '输出字幕方式',
  'bilibili.importType': '导入方式',
  'bilibili.outputFormat': '输出格式',
  'bilibili.aiPolish': 'AI 润色',
  'bilibili.downloadOneClick': '一键下载',
  'bilibili.downloadProgress': '下载进度',
  'bilibili.importOneClick': '一键导入 NotebookLM',
  'bilibili.tabExport': '导出字幕',
  'bilibili.tabImport': '导入notebookLM',

  // ── App Controls ──
  'app.readCurrentPage': '读取当前网页',

  // ── YouTubeImport ──
  'app.tabYouTube': 'YouTube',
  'youtube.link': 'YouTube 链接',
  'youtube.enterLink': '请输入 YouTube 链接',
  'youtube.unrecognized': '无法识别的链接，支持视频、播放列表和频道链接',
  'youtube.fetchFailed': '获取视频列表失败',
  'youtube.selectAtLeastOne': '请至少选择一个视频',
  'youtube.placeholder': '粘贴 YouTube 视频、播放列表或频道链接...',
  'youtube.videos': '个视频',
  'youtube.loadMore': '加载更多',
  'youtube.loadingMore': '加载中...',
  'youtube.querying': '正在获取...',
  'youtube.query': '获取',
  'youtube.selectedVideos': '已选择 {selected}/{total} 个视频',
  'youtube.importToNlm': '导入到 NotebookLM ({count})',
  'youtube.importing': '正在导入 {current}/{total}',
  'youtube.importDone': '导入完成',
  'youtube.singleVideo': '单个视频',
  'youtube.importThisVideo': '导入此视频',
  'youtube.noVideos': '未找到视频',
  'youtube.supportedFormats': '支持的链接格式：',
  'youtube.formatVideo': '视频: youtube.com/watch?v=xxx',
  'youtube.formatPlaylist': '播放列表: youtube.com/playlist?list=xxx',
  'youtube.formatChannel': '频道: youtube.com/@username',
  'youtube.formatShort': '短链接: youtu.be/xxx',
  'onboarding.stepYouTube': '粘贴 YouTube 视频、播放列表或频道链接，批量导入到 NotebookLM。',

  // ── HistoryPanel ──
  'history.title': '导入历史',
  'history.clearHistory': '清除历史',
  'history.confirmClear': '确定要清除所有导入历史吗？',
  'history.justNow': '刚刚',
  'history.minutesAgo': '{count} 分钟前',
  'history.hoursAgo': '{count} 小时前',
  'history.noRecords': '暂无导入记录',
  'history.recordsHint': '导入内容后，记录会出现在这里',

  // ── SingleImport ──
  'single.importFailedHint': '导入失败，请确保 NotebookLM 页面已打开',
  'single.currentTab': '当前标签页',
  'single.enterUrl': '输入 URL',
  'single.importingBtn': '导入中',
  'single.supportedImports': '支持导入：',
  'single.webArticles': '普通网页文章',
  'single.substackWechat': 'Substack / 微信公众号（智能提取正文）',
  'single.pdfLinks': 'PDF 文件链接',

  // ── ClaudeImport ──
  'claude.extractFailed': '提取对话失败',
  'claude.openNotebook': '请先打开 NotebookLM 笔记本页面，然后再导入',
  'claude.cannotGetNlmTab': '无法获取 NotebookLM 标签页',
  'claude.openNotebookNotHome': '请先打开一个 NotebookLM 笔记本（而非首页），然后再导入',
  'claude.openAiPage': '请先打开 AI 对话页面',
  'claude.supported': '支持：Claude · ChatGPT · Gemini',
  'claude.extracting': '正在提取对话...',
  'claude.extractCurrent': '提取当前对话',
  'claude.currentPlatform': '当前平台：',
  'claude.instructions': '使用说明：',
  'claude.step1': '在 {platform} 打开对话页面',
  'claude.step2': '点击「提取当前对话」',
  'claude.step3': '选择要导入的问答对',
  'claude.step4': '点击导入到 NotebookLM',
  'claude.reExtract': '重新提取',
  'claude.qaPairs': '共 {total} 个问答对，已选择 {selected} 个',
  'claude.noQuestion': '(无问题)',
  'claude.noAnswer': '(无回答)',
  'claude.importingBtn': '导入中...',
  'claude.importSelected': '导入选中的 {count} 个问答对',
  'claude.source': '来源',
  'claude.conversation': '对话',
  'claude.guideTitle': '如何使用',
  'claude.guideStep1': '打开 Claude、ChatGPT 或 Gemini 的对话页面',
  'claude.guideStep2': '点击浏览器工具栏中的 Flow2Note 图标打开本面板',
  'claude.guideStep3': '点击「提取当前对话」，选择要导入的问答对',
  'claude.guideStep4': '一键导入到 NotebookLM，AI 对话秒变知识来源',
  'claude.shareCard': '生成分享卡片',
  'claude.guideTip': '💡 导入前请确保已打开一个 NotebookLM 笔记本（非首页）',

  // ── BookmarkPanel ──
  'bookmark.collection': '网址集合',
  'bookmark.bookmarked': '已收集',
  'bookmark.addBookmark': '收集',
  'bookmark.importNow': '导入',
  'bookmark.all': '全部',
  'bookmark.newCollection': '新建集合',
  'bookmark.collectionName': '集合名称',
  'bookmark.selectedItems': '已选 {count} 项',
  'bookmark.totalItems': '共 {count} 项',
  'bookmark.moveTo': '移至…',
  'bookmark.moveToCollection': '移至…',
  'bookmark.exportPdf': '聚合导出 PDF ({count} 篇)',
  'bookmark.importToNlm': '导入 NotebookLM ({count} 篇)',
  'bookmark.emptyTitle': '收集网页，聚合导入',
  'bookmark.emptyDesc': 'NotebookLM 免费用户来源数有限。将多个网页收集后聚合为一份 PDF 导入，用一个来源额度获取多篇内容。',
  'bookmark.step1': '浏览网页时点击上方「收集」按钮，将有价值的页面加入列表',
  'bookmark.step2': '选择多个页面，点击「聚合导出 PDF」合并为一份文档',
  'bookmark.step3': '将 PDF 上传到 NotebookLM，一个来源 = 多篇内容',
  'bookmark.pdfSaved': 'PDF 已保存，可上传到 NotebookLM 作为来源',

  // ── RescueBanner ──
  'rescue.scanning': '扫描失败来源...',
  'rescue.foundFailed': '发现 {count} 个来源导入失败',
  'rescue.rescuing': '正在抢救...',
  'rescue.done': '抢救完成：成功 {success}，失败 {failed}',
  'rescue.rescue': '抢救',

  // ── BatchImport ──
  'batch.getTabsFailed': '获取标签页失败',
  'batch.batchFailed': '批量导入失败',
  'batch.importAllTabs': '导入所有打开的标签页',
  'batch.urlList': 'URL 列表',
  'batch.placeholder': '每行一个 URL，或用逗号分隔',
  'batch.batchImport': '批量导入',

  // ── Onboarding ──
  'onboarding.welcomeTitle': '欢迎使用 Flow2Note!',
  'onboarding.welcomeDesc': '将各种内容一键导入 NotebookLM。需要快速了解一下吗？',
  'onboarding.skip': '跳过',
  'onboarding.showMeAround': '开始引导',
  'onboarding.next': '下一步',
  'onboarding.prev': '上一步',
  'onboarding.done': '完成',
  'onboarding.stepNotebook': '选择你要导入内容的 Notebook，点击切换到其他 Notebook。',
  'onboarding.stepBilibili': '粘贴哔哩哔哩视频链接，获取字幕并导入到 NotebookLM。',
  'onboarding.stepBookmark': '将多个网页收集后，聚合为一份 PDF 批量导入，用一个来源额度获取多篇内容。',
  'onboarding.stepPodcast': '粘贴 Apple Podcasts 或小宇宙链接，选择单集直接导入到 NotebookLM。',
  'onboarding.stepAI': '一键提取 Claude、ChatGPT、Gemini 的对话内容，导入为 NotebookLM 来源。',
  'onboarding.replayTour': '重新引导',
  'onboarding.replayTourDesc': '再看一次新手引导',

  // ── MorePanel ──
  'more.rssImport': 'RSS 导入',
  'more.rssFailed': 'RSS 解析失败',
  'more.enterRssLink': '请输入 RSS 链接',
  'more.selectedArticles': '已选择 {selected}/{total} 篇',
  'more.importSelected': '导入选中文章',
  'more.rssFormats': '常见格式：/feed, /rss, /atom.xml, medium.com/feed/@user',
  'more.about': '关于',
  'more.ytChannel': '小白播客',
  'more.ytDesc': 'YouTube 频道 · 教程与分享',
  'more.ghDesc': '开源项目 · 欢迎 Star',
  'more.madeBy': 'YouTuber「小白」',
  'more.tutorial': '使用教程',
  'more.tutorialDesc': '5 分钟上手 Flow2Note',
  'more.rateTitle': '喜欢 Flow2Note？',
  'more.rateDesc': '在 Chrome 商店留下评价，帮助更多人发现我们',
  'more.rateBtn': '去评价',
  'more.settings': '设置',
  'more.autoRenameTitle': '自动重命名默认名来源',
  'more.autoRenameDesc': '文本导入后，若 NotebookLM 给出 "Pasted Text" 等默认名，自动改成真实标题',
  'more.aiPolish': 'AI 润色设置',
  'more.aiEnable': '启用 AI 润色',
  'more.aiProvider': 'AI 服务商',
  'more.aiApiKey': 'API Key',
  'more.aiApiKeyPlaceholder': '请输入 API Key',
  'more.aiModel': '模型（可选）',
  'more.aiModelPlaceholder': '默认模型',
  'more.aiPromptStyle': '提示词风格',
  'more.aiPromptCustom': '自定义',
  'more.aiCustomPrompt': '自定义提示词',
  'more.aiCustomPromptPlaceholder': '输入自定义提示词...',
  'more.aiPolishNote': 'AI 润色会调用第三方 API，请确保你有对应的 API Key。提示词将被发送到所选服务商进行处理。',

  // ── RssImport ──
  'rss.feedUrl': 'RSS 订阅地址',
  'rss.enterFeedUrl': '请输入 RSS 订阅地址',
  'rss.parseFailed': '解析 RSS 失败，请检查 URL 是否正确',
  'rss.selectedArticles': '已选择 {selected}/{total} 篇文章',
  'rss.importSelected': '导入选中文章 ({count})',
  'rss.tipTitle': '常见 RSS 地址格式：',
  'rss.tipBlog': '博客: /feed, /rss, /atom.xml',
  'rss.tipMedium': 'Medium: medium.com/feed/@username',
  'rss.tipSubstack': 'Substack: xxx.substack.com/feed',

  // ── ImportPanel ──
  'panel.single': '单个',
  'panel.batch': '批量',
  'panel.cannotImportNlm': '不能导入 NotebookLM 自身的页面',
  'panel.rssAtomLink': 'RSS / Atom 链接',
  'panel.supportedFormats': '支持导入：网页文章、Substack、微信公众号、PDF 链接（自动修复导入失败的来源）',
} as const;

const en: Record<keyof typeof zh, string> = {
  // ── Common ──
  'selectAll': 'Select All',
  'deselectAll': 'Deselect All',
  'cancel': 'Cancel',
  'importing': 'Importing...',
  'importFailed': 'Import failed',
  'importSuccess': 'Import successful!',
  'retryFailed': 'Retry Failed',
  'retry': 'Retry',
  'collapse': 'Collapse',
  'details': 'Details',
  'load': 'Load',
  'delete': 'Delete',
  'create': 'Create',
  'close': 'Close',
  'import': 'Import',
  'analyze': 'Analyze',
  'invalidUrl': 'Please enter a valid URL',
  'pdfFailed': 'PDF generation failed',
  'pdfDownloaded': 'PDF downloaded',
  'pdfFetching': 'Fetching {current}/{total}...',
  'pdfGenerating': 'Generating PDF {current}/{total}...',
  'pdfGeneratingSimple': 'Generating PDF...',
  'clipboardCopied': 'Copied to clipboard',
  'clipboardFailed': 'Copy failed',
  'copyToClipboard': 'Copy',
  'downloadPdf': 'Download PDF',
  'successCount': '{success} succeeded',
  'successFailCount': '{success} succeeded, {failed} failed',
  'successArticles': '{success} articles succeeded',
  'successFailArticles': '{success} succeeded, {failed} failed',
  'selectAtLeastOnePage': 'Please select at least one page',
  'selectAtLeastOneArticle': 'Please select at least one article',

  // ── App ──
  'app.importHistory': 'Import History',
  'app.importingProgress': 'Importing {completed}/{total}',
  'app.tabBookmarks': 'Web Import',
  'app.tabPodcast': 'Podcast',
  'app.tabAI': 'AI Chat',
  'app.tabMore': 'More',

  // ── Notebook Selector ──
  'notebook.openInTab': 'Open in tab',
  'notebook.loading': 'Loading...',
  'notebook.noNotebooks': 'No notebooks',
  'notebook.selectNotebook': 'Select notebook',
  'notebook.searchPlaceholder': 'Search notebooks...',
  'notebook.noSearchResults': 'No matching notebooks',
  'notebook.importToNlm': 'Import to NotebookLM',

  // ── PodcastImport ──
  'podcast.link': 'Podcast Link',
  'podcast.enterLink': 'Please enter a podcast link',
  'podcast.unrecognized': 'Unrecognized link. Supports Apple Podcasts and Xiaoyuzhou.',
  'podcast.fetchFailed': 'Fetch failed',
  'podcast.selectAtLeastOne': 'Please select at least one episode',
  'podcast.downloadFailed': 'Download failed',
  'podcast.placeholder': 'Paste Apple Podcasts or Xiaoyuzhou link...',
  'podcast.latest': 'Latest',
  'podcast.all': 'All',
  'podcast.episodes': 'episodes',
  'podcast.querying': 'Searching...',
  'podcast.query': 'Search',
  'podcast.minutes': 'min',
  'podcast.selectedEpisodes': '{selected}/{total} episodes selected',
  'podcast.downloading': 'Downloading {current}/{total}',
  'podcast.downloadDone': 'Download complete',
  'podcast.downloadSelected': 'Download ({count} episodes)',
  'podcast.supportedFormats': 'Supported link formats:',
  'podcast.formatApple': 'Apple Podcasts: podcasts.apple.com/.../id123456',
  'podcast.formatXyz1': 'Xiaoyuzhou episode: xiaoyuzhoufm.com/episode/...',
  'podcast.formatXyz2': 'Xiaoyuzhou podcast: xiaoyuzhoufm.com/podcast/...',

  // ── BilibiliImport ──
  'app.tabBilibili': 'Bilibili',
  'bilibili.link': 'Bilibili Link',
  'bilibili.enterLink': 'Please enter a Bilibili video link',
  'bilibili.unrecognized': 'Unrecognized link. Please use a bilibili.com/video/BVxxx format URL.',
  'bilibili.fetchFailed': 'Failed to fetch video info',
  'bilibili.noSubtitle': 'This video has no subtitles',
  'bilibili.placeholder': 'Paste Bilibili video link...',
  'bilibili.parts': 'parts',
  'bilibili.querying': 'Fetching...',
  'bilibili.query': 'Fetch',
  'bilibili.fetchSubtitles': 'Fetch Subtitles',
  'bilibili.fetchingSubtitles': 'Fetching subtitles...',
  'bilibili.downloadSubtitles': 'Download Subtitle Files ({count})',
  'bilibili.uploadToDrive': 'Upload to Google Drive ({count})',
  'bilibili.uploadingToDrive': 'Uploading to Google Drive...',
  'bilibili.driveUploadDone': 'Uploaded to Google Drive',
  'bilibili.driveUploadFailed': 'Upload to Google Drive failed',
  'bilibili.importToNlm': 'Import to NotebookLM ({count})',
  'bilibili.importing': 'Importing...',
  'bilibili.importDone': 'Import complete',
  'bilibili.downloadDone': 'Download complete',
  'bilibili.selectedParts': '{selected}/{total} parts selected',
  'bilibili.selectAtLeastOne': 'Please select at least one video',
  'bilibili.singleVideo': 'Single video',
  'bilibili.downloadThis': 'Download Subtitle File',
  'bilibili.importThis': 'Import to NotebookLM',
  'bilibili.noSubtitleHint': 'Parts without subtitles will be skipped',
  'bilibili.subtitleLang': 'Subtitle: {lang}',
  'bilibili.supportedFormats': 'Supported link formats:',
  'bilibili.formatVideo': 'Single video: bilibili.com/video/BVxxx',
  'bilibili.formatPart': 'Multi-part: bilibili.com/video/BVxxx?p=2',
  'bilibili.apiNote': 'Subtitle extraction requires Bilibili login',

  // ── Bilibili Modes ──
  'bilibili.fetchMode': 'Fetch Mode',
  'bilibili.modeSingle': 'Single Video',
  'bilibili.modeSpace': 'Creator Page',
  'bilibili.modeFavorite': 'Favorites',
  'bilibili.modeSeries': 'Collection',
  'bilibili.modeSeason': 'Episodes',
  'bilibili.spacePlaceholder': 'Paste creator page URL (space.bilibili.com/xxx)...',
  'bilibili.spaceUnrecognized': 'Unrecognized URL. Please use space.bilibili.com/xxx format.',
  'bilibili.fetchVideos': 'Fetch',
  'bilibili.fetchingVideos': 'Fetching...',
  'bilibili.separate': 'Split',
  'bilibili.merged': 'Merged',
  'bilibili.outputType': 'Output Mode',
  'bilibili.importType': 'Import Mode',
  'bilibili.outputFormat': 'Format',
  'bilibili.aiPolish': 'AI Polish',
  'bilibili.downloadOneClick': 'Download All',
  'bilibili.downloadProgress': 'Progress',
  'bilibili.importOneClick': 'Import to NotebookLM',
  'bilibili.tabExport': 'Export Subtitles',
  'bilibili.tabImport': 'Import to NLM',

  // ── App Controls ──
  'app.readCurrentPage': 'Read Current Page',

  // ── YouTubeImport ──
  'app.tabYouTube': 'YouTube',
  'youtube.link': 'YouTube Link',
  'youtube.enterLink': 'Please enter a YouTube link',
  'youtube.unrecognized': 'Unrecognized link. Supports video, playlist, and channel URLs.',
  'youtube.fetchFailed': 'Failed to fetch video list',
  'youtube.selectAtLeastOne': 'Please select at least one video',
  'youtube.placeholder': 'Paste YouTube video, playlist, or channel link...',
  'youtube.videos': 'videos',
  'youtube.loadMore': 'Load more',
  'youtube.loadingMore': 'Loading...',
  'youtube.querying': 'Fetching...',
  'youtube.query': 'Fetch',
  'youtube.selectedVideos': '{selected}/{total} videos selected',
  'youtube.importToNlm': 'Import to NotebookLM ({count})',
  'youtube.importing': 'Importing {current}/{total}',
  'youtube.importDone': 'Import complete',
  'youtube.singleVideo': 'Single video',
  'youtube.importThisVideo': 'Import this video',
  'youtube.noVideos': 'No videos found',
  'youtube.supportedFormats': 'Supported link formats:',
  'youtube.formatVideo': 'Video: youtube.com/watch?v=xxx',
  'youtube.formatPlaylist': 'Playlist: youtube.com/playlist?list=xxx',
  'youtube.formatChannel': 'Channel: youtube.com/@username',
  'youtube.formatShort': 'Short link: youtu.be/xxx',
  'onboarding.stepYouTube': 'Paste YouTube video, playlist, or channel links to batch import into NotebookLM.',

  // ── HistoryPanel ──
  'history.title': 'Import History',
  'history.clearHistory': 'Clear History',
  'history.confirmClear': 'Are you sure you want to clear all import history?',
  'history.justNow': 'Just now',
  'history.minutesAgo': '{count} min ago',
  'history.hoursAgo': '{count}h ago',
  'history.noRecords': 'No import records',
  'history.recordsHint': 'Records will appear here after importing',

  // ── SingleImport ──
  'single.importFailedHint': 'Import failed. Make sure NotebookLM is open.',
  'single.currentTab': 'Current Tab',
  'single.enterUrl': 'Enter URL',
  'single.importingBtn': 'Importing',
  'single.supportedImports': 'Supported imports:',
  'single.webArticles': 'Web articles',
  'single.substackWechat': 'Substack / WeChat articles (smart extraction)',
  'single.pdfLinks': 'PDF file links',

  // ── ClaudeImport ──
  'claude.extractFailed': 'Failed to extract conversation',
  'claude.openNotebook': 'Please open a NotebookLM notebook first, then import',
  'claude.cannotGetNlmTab': 'Cannot access NotebookLM tab',
  'claude.openNotebookNotHome': 'Please open a NotebookLM notebook (not the home page), then import',
  'claude.openAiPage': 'Please open an AI conversation page first',
  'claude.supported': 'Supports: Claude · ChatGPT · Gemini',
  'claude.extracting': 'Extracting conversation...',
  'claude.extractCurrent': 'Extract Current Conversation',
  'claude.currentPlatform': 'Current platform: ',
  'claude.instructions': 'Instructions:',
  'claude.step1': 'Open a conversation on {platform}',
  'claude.step2': 'Click "Extract Current Conversation"',
  'claude.step3': 'Select Q&A pairs to import',
  'claude.step4': 'Import to NotebookLM',
  'claude.reExtract': 'Re-extract',
  'claude.qaPairs': '{total} Q&A pairs, {selected} selected',
  'claude.noQuestion': '(No question)',
  'claude.noAnswer': '(No answer)',
  'claude.importingBtn': 'Importing...',
  'claude.importSelected': 'Import {count} Q&A pairs',
  'claude.source': 'Source',
  'claude.conversation': 'Conversation',
  'claude.guideTitle': 'How to use',
  'claude.guideStep1': 'Open a conversation on Claude, ChatGPT, or Gemini',
  'claude.guideStep2': 'Click the Flow2Note icon in the toolbar to open this panel',
  'claude.guideStep3': 'Click "Extract Current Conversation" and select Q&A pairs',
  'claude.guideStep4': 'Import to NotebookLM — turn AI chats into knowledge sources',
  'claude.shareCard': 'Share Card',
  'claude.guideTip': '💡 Make sure a NotebookLM notebook (not homepage) is open before importing',

  // ── BookmarkPanel ──
  'bookmark.collection': 'URL Collection',
  'bookmark.bookmarked': 'Collected',
  'bookmark.addBookmark': 'Collect',
  'bookmark.importNow': 'Import',
  'bookmark.all': 'All',
  'bookmark.newCollection': 'New Collection',
  'bookmark.collectionName': 'Collection name',
  'bookmark.selectedItems': '{count} selected',
  'bookmark.totalItems': '{count} total',
  'bookmark.moveTo': 'Move to…',
  'bookmark.moveToCollection': 'Move to…',
  'bookmark.exportPdf': 'Export PDF ({count})',
  'bookmark.importToNlm': 'Import to NotebookLM ({count})',
  'bookmark.emptyTitle': 'Collect pages, import together',
  'bookmark.emptyDesc': 'NotebookLM free users have limited sources. Collect multiple pages and export as one PDF to save source slots.',
  'bookmark.step1': 'Click "Collect" above to save valuable pages',
  'bookmark.step2': 'Select multiple pages, click "Export PDF" to merge',
  'bookmark.step3': 'Upload PDF to NotebookLM: one source = multiple pages',
  'bookmark.pdfSaved': 'PDF saved. Upload to NotebookLM as a source.',

  // ── RescueBanner ──
  'rescue.scanning': 'Scanning failed sources...',
  'rescue.foundFailed': 'Found {count} failed source imports',
  'rescue.rescuing': 'Rescuing...',
  'rescue.done': 'Rescue complete: {success} succeeded, {failed} failed',
  'rescue.rescue': 'Rescue',

  // ── BatchImport ──
  'batch.getTabsFailed': 'Failed to get tabs',
  'batch.batchFailed': 'Batch import failed',
  'batch.importAllTabs': 'Import all open tabs',
  'batch.urlList': 'URL List',
  'batch.placeholder': 'One URL per line, or comma-separated',
  'batch.batchImport': 'Batch Import',

  // ── Onboarding ──
  'onboarding.welcomeTitle': 'Welcome to Flow2Note!',
  'onboarding.welcomeDesc': 'Import content from anywhere into NotebookLM. Want a quick tour?',
  'onboarding.skip': 'Skip',
  'onboarding.showMeAround': 'Show Me Around',
  'onboarding.next': 'Next',
  'onboarding.prev': 'Previous',
  'onboarding.done': 'Done',
  'onboarding.stepNotebook': 'Select the Notebook you want to import into, or switch to another one.',
  'onboarding.stepBilibili': 'Paste a Bilibili video link to fetch subtitles and import into NotebookLM.',
  'onboarding.stepBookmark': 'Collect multiple pages and export as one PDF to save NotebookLM source slots.',
  'onboarding.stepPodcast': 'Paste an Apple Podcasts or Xiaoyuzhou link, pick episodes and import directly into NotebookLM.',
  'onboarding.stepAI': 'Extract conversations from Claude, ChatGPT, or Gemini and import them as NotebookLM sources.',
  'onboarding.replayTour': 'Replay Tour',
  'onboarding.replayTourDesc': 'View the onboarding guide again',

  // ── MorePanel ──
  'more.rssImport': 'RSS Import',
  'more.rssFailed': 'RSS parsing failed',
  'more.enterRssLink': 'Please enter an RSS link',
  'more.selectedArticles': '{selected}/{total} selected',
  'more.importSelected': 'Import Selected',
  'more.rssFormats': 'Formats: /feed, /rss, /atom.xml, medium.com/feed/@user',
  'more.about': 'About',
  'more.ytChannel': 'Green Train Podcast',
  'more.ytDesc': 'YouTube Channel · Tutorials',
  'more.ghDesc': 'Open Source · Star',
  'more.madeBy': 'YouTuber「小白」',
  'more.tutorial': 'Tutorial',
  'more.tutorialDesc': 'Get started with Flow2Note in 5 min',
  'more.rateTitle': 'Enjoying Flow2Note?',
  'more.rateDesc': 'Leave a review on Chrome Web Store to help others find us',
  'more.rateBtn': 'Rate',
  'more.settings': 'Settings',
  'more.autoRenameTitle': 'Auto-rename default-named sources',
  'more.autoRenameDesc': 'When NotebookLM leaves a pasted source as "Pasted Text", automatically rename it to the real title',
  'more.aiPolish': 'AI Polish Settings',
  'more.aiEnable': 'Enable AI Polish',
  'more.aiProvider': 'AI Provider',
  'more.aiApiKey': 'API Key',
  'more.aiApiKeyPlaceholder': 'Enter your API Key',
  'more.aiModel': 'Model (optional)',
  'more.aiModelPlaceholder': 'Default model',
  'more.aiPromptStyle': 'Prompt Style',
  'more.aiPromptCustom': 'Custom',
  'more.aiCustomPrompt': 'Custom Prompt',
  'more.aiCustomPromptPlaceholder': 'Enter custom prompt...',
  'more.aiPolishNote': 'AI polish sends prompts to third-party APIs. Make sure you have a valid API key.',

  // ── RssImport ──
  'rss.feedUrl': 'RSS Feed URL',
  'rss.enterFeedUrl': 'Please enter an RSS feed URL',
  'rss.parseFailed': 'Failed to parse RSS. Check if the URL is correct.',
  'rss.selectedArticles': '{selected}/{total} articles selected',
  'rss.importSelected': 'Import selected ({count})',
  'rss.tipTitle': 'Common RSS URL formats:',
  'rss.tipBlog': 'Blog: /feed, /rss, /atom.xml',
  'rss.tipMedium': 'Medium: medium.com/feed/@username',
  'rss.tipSubstack': 'Substack: xxx.substack.com/feed',

  // ── ImportPanel ──
  'panel.single': 'Single',
  'panel.batch': 'Batch',
  'panel.cannotImportNlm': 'Cannot import NotebookLM pages',
  'panel.rssAtomLink': 'RSS / Atom Link',
  'panel.supportedFormats': 'Supports: web articles, Substack, WeChat, PDF links (auto-rescue failed imports)',
};

export type TranslationKey = keyof typeof zh;

function detectLocale(): Locale {
  try {
    const lang = navigator.language;
    if (lang.startsWith('zh')) return 'zh';
    return 'en';
  } catch {
    return 'zh';
  }
}

const STORAGE_KEY = 'flow2note_locale';

let currentLocale: Locale | null = null;
const listeners = new Set<() => void>();

function loadLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'zh' || stored === 'en') return stored;
  } catch { /* ignore */ }
  return detectLocale();
}

function getLocale(): Locale {
  if (!currentLocale) {
    currentLocale = loadLocale();
  }
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
  try { localStorage.setItem(STORAGE_KEY, locale); } catch { /* ignore */ }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function getSnapshot(): Locale {
  return getLocale();
}

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const locale = getLocale();
  const dict = locale === 'en' ? en : zh;
  let text = dict[key] || zh[key];
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return text;
}

export function useI18n() {
  const locale = useSyncExternalStore(subscribe, getSnapshot);
  const boundT = useMemo(() => {
    // Re-create t reference when locale changes so components re-render
    return (key: TranslationKey, params?: Record<string, string | number>) => t(key, params);
  }, [locale]);
  return { t: boundT, locale, setLocale };
}
