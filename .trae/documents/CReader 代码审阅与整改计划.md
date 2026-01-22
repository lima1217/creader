## 审阅结论
- CReader 的整体架构很清晰：前端 React/Vite 负责阅读器与 UI，后端 Tauri(Rust) 负责本地能力与 AI CLI 调用（见 [App.tsx](file:///Users/lima/Downloads/creader/src/App.tsx)、[Reader.tsx](file:///Users/lima/Downloads/creader/src/components/Reader.tsx)、[lib.rs](file:///Users/lima/Downloads/creader/src-tauri/src/lib.rs)）。
- 当前最大风险集中在“WebView 安全边界被削弱 + 不受信任内容渲染”：CSP 关闭、EPUB 脚本允许、FS 权限过宽、AI 输出以 HTML 注入（见 [tauri.conf.json](file:///Users/lima/Downloads/creader/src-tauri/tauri.conf.json#L27-L30)、[default.json](file:///Users/lima/Downloads/creader/src-tauri/capabilities/default.json#L13-L34)、[Reader.tsx](file:///Users/lima/Downloads/creader/src/components/Reader.tsx#L162-L172)、[AIPanel.tsx](file:///Users/lima/Downloads/creader/src/components/AIPanel.tsx#L164-L178)）。
- 性能瓶颈主要来自 locations 生成与全文搜索实现方式，以及把封面 base64 和大量状态塞进 localStorage（见 [Reader.tsx](file:///Users/lima/Downloads/creader/src/components/Reader.tsx)、[epub.ts](file:///Users/lima/Downloads/creader/src/utils/epub.ts)、[AppContext.tsx](file:///Users/lima/Downloads/creader/src/stores/AppContext.tsx)）。

## 主要问题清单（按优先级）
- **P0 安全**
  - CSP 显式为 null（[tauri.conf.json](file:///Users/lima/Downloads/creader/src-tauri/tauri.conf.json#L27-L30)）。
  - FS capability 允许读取 `/**`（[default.json](file:///Users/lima/Downloads/creader/src-tauri/capabilities/default.json#L13-L34)）。
  - EPUB 渲染允许脚本 `allowScriptedContent: true`（[Reader.tsx](file:///Users/lima/Downloads/creader/src/components/Reader.tsx#L162-L172)）。
  - AI 回复使用 `dangerouslySetInnerHTML` 且未做 HTML 转义/消毒（[AIPanel.tsx](file:///Users/lima/Downloads/creader/src/components/AIPanel.tsx#L164-L178)）。
- **P1 稳定性/性能**
  - Rust 侧在 async 命令里同步 `Command::output()`，缺少 timeout，易卡住 UI/命令线程（[lib.rs](file:///Users/lima/Downloads/creader/src-tauri/src/lib.rs#L157-L407)）。
  - locations 生成未缓存；全文搜索遍历 spine 且带大量日志（[Reader.tsx](file:///Users/lima/Downloads/creader/src/components/Reader.tsx)）。
  - 封面 base64 与库状态持久化 localStorage，易触发配额/卡顿（[epub.ts](file:///Users/lima/Downloads/creader/src/utils/epub.ts#L36-L56)、[AppContext.tsx](file:///Users/lima/Downloads/creader/src/stores/AppContext.tsx#L122-L132)）。
- **P2 可维护性**
  - `Reader.tsx` 过大、关注点混杂；epub.js 使用大量 any（[Reader.tsx](file:///Users/lima/Downloads/creader/src/components/Reader.tsx)、[epub.ts](file:///Users/lima/Downloads/creader/src/utils/epub.ts)）。
  - SyncService 与 AppContext 的存储/同步逻辑重复且目前未接入（[SyncService.ts](file:///Users/lima/Downloads/creader/src/services/SyncService.ts)）。
- **P3 工程化/测试**
  - 前端/后端几乎无测试与脚本支持（[package.json](file:///Users/lima/Downloads/creader/package.json#L6-L28)）。

## 拟执行改造计划（你确认后我再开始落地修改）
### 1) 安全加固（优先做）
- 恢复并收紧 CSP：为 prod 配置合理的 `default-src/script-src/style-src/img-src`；dev 保持可用但不放开到 null。
- 收紧 FS 权限：移除 `/**`；仅保留 $HOME/$DOCUMENT/$DOWNLOAD 等必要范围，或改成“只允许用户对话框选择过的文件路径”工作流。
- 默认禁用 EPUB 脚本：将 `allowScriptedContent` 设为 false，并补一个“允许脚本（不安全）”的设置开关（避免破坏部分书籍交互）。
- 移除 `dangerouslySetInnerHTML`：用“纯文本 + 安全的轻量格式化渲染”（先 HTML escape，再做 **/*/` 的 token 解析生成 React 节点），确保模型输出无法注入 HTML。

### 2) 稳定性与性能
- Rust AI 调用改为后台线程/`spawn_blocking` + 超时：避免 `Command::output()` 卡住；prompt 通过 stdin 传入以避免超长 argv。
- 进度更新节流：减少频繁写入 state/localStorage。
- locations 缓存：按 bookId 缓存生成结果（或按章节粒度），首次异步生成，UI 先用近似进度。
- 搜索改为增量/可取消：限制并发与加载，减少日志，必要时迁到 Web Worker。
- 封面与大对象存储策略：从 localStorage 迁到 IndexedDB/文件缓存（保持库元数据小而稳定）。

### 3) 架构整理（不改变功能前提下）
- 拆分 Reader：拆成 EpubLoader / RenditionController / ProgressTracker / SearchController / SelectionController 等小模块。
- 统一存储层：把 AppContext 与 SyncService 的存储键/版本化/序列化逻辑合并为单一模块，避免分叉。
- 强化类型：补齐 epub.js 关键类型（已经有 [epubjs.d.ts](file:///Users/lima/Downloads/creader/src/types/epubjs.d.ts) 但可继续完善），减少 any。

### 4) 测试与基本工程化
- 增加最小单测集：
  - 前端：存储读写、AI 输出渲染（防注入）、进度节流逻辑。
  - Rust：prompt 构建、provider 选择与回退逻辑。
- 增加 lint/format 基础脚本（不引入过重依赖，按现有 TypeScript strict 风格补齐）。

## 验收方式
- 打开/导入多本 EPUB：阅读、目录跳转、进度恢复、选中文本打开 AI、Cmd+F 搜索正常。
- 安全回归：恶意 HTML 的 AI 输出与 EPUB 内容无法注入执行；文件读取范围符合预期。
- 性能回归：打开大书时首屏更快，搜索可取消且不卡 UI。

如果你确认这个方向，我会按“安全→稳定性能→架构→测试”的顺序提交一组可审阅的小改动，并在每一步跑通应用功能。请回复“确认”，我就开始执行。