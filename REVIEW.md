# CReader 代码 Review 与改动说明

本文档用于向团队同步本次对 CReader 的审阅结论与已落地的改动，重点覆盖：安全边界、稳定性/性能、可维护性、测试与工程化。

## 背景与目标

本仓库为 Tauri 2.x + Vite/React/TypeScript + epub.js 的本地 EPUB 阅读器，并在 Rust 后端通过本机 CLI（droid/claude/gemini/openai）提供 AI 助手能力。

本次改动目标：
- 收紧桌面 WebView 的安全边界，降低“恶意 EPUB / 恶意 AI 输出”带来的攻击面
- 避免 AI 调用卡死、降低阅读/搜索等功能的卡顿与存储膨胀风险
- 抽出可复用的模块，降低大组件复杂度，统一存储逻辑
- 增加最小可用测试与脚本，确保后续迭代可回归验证

## 改动摘要（给非研发同学）

- 更安全：不再允许 AI 输出注入 HTML 执行；默认禁用 EPUB 内脚本；不再允许前端读取全盘任意文件
- 更稳：AI 调用加入超时并改为异步；阅读进度与章节内容提取做节流；搜索可取消
- 更轻：封面不再用 base64 塞进 localStorage，改存 IndexedDB；locations 生成结果缓存
- 更好维护：新增统一存储层 LocalStore；Reader 的 locations/search 逻辑下沉为模块
- 有测试：新增 Vitest 单测与 Rust 单测；新增 `npm test`/`npm run typecheck`

## 主要风险点与应对

### 1) WebView 安全边界（P0）

风险来源：
- CSP 被关闭会放大 XSS/注入风险
- FS 权限过宽（允许读取 `/**`）会使一旦发生注入即有“全盘文件读取”后果
- EPUB 渲染允许脚本执行，恶意 EPUB 可利用脚本进行更复杂攻击
- AI 输出使用 HTML 注入渲染（dangerouslySetInnerHTML），模型输出若包含 HTML 会直入 DOM

落地措施：
- 配置 CSP（不再为 null）：`src-tauri/tauri.conf.json`
- 收紧 FS capability（移除 `/**`）：`src-tauri/capabilities/default.json`
- 禁用 EPUB 脚本：`src/components/Reader.tsx`
- 移除 AI HTML 注入，改为安全的文本节点解析渲染：`src/components/AIPanel.tsx`

### 2) 稳定性/性能（P1）

风险来源：
- Rust 后端在 async 命令中同步 `Command::output()`，可能阻塞并让 UI“假死”
- locations 每次生成成本高且未缓存
- 搜索逻辑遍历 spine 且无法取消，可能长时间占用主线程
- 把封面 base64 与大量状态写入 localStorage，容易触发配额与卡顿

落地措施：
- AI CLI 调用改为 tokio 异步进程并加入超时：`src-tauri/src/lib.rs`（新增依赖 tokio）
- locations 缓存：`src/services/reader/locationsCache.ts` + Reader 接入
- 搜索抽离并支持取消：`src/services/reader/search.ts` + Reader 接入
- 进度/章节内容提取节流：`src/components/Reader.tsx`
- 封面迁移到 IndexedDB：`src/services/CoverStore.ts` + `App.tsx`/`Sidebar.tsx`/`AppContext.tsx` 接入

## 详细变更清单（按模块）

### A. 安全相关

1) CSP 恢复
- 文件：`src-tauri/tauri.conf.json`
- 变化：`security.csp` 从 `null` 改为启用（包含 dev 需要的 localhost/ws 规则）

2) FS 权限收紧
- 文件：`src-tauri/capabilities/default.json`
- 变化：移除允许读取 `/**`，保留 HOME/DOCUMENT/DESKTOP/DOWNLOAD 等范围

3) EPUB 脚本禁用
- 文件：`src/components/Reader.tsx`
- 变化：`allowScriptedContent` 设置为 `false`

4) AI 消息渲染安全化
- 文件：`src/components/AIPanel.tsx`
- 变化：移除 `dangerouslySetInnerHTML`，用 React 节点渲染 `**bold**`、`*italic*`、`` `code` ``

### B. 性能与稳定性

1) AI CLI 调用异步化 + 超时
- 文件：`src-tauri/src/lib.rs`，`src-tauri/Cargo.toml`
- 变化：
  - 使用 `tokio::process::Command` 异步执行
  - 增加 60 秒超时（超时会返回失败并走 provider 回退）

