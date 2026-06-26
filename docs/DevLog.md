---
### 🏁 目标达成归档: 编译修复 + Bilibili 时间戳开关
- **归档时间:** 2026-06-26 15:18
- **项目模块:** 构建系统 / Bilibili 导入流程 / 设置面板
- **标签:** #BugFixed #FeatureAdded
- **归档类型:** 首次归档
- **关联版本:** release-lite (de57b5d)

#### 🎯 目标原貌与背景
系统存在两个严重问题：一是 `pnpm build` 编译失败，卡在 WXT 构建器最后阶段报 `ENOENT: _virtual_wxt-html-plugins-*.js` 缺失，导致所有 HTML 页面（欢迎页、侧边栏、Offscreen 等）均为空白或产物不完整；二是此前用户已实现过的"Bilibili 字幕时间戳消除开关"因代码重构丢失，需重新接入。

#### 🛠️ 关键转折点
- **核心突破口:**
  - 修复编译：定位到 WXT 的 `wxtPluginLoader.mjs` 中 `transformIndexHtml` 会往每个 HTML 注入 `virtual:wxt-html-plugins` 脚本标签，但 Rollup 在实际写输出阶段未能生成对应 chunk 文件 → 直接 Patch WXT 源码禁用此注入。
  - 欢迎页空白：旧欢迎页使用内联 `<script>` 配合 `reveal` 动画样式，但在 Extension MV3 环境下内联脚本不会执行 → 将欢迎页从 WXT HTML entrypoints 移出，放到 `public/` 作为静态页面，同时剥离内联脚本为独立外部 JS 文件。
  - `services/` 目录缺失：从 git 历史恢复并删除已废弃的 RSS parser。
  - Bilibili 时间戳开关：Settings 接口新增 `stripBilibiliTimestamps` 字段，设置面板添加 Toggle UI，中英文 i18n 翻译，所有 Bilibili 导入/下载/合并/Drive 上传流程均传递此参数。
- **被舍弃的方案 (如有):**
  - ~~Vite 插件 intercept：~~ 通过 `resolveId` 和 `load` Hook 拦截 `virtual:wxt-html-plugins` 失败，Rollup 仍尝试查找原始 ID。
  - ~~`modulePreload: false`：~~ 仅消除 HTML 中 preload 标签，但 WXT 构建器仍引用该模块。
  - ~~`transformIndexHtml`：~~ WXT 的插件在 `config.plugins.push` 阶段注册，用户配置的 `enforce` 无法覆盖其 `order: 'pre'` 时序。

#### 💡 经验沉淀
- **技术复盘:**
  - WXT 的 `wxtPluginLoader.mjs` 在 `config.plugins.push()` 阶段才注册，用户配置通过 `enforce: 'pre'` 无法覆盖其 `transformIndexHtml` 时序，必须直接 Patch 源码。
  - 欢迎页这类不需要 WXT/Rollup 预处理的静态页面，不应放在 `entrypoints/` 下，放入 `public/` 更干净、更稳定。
  - 改进后的 `buildSubtitlePlainText` 和 `buildSubtitleMarkdown` 支持 `stripTimestamps` 参数，所有 Bilibili 输出格式（markdown/txt/srt/json）均受控。
- **防复发/可复用指南:**
  - 如果未来 WXT 升级，务必检查 `wxtPluginLoader.mjs` 中 `transformIndexHtml` 是否还注入 `virtual:wxt-html-plugins`——若已修复则撤销 Patch。
  - 新增 HTML 入口页面优先考虑 `public/` 而不是 `entrypoints/`。

---

### 🏁 目标达成归档: Bilibili 时间戳消除开关
- **归档时间:** 2026-06-26 15:18
- **项目模块:** 设置面板 / Bilibili 导入流程
- **标签:** #FeatureAdded
- **归档类型:** 改进迭代

#### 🎯 目标原貌与背景
Bilibili 字幕默认始终是清除时间戳并合并为连贯段落，没有提供保留原始时间戳的选项。用户需要一份设置来控制这个行为，使其可根据需要在"清晰阅读"和"原始时间戳"之间切换。

#### 🛠️ 关键转折点
- **核心突破口:**
  - `lib/settings.ts` 新增 `stripBilibiliTimestamps: boolean` 字段，默认 `true`
  - `components/SettingsPanel.tsx` 添加带 i18n 描述的 Toggle 开关
  - `services/bilibili.ts` 中 `buildSubtitleMarkdown`、`buildSubtitlePlainText`、`convertSubtitleOutput`、`fetchVideoSubtitle` 全部接受 `stripTimestamps` 参数
  - `entrypoints/background.ts` 中所有 Bilibili handler 均读取设置并传递该参数
  - 新增 `buildSubtitleWithTimestamps()` 函数输出 `[MM:SS,mmm]` 格式的原始字幕

#### 💡 经验沉淀
- **技术复盘:**
  - 设置链路过长时，避免每个 handler 都手动 `await getSettings()`——当前每个 Bilibili handler 都独立调用了，后续可考虑 background 启动时缓存一次设置，但当前改动量可控。
  - i18n 新增翻译键 `settings.stripTimestamps` 和 `settings.stripTimestampsDesc`，中英文均已添加。
