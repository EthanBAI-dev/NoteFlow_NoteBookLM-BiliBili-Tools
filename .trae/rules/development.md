# NoteFlow 开发规范

## 项目定位
**NoteFlow** 是一个基于 **WXT + React 18 + TypeScript + Manifest V3** 的 Chrome 扩展。

它不是传统网页项目，也不是 Electron、Next.js、Tauri、小程序或服务端渲染应用。

当前产品目标：
- 将 Bilibili、YouTube、播客、网页、AI 对话等内容批量导入 Google NotebookLM
- 以 **Chrome Side Panel** 作为主操作界面
- 以前端本地能力和浏览器 API 为主，后台脚本负责调度导入与跨页面协作

## 真实技术栈
- 构建框架：`WXT`
- 前端框架：`React 18`
- 语言：`TypeScript`
- 扩展规范：`Chrome Extension Manifest V3`
- 样式：`Tailwind CSS`
- 测试：`Vitest`
- 代码检查：`ESLint`
- 其他核心依赖：`Supabase`、`JSZip`、`jsPDF`

开发时不要把本项目按以下类型理解：
- 普通 Vite 单页站
- Next.js 全栈项目
- 依赖后端路由的 Web App
- 以 popup 为唯一入口的浏览器扩展

## 目录职责

### 核心入口
- `entrypoints/background.ts`：后台消息中心、导入任务调度、上下文菜单、账号状态同步
- `entrypoints/sidepanel/`：主 UI 入口，用户大部分操作都在这里完成
- `entrypoints/offscreen/`：无界面解析任务，例如 HTML 转 Markdown
- `entrypoints/share-card/`：分享卡片页面
- `entrypoints/welcome/`：首次安装欢迎页
- `entrypoints/*.content.ts`：注入 NotebookLM、YouTube、Claude、ChatGPT、Gemini 等页面的内容脚本

### 主要组件
- `components/App.tsx`：侧边栏主容器
- `components/BilibiliImport.tsx`：Bilibili 导入
- `components/YouTubeImport.tsx`：YouTube 导入
- `components/PodcastImport.tsx`：播客导入
- `components/WebImport.tsx`：网页与标签页导入
- `components/AIchatImport.tsx`：AI 对话导入
- `components/NotebookSelector.tsx`：Notebook 选择
- `components/GoogleAccountSelector.tsx`：Google 账号切换
- `components/HistoryPanel.tsx`：导入历史
- `components/SettingsPanel.tsx`：设置面板
- `components/RescueBanner.tsx`：NotebookLM 来源抢救入口

### 服务层
- `services/notebooklm.ts`：NotebookLM 导入动作与标签页协作
- `services/notebook-api.ts`：Notebook 列表获取与缓存
- `services/bilibili.ts`：Bilibili 视频、字幕、收藏夹、UP 投稿抓取
- `services/youtube.ts`：YouTube 视频、播放列表、频道处理
- `services/podcast.ts`：Apple Podcasts / 小宇宙相关处理
- `services/claude-conversation.ts`：AI 对话提取与格式化
- `services/history.ts`：导入历史记录
- `services/account-slots.ts`：Google 多账号缓存与识别
- `services/google-drive.ts`：Google Drive 上传
- `services/pdf-generator.ts`：HTML / PDF 内容转换
- `services/op-state.ts`：操作状态保存与恢复

### 基础层
- `lib/i18n.ts`：国际化能力
- `lib/types.ts`：消息类型与核心类型定义
- `lib/env.d.ts`：`import.meta.env` 与 WXT 类型声明
- `lib/supabase.ts`：Supabase 客户端初始化

## 当前真实能力
- Bilibili 视频字幕导入
- YouTube 视频、播放列表、频道导入
- Apple Podcasts / 小宇宙内容处理
- 当前网页与多标签页导入
- Claude / ChatGPT / Gemini 对话导入
- NotebookLM 来源抢救
- Google 多账号切换
- 导入历史、欢迎引导、设置面板

## 当前不要误写的能力
以下能力不要继续在文档、README、规则或 UI 中宣传，除非代码、消息类型、服务层和界面入口都已恢复：
- RSS 导入
- 文档站批量导入
- 书签聚合导入
- Substack / 微信专用导入页

## 开发命令
```bash
pnpm install
pnpm dev
pnpm build
pnpm compile
pnpm test
pnpm lint
pnpm zip
```

PowerShell 构建脚本：

```powershell
.\build.ps1
```

如果当前机器的 `pnpm` 二进制链接异常，允许临时直接调用真实入口做排查：

```bash
node node_modules\wxt\bin\wxt.mjs prepare
node node_modules\wxt\bin\wxt.mjs build
node node_modules\typescript\bin\tsc --noEmit
```

## 开发约束
- 默认使用 `pnpm`，不要混用 `npm`
- 改动功能时，优先检查 `background -> service -> component -> docs-site` 是否一致
- 修改导入能力时，要同步检查 `lib/types.ts` 中消息类型是否匹配
- 修改文案时，要同步检查 `_locales/en/messages.json` 与 `_locales/zh_CN/messages.json`
- 修改真实能力边界时，要同步更新 `README` 和 `docs-site/`
- 未在 UI 中暴露的旧功能，不要仅因残留文件存在就继续宣传

## 扩展开发原则
- 这是浏览器扩展项目，优先使用 Chrome 扩展 API 与 WXT 约定的入口方式
- Side Panel 是主入口，新增主要功能时优先考虑放在侧边栏而不是 popup
- 需要跨页面执行的逻辑，优先通过 content script + background message 实现
- 需要无页面 DOM 但仍要解析 HTML 时，优先考虑 offscreen 流程
- 不要引入远程脚本资源，Manifest V3 对 remote code 有严格限制

## 编译排查经验
- 若报 `services/*` 缺失，先确认 `services/` 目录是否完整且被 git 跟踪
- 若报 `defineBackground` 或 `defineContentScript` 未定义，先执行 `wxt prepare`
- 若报 `import.meta.env` 类型错误，先检查 `lib/env.d.ts`
- 若 `build.ps1` 失败，先确认脚本调用的是 `pnpm build`
- 若 `pnpm run build` 找不到 `wxt` 或 `tsc`，优先怀疑本机 `.bin` 链接层异常
- 当前仓库近期已出现过 WXT 构建阶段引用 `_virtual_wxt-html-plugins-*.js` 但产物缺失的问题，排查时优先关注 `wxt.config.ts` 与各个 `entrypoints/*/index.html`