2) 阅读进度与章节内容提取节流
- 文件：`src/components/Reader.tsx`
- 变化：减少频繁 updateBookProgress 与 setCurrentChapterContent 导致的写入/渲染压力

3) locations 生成缓存
- 文件：`src/services/reader/locationsCache.ts`，`src/components/Reader.tsx`
- 变化：按 `creader-locations:${bookId}` 缓存 locations 的序列化结果，优先 load，缺失再 generate

4) 搜索逻辑可取消 + 下沉
- 文件：`src/services/reader/search.ts`，`src/components/Reader.tsx`
- 变化：搜索时检查 token 以支持取消（关闭搜索框/按 Esc 等）

5) 封面存储迁移（减轻 localStorage）
- 文件：
  - `src/services/CoverStore.ts`
  - `src/utils/epub.ts`（metadata 不再返回 base64，改返回 Blob）
  - `src/App.tsx`（导入时写入 IndexedDB）
  - `src/components/Sidebar.tsx`（渲染时按需加载 Blob URL）
  - `src/stores/AppContext.tsx`（旧数据 dataURL -> IndexedDB 的迁移与删除清理）
- 变化：Book 类型新增 `coverKey?: string`（`src/types/index.ts`）

### C. 可维护性/结构整理

1) 统一 LocalStorage 读写工具
- 文件：`src/services/LocalStore.ts`
- 变化：
  - 引入“带版本 Envelope”的序列化格式（同时兼容旧的非 Envelope 数据）
  - SyncService 与 AppContext 共用同一份 storage keys 与 load/save

2) Reader 逻辑模块化
- 文件：
  - `src/services/reader/types.ts`
  - `src/services/reader/locationsCache.ts`
  - `src/services/reader/search.ts`
  - `src/components/Reader.tsx`
- 变化：把 locations/search 的复杂逻辑从 Reader 拆出，Reader 只负责编排与 UI

### D. 测试与工程化

1) 前端测试框架
- 文件：`package.json`、`vitest.config.ts`
- 新增：Vitest + jsdom；脚本 `npm test`、`npm run typecheck`

2) 单测
- 前端：`src/services/LocalStore.test.ts`（验证兼容旧存储与默认值行为）
- 后端：`src-tauri/src/lib.rs`（build_prompt 截断与上下文拼装行为）

## 行为变化与兼容性注意

- **安全策略更严格**：如果某些 EPUB 依赖脚本交互，可能不再可用（这是有意为之的默认安全策略）。
- **文件读取范围更窄**：非 HOME/DOCUMENT/DESKTOP/DOWNLOAD 位置的文件，可能无法直接读取（取决于 Tauri FS capability）。
- **封面迁移**：
  - 旧版本如果把封面以 base64 存在 localStorage，本次会在启动后自动迁移至 IndexedDB（失败会保留原状并打印错误到 console）。
  - 删除书籍会尝试同步删除 IndexedDB 中的封面条目。
- **存储格式升级**：LocalStore 对新写入采用 envelope，但仍兼容读取旧 JSON（无需用户手动清理）。

## 如何验证（建议团队自测清单）

1) 导入 EPUB（拖拽/对话框）正常，书库展示封面正常
2) 打开书籍：目录跳转、翻页、进度恢复正常
3) 选中文本按 `A` 打开 AI，能正常对话；AI 回复中包含 `<script>` 或 HTML 字符不会执行
4) Cmd+F 搜索可用，关闭搜索框/按 Esc 可中止搜索，不应长时间卡顿
5) 多本书场景下 localStorage 不应因封面而迅速膨胀

## 已验证的构建/测试结果

- 前端：`npm run build` 通过
- 前端：`npm test` 通过
- Rust：`cargo check` / `cargo test` 通过

## 相关文件索引

- 安全：`src-tauri/tauri.conf.json`、`src-tauri/capabilities/default.json`、`src/components/AIPanel.tsx`、`src/components/Reader.tsx`
- AI 后端：`src-tauri/src/lib.rs`、`src-tauri/Cargo.toml`
- 存储/封面：`src/services/LocalStore.ts`、`src/services/CoverStore.ts`、`src/stores/AppContext.tsx`
- Reader 模块：`src/services/reader/*`、`src/components/Reader.tsx`
- 测试：`vitest.config.ts`、`src/services/LocalStore.test.ts`

