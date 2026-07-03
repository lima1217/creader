# CReader

本地优先的 EPUB 阅读器：书库、阅读进度、上下文 AI 对话和 Markdown Reading Memory 都留在本机。

## 功能

- EPUB 阅读、目录跳转、进度恢复、选区捕获和全文搜索
- 书库导入、封面提取、标签分类
- 日间、夜间、护眼主题和字号调节
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
src/            React/Vite 前端
src/components/ 阅读器、侧栏、工具栏、AI 面板、设置面板
src/domain/     AI 请求、上下文裁剪、Reading Memory Markdown 纯逻辑
src/services/   IndexedDB、本地存储、导入、封面、聊天持久化、阅读引擎和搜索
src-tauri/      Tauri shell 和 Rust commands
public/         Vite 静态资源
```

## 阅读引擎

CReader 通过 `src/services/reader/readingEngine.ts` 的 adapter contract 读取 EPUB。当前只支持 `foliate-js`：章节导航、上一页/下一页、阅读进度、文本选区、Search Locator 跳转和主题注入都经由这一条阅读引擎边界。无法由 foliate-js 打开的 EPUB 会明确失败，不会静默切换到另一个 renderer。

全文搜索是可重建的派生索引，不是书籍内容或 AI 上下文的 source of truth。搜索结果可能携带精确 CFI，也可能退化为 href/spine 级定位。

## 本地数据

CReader 使用 IndexedDB/Dexie 保存封面、聊天消息和 Conversation Memory。旧版本为 epubjs generated locations 建过 `locations` object store；现在阅读进度来自 foliate-js 的位置事件，Dexie v7 会在迁移时删除旧 `locations` store。搜索索引仍是可重建数据，丢失后应通过搜索索引状态和重建动作恢复，而不是把 IndexedDB cache 当成书籍内容来源。

## AI

AI provider 在设置面板配置为 `{ id, name, baseUrl, model }`。Provider 配置存在应用配置目录的 `ai_providers.json`，API key 存在同目录的 `ai_keys.env`，不会回显到 UI，也不进入仓库。

前端发送聊天请求时只携带用户问题、冻结的阅读上下文、会话摘要和最近 N 条聊天记录；活跃 provider、model 和 API key 由后端解析。后端使用 `async-openai` 调 OpenAI-compatible Chat Completions，并在 typed stream 不兼容时回退到兼容 SSE parser。前端通过 Tauri channel 接收 `started` / `chunk` / `done` / `error` 事件。

AI 面板只保留阅读对话本身：消息流、快捷提示词和输入框。Provider、模型、AI 字号、上下文窗口、Reading Memory 路径和快捷提示词管理都在设置面板里。

## Reading Memory

Reading Memory 是用户选择的本地 Markdown 仓库。CReader 会初始化 OKF-compatible LLM Wiki 结构，并只在 AI 判断内容有长期阅读价值时写入当前书的 `books/<book-slug>/` 子包。普通总结、翻译、短追问和闲聊默认跳过。

写入流程分两层：

- TypeScript 使用 unified / remark / YAML 从结构化 Note Intent 生成或重写 OKF Markdown。
- Rust 验证仓库路径、限制可写目录、写入文件并追加 `.reading-memory/ingestion-log.jsonl`。

自动写入会保留来源线索：书名、作者、章节、阅读进度、CFI、选中文本或问题，以及 AI 回答。EPUB 选区的 CFI range 会和纯文本上下文分开保存，用于后续溯源。
