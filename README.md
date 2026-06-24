<div align="center">
  <img src="public/icons/icon-128.png" width="128" height="128" alt="NoteFlow Logo">
</div>

<h1 align="center">NoteFlow</h1>

<p align="center">
  <strong>一键导入哔哩哔哩、YouTube、播客、网页、AI 对话到 NotebookLM</strong>
</p>

<p align="center">
  <a href="https://github.com/crazynomad/noteflow">GitHub</a> •
  开源 · 免费 · 为知识工作者而生
</p>

---

NoteFlow 是一款 Chrome 扩展，解决 Google NotebookLM "喂不进去"的问题——帮你把各种来源的内容一键导入 NotebookLM。

## ✨ 功能

| 功能 | 说明 |
|------|------|
| 🎬 **B站字幕导入** | 导入哔哩哔哩视频字幕与弹幕，导出为 TXT |
| 🌐 **YouTube 导入** | 粘贴链接，批量选择视频导入 |
| 🎙️ **播客导入** | 粘贴小宇宙链接，获取单集导入 |
| 📋 **网页导入** | 列出所有浏览器标签页，勾选批量导入 |
| 💬 **AI 对话导入** | 提取 Claude/ChatGPT/Gemini 对话 |
| ⚡ **后台批量** | 并行导入，进度实时显示 |
| 🔑 **多账号** | Google 账号切换，笔记本选择 |

## 🚀 安装

```bash
git clone https://github.com/crazynomad/noteflow.git
cd noteflow
pnpm install
pnpm build
```

Chrome → `chrome://extensions/` → 开发者模式 → 加载 `dist/chrome-mv3`

## 🔒 隐私

纯客户端运行，不上传任何数据。开源可审计。
