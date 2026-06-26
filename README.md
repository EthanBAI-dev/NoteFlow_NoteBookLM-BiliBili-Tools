<div align="center">
  <img src="public/icons/icon-128.png" width="128" height="128" alt="NoteFlow Logo">
</div>

<h1 align="center">NoteFlow</h1>

<p align="center">
  <strong>NoteFlow — B站、YouTube、播客、网页、AI 对话，一键批量导入 NotebookLM</strong>
</p>

<p align="center">
  <a href="https://github.com/EthanBAI-dev/NoteFlow_NoteBookLM-BiliBili-Tools">GitHub</a> •
  <a href="https://noteflow.mintlify.app">文档</a> •
  <a href="https://chromewebstore.google.com/detail/noteflow">Chrome Web Store</a> •
  开源 · 免费 · 纯客户端
</p>

---

NotebookLM 是最强的 AI 知识工具，但「把内容喂进去」这一步太痛苦了。**NoteFlow 解决这个问题。**

这是一款 Chrome 扩展（Manifest V3），基于 WXT 框架构建，支持从多源一键批量导入内容到 Google NotebookLM。

## ✨ 核心功能

| 功能 | 说明 |
|------|------|
| 🎬 **Bilibili 字幕导入** | 提取视频 CC 字幕 / AI 字幕，支持逐视频、合并（省配额）、ZIP 下载三种模式 |
| ▶️ **YouTube 导入** | 单个视频、播放列表、频道批量导入，支持 "Load more" 分页加载 |
| 🎙️ **播客导入** | Apple Podcasts 和小宇宙 FM — 自动检测页面，下载音频导入 NotebookLM |
| 📋 **网页导入** | 任意 URL、Substack、微信公众号、X.com 长文 — 正文提取，一键导入 |
| 📚 **文档站导入** | 识别 14+ 文档框架（Docusaurus、VitePress、GitBook 等），全站批量导入或导出 PDF |
| 🤖 **AI 对话导入** | Claude、ChatGPT、Gemini — 自动提取问答对，选择性导入，还支持生成分享卡片 |
| 📡 **RSS 导入** | 任意 RSS/Atom 源，批量导入文章 |
| 🛟 **来源抢救** | 自动检测导入失败和"假性成功"的来源，一键批量修复 |

## 🔥 亮点特性

- **侧面板 UI** — 打开扩展即自动检测当前站点，匹配对应导入工具
- **Google 多账号切换** — 侧面板顶部可切换 NotebookLM 的 Google 账号
- **智能目标 Notebook** — 选择目标 Notebook，内容直接导入无需切换标签页
- **聚合 PDF 导出** — 多篇文章合并为一个 PDF，只占 1 个来源配额，突破 50 来源限制
- **AI 分享卡片** — 将 AI 对话生成为精美分享图片（JPEG / PNG / PDF）
- **导入历史** — 查看所有导入记录，轻松重试
- **隐私优先** — 纯客户端运行，不上传任何数据

## 🖥️ 演示

| 平台 | 链接 |
|------|------|
| 🎬 Bilibili 中文演示 | [BV1QAPqzSEjJ](https://www.bilibili.com/video/BV1QAPqzSEjJ/) |
| 🌐 YouTube Demo | [9gPTuJZRHJk](https://youtu.be/9gPTuJZRHJk) |

## 📦 安装

### Chrome Web Store（推荐）

一键安装，自动更新。

[Chrome Web Store →](https://chromewebstore.google.com/detail/noteflow)

### 从源码构建

```bash
git clone https://github.com/EthanBAI-dev/NoteFlow_NoteBookLM-BiliBili-Tools.git
cd NoteFlow_NoteBookLM-BiliBili-Tools
pnpm install
pnpm build
```

Chrome → `chrome://extensions/` → 开启开发者模式 → 加载已解压的扩展 → 选择 `dist/chrome-mv3`

## 🛠️ 开发

```bash
pnpm dev         # 开发模式，热重载（port 3003）
pnpm build       # 生产构建
pnpm test        # 运行测试
pnpm lint        # ESLint 检查
pnpm compile     # TypeScript 类型检查
pnpm zip         # 打包扩展
pnpm release     # 发布脚本（版本号递增 + git push）
```

## 🏗️ 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | [WXT](https://wxt.dev) + React 18 + TypeScript |
| 构建 | Vite + PostCSS + Tailwind CSS |
| 测试 | Vitest + jsdom + @testing-library/react |
| 设计 | Manifest V3, Chrome Extensions APIs |
| 后端 | Supabase (认证), Google Drive API |
| 文档 | Mintlify |

## 🔒 隐私

- ✅ 完全免费，无需注册登录
- ✅ 纯客户端运行，不上传任何数据
- ✅ [开源代码](https://github.com/EthanBAI-dev/NoteFlow_NoteBookLM-BiliBili-Tools)，可审计
- ✅ 中英双语界面，自动适配

## 📄 许可证

MIT License

---

<p align="center">
  Made with ❤️ for NotebookLM users
</p>
