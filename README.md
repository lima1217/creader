# CReader

本地优先的 EPUB 阅读器：书库、阅读进度、上下文 AI 对话和 Markdown Reading Memory 都留在本机。

## 功能

- EPUB 阅读、目录跳转、进度恢复、选区捕获和章节上下文 AI 对话
- 整本连续滚动阅读：`flow=scrolled` + 章节边界自动翻页 + 相邻章节预取，配合全书进度条拖动跳转（ADR-0021）
- 章节边界 arm 指示：滚到章末/章首累积滚动意图，由 hairline 进度条提示即将翻章
- 内置阅读字体：Roboto（拉丁）和 LXGW WenKai（中文），按 section 语言自动选择 Latin-first 或 CJK-first 字体栈
- 书库导入（侧栏 / 窗口拖拽 EPUB）、封面提取、书本文件夹整理（单一归属，拖拽移动）
- 亮色 / 暗色主题、字号调节、阅读进度恢复
- OpenAI-compatible HTTP AI provider 配置和流式对话
- 选区、进度、CFI、章节上下文和最近聊天记录驱动的 AI 对话
- AI 审稿后选择性写入本地 Reading Memory Markdown 仓库
- foliate-js 阅读引擎；不执行 EPUB 内嵌脚本，也不提供兼容 fallback

## 开发

```bash
npm install
npm run dev
npm run tauri dev
```

`npm run dev` 只启动 Vite 前端；需要本地文件、书库、AI provider 和 Reading Memory commands 时，使用 `npm run tauri dev`。

## 验证

```bash
npm run typecheck
npm run test
npm run build
npm run check
```

## 项目结构

```text
src/                  React/Vite 前端
src/components/       阅读器 chrome、侧栏、工具栏、AI 面板、设置面板
src/components/reader/ EPUB 进度、选区、键盘、主题、字体、边界指示、进度条、生命周期 hooks
src/components/ai/    AI 消息渲染、流缓冲、会话记忆、上下文窗口、快捷提示词
src/domain/           AI 请求、阅读上下文快照、上下文裁剪、Reading Memory Markdown 纯逻辑
src/services/         IndexedDB、本地存储、导入、封面、聊天持久化、阅读引擎
src/services/reader/  foliate-js adapter、字体加载、section 排版、章节文本提取
src/theme/            Paper Workspace 调色板（chrome 与书体单一来源）
src-tauri/            Tauri shell、Rust commands、文件边界、AI provider 存储、Reading Memory 写入
public/fonts/         内置 Roboto / LXGW WenKai woff2 字体资源
docs/adr/             架构决策记录
releases/             打包产物（打包 / 发布任务之外不可编辑）
```

## 阅读引擎

CReader 通过 `src/services/reader/readingEngine.ts` 的 adapter contract 读取 EPUB。当前只支持 `foliate-js`：章节导航、上一页/下一页、阅读进度、文本选区、主题注入、布局切换都经由这一条阅读引擎边界。无法由 foliate-js 打开的 EPUB 会明确失败，不会静默切换到另一个 renderer。

阅读布局固定为 `flow=scrolled`（ADR-0021）。整本连续滚动的体验由三部分组成：foliate 原生 section 内滚动、滚到章节边界时由 adapter 触发翻页并预取相邻章节、应用自绘的**全书进度条**提供整本书的位置感（原生滚动条只反映当前章节）。进度条拖动通过 `seekToFraction` 跳转，章节刻度来自 `getSectionFractions`。CReader 不构建自定义连续 renderer，也不在用户设置里暴露 `flow` 选项。

CReader 不提供全书搜索（ADR-0018）。在书中定位内容时，使用目录跳转、全书进度条、翻页，或将选区 / 当前章节发送给 AI 面板。Rust 端的章节文本提取是按需的 AI 工具能力，不是阅读器搜索界面。

## 主题与字体

只有 `light`（亮色）和 `dark`（暗色）两种主题；Sepia/护眼 已在 Astryx Phase 1 退役（ADR-0017）。一套暖色 Paper Workspace 调色板同时驱动 chrome token（`src/index.css` 的 `--bg-*` / `--text-*` / `--accent`）和 Astryx `--color-*` token（`src/theme/paperTheme.ts`）。书体三色（背景 / 文字 / 链接）在 `paperBodyPalette` 中作为单一来源，chrome 和 foliate section 文档共用同一份；engine bridge 注入字面色值而非 `var(--color-*)`，因为 foliate section 文档不继承宿主 `:root`。

阅读字体为内置 Roboto（拉丁）+ LXGW WenKai（中文）混合栈，按每个 section 的语言选择 Latin-first 或 CJK-first 栈；CJK 段落带首行缩进和按语言调整的行高。字体选择 UI 和自定义字体导入已移除，全部走内置字体。

## 本地数据

CReader 使用 IndexedDB/Dexie 保存封面、设置、书库、阅读进度、快捷提示词、书库文件夹展开状态、聊天消息和 Conversation Memory。旧版本为 epubjs generated locations 建过 `locations` object store；现在阅读进度来自 foliate-js 的位置事件，Dexie v7 在迁移时删除了旧 `locations` store。v8 把 settings / library / progress / quickActions / libraryOrganizerExpandedFolders 等应用偏好从 localStorage 收敛进 `appPrefs` store，启动时一次性迁入遗留的 localStorage 偏好。不要把 IndexedDB cache 当成书籍内容来源。

## AI

AI provider 在设置面板配置为 `{ id, name, baseUrl, model }`。Provider 配置存在应用配置目录的 `ai_providers.json`，API key 存在同目录的 `ai_keys.env`，不会回显到 UI，也不进入仓库。

前端发送聊天请求时只携带用户问题、冻结的阅读上下文、会话摘要和最近 N 条聊天记录；活跃 provider、model 和 API key 由后端解析。后端使用 `async-openai` 调 OpenAI-compatible Chat Completions。前端通过 Tauri channel 接收 `started` / `chunk` / `done` / `error` 事件。

AI 面板只保留阅读对话本身：消息流、快捷提示词和输入框。Provider、模型、AI 字号、上下文窗口、Reading Memory 路径和快捷提示词管理都在设置面板里。

## Reading Memory

Reading Memory 是用户选择的本地 Markdown 仓库。CReader 会初始化 OKF-compatible LLM Wiki 结构，并只在 AI 判断内容有长期阅读价值时写入当前书的 `books/<book-slug>/` 子包。普通总结、翻译、短追问和闲聊默认跳过。

写入流程分两层：

- TypeScript 使用 unified / remark / YAML 从结构化 Note Intent 生成或重写 OKF Markdown。
- Rust 验证仓库路径、限制可写目录、写入文件并追加 `.reading-memory/ingestion-log.jsonl`。

自动写入会保留来源线索：书名、作者、章节、阅读进度、CFI、选中文本或问题，以及 AI 回答。EPUB 选区的 CFI range 会和纯文本上下文分开保存，用于后续溯源。
