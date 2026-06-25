# NoteFlow 项目规范（同步自 CLAUDE.md）

## 项目概述
**NoteFlow** — Chrome 扩展 (Manifest V3)，从多源导入内容到 Google NotebookLM。支持 Bilibili、YouTube、播客(小宇宙)、网页、AI对话(Claude/ChatGPT/Gemini)和URL。基于 WXT 框架构建。

## 开发命令
```bash
pnpm install     # 安装依赖
pnpm dev         # 开发模式 (热重载, port 3003)
pnpm build       # 生产构建到 dist/
pnpm zip         # 打包扩展
pnpm compile     # TypeScript 类型检查
pnpm test        # 运行单元测试 (vitest)
pnpm test:watch  # 监视模式运行测试
pnpm lint        # ESLint
pnpm release     # 发布脚本
```

## 架构

### 扩展结构 (WXT 框架)
- **Background Service Worker** (`entrypoints/background.ts`): 中央消息中心 (25+ 消息类型)
- **Content Scripts**: `entrypoints/notebooklm.content.ts`, `claude.content.ts`, `chatgpt.content.ts`, `gemini.content.ts`
- **Offscreen Document** (`entrypoints/offscreen/`): HTML→Markdown 转换 (Turndown)
- **Popup UI** (`entrypoints/popup/`): React 应用，6标签布局

### 关键服务
- `services/notebooklm.ts`: Tab管理、批量导入(1.5s延迟)
- `services/pdf-generator.ts`: 文档站点→PDF (CDP, 5并发)
- `services/podcast.ts`: Apple Podcasts + 小宇宙 FM
- `services/bookmarks.ts`: 稍后阅读系统

### 添加新导入源步骤
1. `lib/types.ts` 添加类型 → 2. `wxt.config.ts` 添加 host → 3. `entrypoints/` 创建 content script → 4. `services/` 创建服务 → 5. `components/` 创建 UI → 6. `background.ts` 添加消息处理 → 7. `popup/App.tsx` 添加标签页

## 测试
- 框架: Vitest + jsdom + @testing-library/react
- 单元测试: `tests/services/` 和 `tests/lib/`
- E2E: `scripts/test-e2e.mjs`

## 架构约束 (纯客户端)
- ✅ 静态/SSR 页、有 sitemap/llms.txt 的文档站、公开 RSS/API
- ❌ 重度 SPA、需鉴权的私密内容、反爬站点
