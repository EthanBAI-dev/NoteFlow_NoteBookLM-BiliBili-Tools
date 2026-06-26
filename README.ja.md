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
  <strong>Bilibili、YouTube、ポッドキャスト、Webページ、AI会話を NotebookLM に一括インポート</strong>
</p>

<p align="center">
  <a href="https://github.com/EthanBAI-dev/NoteFlow_NoteBookLM-BiliBili-Tools">GitHub</a> •
  <a href="https://noteflow.mintlify.app">ドキュメント</a> •
  <a href="https://chromewebstore.google.com/detail/noteflow">Chrome Web Store</a> •
  オープンソース · 無料 · クライアントサイドのみ
</p>

---

NoteFlow は、Google NotebookLM にさまざまなソースからコンテンツを一括インポートする Chrome 拡張機能（Manifest V3、WXT フレームワーク）です。

## ✨ 機能

| 機能 | 説明 |
|------|------|
| 🎬 **Bilibili 字幕** | CC/自動生成字幕を抽出 — 動画別、統合（割当節約）、ZIP ダウンロード |
| ▶️ **YouTube** | 動画、プレイリスト、チャンネルを一括インポート、「Load more」ページング対応 |
| 🎙️ **ポッドキャスト** | Apple Podcasts / 小宇宙 FM — ページ自動検出、音声ダウンロード |
| 📋 **Web ページ** | 任意 URL、Substack、WeChat、X.com — 本文抽出、ワンクリックインポート |
| 📚 **ドキュメントサイト** | 14+ フレームワーク対応 — 全サイト一括インポートまたは PDF 出力 |
| 🤖 **AI 会話** | Claude、ChatGPT、Gemini — QA ペア抽出、選択的インポート、共有カード |
| 📡 **RSS** | RSS/Atom フィードから記事を一括インポート |
| 🛟 **修復** | インポート失敗や「成功に見える失敗」を自動検出、一括修正 |

## 🔥 ハイライト

- **サイドパネル UI** — 現在のサイトを自動検出し、適切なインポートツールを表示
- **マルチアカウント** — サイドパネルから NotebookLM の Google アカウントを切替
- **ターゲット Notebook** — Notebook を選択すれば直接インポート、タブ切替不要
- **PDF 集約** — 複数記事を1つの PDF に統合、たった1ソーススロット
- **AI 共有カード** — AI 会話を美しい画像として出力（JPEG / PNG / PDF）
- **インポート履歴** — 全履歴を確認、簡単にリトライ
- **プライバシー重視** — 100% クライアントサイド、データは一切アップロードされません

## 🖥️ デモ

| プラットフォーム | リンク |
|----------------|--------|
| 🌐 YouTube Demo | [9gPTuJZRHJk](https://youtu.be/9gPTuJZRHJk) |
| 🎬 Bilibili デモ | [BV1QAPqzSEjJ](https://www.bilibili.com/video/BV1QAPqzSEjJ/) |

## 📦 インストール

### Chrome Web Store（推奨）

[Chrome Web Store →](https://chromewebstore.google.com/detail/noteflow)

### ソースからビルド

```bash
git clone https://github.com/EthanBAI-dev/NoteFlow_NoteBookLM-BiliBili-Tools.git
cd NoteFlow_NoteBookLM-BiliBili-Tools
pnpm install
pnpm build
```

Chrome → `chrome://extensions/` → デベロッパーモード → パッケージ化されていない拡張機能を読み込む → `dist/chrome-mv3` を選択

## 🛠️ 開発

```bash
pnpm dev         # 開発モード（HMR、port 3003）
pnpm build       # プロダクションビルド
pnpm test        # テスト実行
pnpm lint        # ESLint
pnpm compile     # TypeScript チェック
pnpm zip         # 拡張機能をパッケージ化
pnpm release     # リリーススクリプト
```

## 🏗️ 技術スタック

| カテゴリ | 技術 |
|----------|------|
| フレームワーク | [WXT](https://wxt.dev) + React 18 + TypeScript |
| ビルド | Vite + PostCSS + Tailwind CSS |
| テスト | Vitest + jsdom + @testing-library/react |
| アーキテクチャ | Manifest V3, Chrome Extensions APIs |
| バックエンド | Supabase (認証), Google Drive API |
| ドキュメント | Mintlify |

## 🔒 プライバシー

- ✅ 完全無料、サインアップ不要
- ✅ 100% クライアントサイド — データは一切アップロードされません
- ✅ [オープンソース](https://github.com/EthanBAI-dev/NoteFlow_NoteBookLM-BiliBili-Tools)、監査可能
- ✅ 日英バイリンガル UI

## 📄 ライセンス

MIT License

---

<p align="center">
  ❤️ を込めて Ethan より
</p>
