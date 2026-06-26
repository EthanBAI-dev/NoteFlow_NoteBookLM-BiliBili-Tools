<div align="center">
  <img src="public/icons/icon-128.png" width="128" height="128" alt="NoteFlow Logo">
</div>

<h1 align="center">NoteFlow</h1>

<p align="center">
  <a href="README.md">English</a> •
  <a href="README.zh.md">简体中文</a> •
  <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <strong>Batch import Bilibili, YouTube, podcasts, web pages & AI chats into NotebookLM — one click</strong>
</p>

<p align="center">
  <a href="https://github.com/EthanBAI-dev/NoteFlow_NoteBookLM-BiliBili-Tools">GitHub</a> •
  <a href="https://noteflow.mintlify.app">Docs</a> •
  <a href="https://chromewebstore.google.com/detail/noteflow">Chrome Web Store</a> •
  Open Source · Free · Client-Side Only
</p>

---

NotebookLM is the best AI knowledge tool, but getting content into it is painful. **NoteFlow fixes that.**

A Chrome extension (Manifest V3) built with the WXT framework that batch-imports content from multiple sources into Google NotebookLM.

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🎬 **Bilibili Subtitles** | Extract CC/AI subtitles — per-video, merged (saves quota), or ZIP download |
| ▶️ **YouTube Import** | Videos, playlists, channels — batch import with "Load more" pagination |
| 🎙️ **Podcast Import** | Apple Podcasts & Xiaoyuzhou FM — auto-detect page, download audio |
| 📋 **Web Import** | Any URL, Substack, WeChat, X.com articles — extract & import in one click |
| 📚 **Doc Sites** | 14+ frameworks (Docusaurus, VitePress, GitBook, etc.) — batch import or PDF export |
| 🤖 **AI Chat Import** | Claude, ChatGPT, Gemini — auto-extract Q&A pairs, selective import, share cards |
| 📡 **RSS Import** | Any RSS/Atom feed — batch import articles |
| 🛟 **Rescue** | Auto-detect failed & "fake success" sources, batch-fix in one click |

## 🔥 Highlights

- **Side Panel UI** — Auto-detects the current site and matches the right import tool
- **Multi-Account** — Switch NotebookLM Google accounts from the side panel header
- **Target Notebook** — Select a notebook, import directly without switching tabs
- **PDF Aggregation** — Merge articles into one PDF, takes only 1 source slot
- **AI Share Cards** — Export AI conversations as beautiful images (JPEG / PNG / PDF)
- **Import History** — Review all records, easily retry
- **Privacy First** — 100% client-side, no data uploaded

## 🖥️ Demos

| Platform | Link |
|----------|------|
| 🌐 YouTube Demo | [9gPTuJZRHJk](https://youtu.be/9gPTuJZRHJk) |
| 🎬 Bilibili Demo | [BV1QAPqzSEjJ](https://www.bilibili.com/video/BV1QAPqzSEjJ/) |

## 📦 Installation

### Chrome Web Store (Recommended)

[Chrome Web Store →](https://chromewebstore.google.com/detail/noteflow)

### Build from Source

```bash
git clone https://github.com/EthanBAI-dev/NoteFlow_NoteBookLM-BiliBili-Tools.git
cd NoteFlow_NoteBookLM-BiliBili-Tools
pnpm install
pnpm build
```

Chrome → `chrome://extensions/` → Developer mode → Load unpacked → Select `dist/chrome-mv3`

## 🛠️ Development

```bash
pnpm dev         # Dev mode with HMR (port 3003)
pnpm build       # Production build
pnpm test        # Run tests
pnpm lint        # ESLint
pnpm compile     # TypeScript check
pnpm zip         # Package extension
pnpm release     # Release script (bump version + git push)
```

## 🏗️ Tech Stack

| Category | Technology |
|----------|-----------|
| Framework | [WXT](https://wxt.dev) + React 18 + TypeScript |
| Build | Vite + PostCSS + Tailwind CSS |
| Testing | Vitest + jsdom + @testing-library/react |
| Architecture | Manifest V3, Chrome Extensions APIs |
| Backend | Supabase (Auth), Google Drive API |
| Docs | Mintlify |

## 🔒 Privacy

- ✅ Completely free, no sign-up required
- ✅ 100% client-side — no data uploaded
- ✅ [Open source](https://github.com/EthanBAI-dev/NoteFlow_NoteBookLM-BiliBili-Tools), fully auditable
- ✅ Bilingual UI (English & Chinese)

## 📄 License

MIT License

---

<p align="center">
  Made with ❤️ by Ethan
</p>
