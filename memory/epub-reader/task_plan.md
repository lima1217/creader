# Task Plan: EPUB Reader 桌面应用

## Goal
创建一个基于 Tauri 2.x 的本地轻量级 EPUB 阅读器，支持书库管理、阅读进度、夜间模式、搜索，以及终端 AI 对话功能。

## Tech Stack
- **框架**: Tauri 2.x (Rust 后端)
- **前端**: Vite + React + TypeScript
- **样式**: Vanilla CSS (极简设计)
- **EPUB 解析**: epub.js
- **AI 接口**: 终端 AI 调用

## Phases

### Phase 1: 项目搭建 ✅
- [x] 1.1 初始化 Tauri 2.x + Vite + React 项目
- [x] 1.2 配置项目结构和基础依赖
- [x] 1.3 设计系统架构（文件存储、状态管理）

### Phase 2: 核心功能 - EPUB 阅读 ✅
- [x] 2.1 集成 epub.js 库
- [x] 2.2 实现 EPUB 文件加载和渲染
- [x] 2.3 实现章节导航
- [x] 2.4 实现阅读进度保存/恢复

### Phase 3: 书库管理 ✅
- [x] 3.1 实现本地书库数据存储 (localStorage JSON)
- [x] 3.2 书籍导入功能（拖拽/选择文件）
- [x] 3.3 书库列表展示（封面、标题、作者）
- [x] 3.4 书籍删除功能
- [x] 3.5 EPUB 元数据提取（标题、作者、封面）

### Phase 4: 阅读体验 ✅
- [x] 4.1 夜间/日间模式切换 (Light/Dark/Sepia)
- [x] 4.2 字体大小调节 (+/- 控制已实现)
- [x] 4.3 全文搜索功能 (Cmd+F 打开搜索面板)
- [x] 4.4 快捷键支持 (左右箭头翻页, Cmd+F搜索, Esc关闭面板)

### Phase 5: AI 对话功能 ✅
- [x] 5.1 设计 AI 对话面板 UI
- [x] 5.2 实现终端 AI 调用接口 (Codex/Claude/Gemini/OpenCode CLI)
- [x] 5.3 上下文关联（当前阅读内容、选中文本）
- [x] 5.4 对话历史管理 (localStorage 持久化)
- [x] 5.5 快捷键支持 (选中文本后按'a'打开AI面板)
- [x] 5.6 AI 提供商切换功能 (支持 Codex/Claude/Gemini/OpenCode)

### Phase 6: 核心功能完善 ✅
- [x] 6.1 修复 GUI 应用 CLI 路径查找问题
- [x] 6.2 修复中文 UTF-8 字符边界截断问题
- [x] 6.3 修复 Claude CLI 参数兼容性问题 (移除 --no-markdown)
- [x] 6.4 将默认 AI 从 Codex 改为 Claude Code
- [x] 6.5 清理调试日志代码
- [x] 6.6 统一 LocalStore 存储读写层
- [x] 6.7 文档编写 (README.md)
- [x] 6.8 打包测试（macOS） - CReader.app 已生成

### Phase 7: AI 模块 UI/UX 优化 ✅
- [x] 7.1 优化 AI 面板布局和视觉效果 (滑入动画、渐变背景、阴影效果)
- [x] 7.2 添加消息气泡动画和过渡效果 (消息滑入、hover效果)
- [x] 7.3 改进消息格式化（Markdown 渲染）(支持标题、列表、引用、链接)
- [x] 7.4 添加代码块语法高亮 (支持 JS/TS/Python/Rust/Go 等多语言)
- [x] 7.5 优化加载状态动画 (渐变脉冲动画)
- [x] 7.6 添加消息复制功能 (消息和代码块均可复制)
- [x] 7.7 优化移动端/窄屏响应式布局 (全屏模式、隐藏文字标签)
- [x] 7.8 优化快捷操作按钮（总结、翻译、解释等）(添加图标、胶囊样式)
- [x] 7.9 优化上下文显示（书籍/选中文字）(改进卡片样式、滑入动画)
- [x] 7.10 添加 AI 响应流式输出支持 (Tauri Channel + Claude stream-json)
- [x] 7.11 可拆分磁吸式 AI 窗口 (WebviewWindow 独立窗口、事件同步、吸附回主窗口)
- [x] 7.12 专业AI快捷按钮 (解释/拆解/推演/翻译 - 详细提示词模板)
- [x] 7.13 AI响应中断功能 (停止按钮、取消标志、前端超时保护)
- [x] 7.14 AI面板宽度可拖拽调整 (300-700px范围、视觉拖拽条)

### Phase 8: iCloud 同步 (预留)
- [ ] 8.1 Tauri 原生 iCloud API 集成
- [ ] 8.2 数据冲突解决策略
- [ ] 8.3 增量同步优化
- [ ] 8.4 同步状态 UI 指示器
- [ ] 8.5 iOS 版本适配

### Phase 9: 大规模书库优化 ✅
- [x] 9.1 虚拟滚动 (Virtual List) - 仅渲染可见书籍项
- [x] 9.2 封面延迟加载 (Lazy Loading) - 使用 Intersection Observer
- [x] 9.3 书籍分类/文件夹功能 - 支持创建、编辑、删除分类
- [x] 9.4 按分类过滤书籍 - 快速筛选特定分类
- [x] 9.5 为书籍分配分类 - 支持动态更换分类

## Status
**Phase 9 已完成** - 大规模书库优化已完成，支持虚拟滚动、延迟加载封面和书籍分类管理

## AI Quick Actions (快捷按钮)
| 按钮 | 功能描述 |
|------|----------|
| 解释 | 数学化解释 + LEAN形式化证明 |
| 拆解 | 元知识分析(前提/可靠性/脉络/适用性/反例) + 陈述性知识(事实/概念) + 程序性知识(技能/方法) |
| 推演 | Inference多路径推理(核心命题/推理链/假设条件/结论/可信度) |
| 翻译 | 专业中文翻译(忠实源文/保留语域/文化调整) |

## AI Providers Supported
| Provider | CLI Command | Model | Notes |
|----------|-------------|-------|-------|
| Claude Code | `claude -p` | Claude | **默认首选** |
| Codex CLI | `codex -p` | Codex | 备选 |
| Google Gemini | `gemini -p` | Gemini | 需安装 Gemini CLI |
| OpenCode | `opencode run` | OpenCode | 需安装 OpenCode CLI |

## CLI Path Search Locations
GUI 应用会在以下路径搜索 CLI 工具:
- `~/.local/bin/` (Codex CLI)
- `~/.cargo/bin/` (Cargo 安装)
- `~/.bun/bin/` (Bun 安装)
- `~/.nvm/versions/node/*/bin/` (NVM Node - Claude/Gemini 通常在这里)
- `~/Library/Python/3.9-3.13/bin/` (Python 用户安装)
- `/opt/homebrew/bin/` (Homebrew ARM)
- `/usr/local/bin/` (Homebrew Intel)
- `/usr/bin/` (系统)

## Design Direction
- **风格**: E-Ink / Paper 风格，极简设计
- **配色**: 
  - 日间: Off-White #FDFBF7, Ink Black #1A1A1A
  - 夜间: Background #0D1117, Text #E6EDF3
- **字体**: Inter (Swiss Minimal)
- **交互**: 低动效，高对比度，WCAG AAA 可访问性

## Decisions Made
- [Tauri 2.x]: 轻量级，打包小，符合项目目标
- [React + TypeScript]: 成熟生态，类型安全
- [极简设计]: E-Ink 风格，专注阅读体验
- [localStorage JSON]: 简单轻量，适合小型书库
- [Claude Code 默认]: 使用 Claude 作为默认 AI 提供商 (2026-01-22 更新)

## Recent Updates

### 2026-01-22 (下午)
- **AI 快捷按钮重构:**
  - 将原有按钮改为4个专业功能: 解释、拆解、推演、翻译
  - 每个按钮包含详细的中文提示词模板
  - 解释: 数学化解释 + LEAN形式化证明
  - 拆解: 元知识/陈述性知识/程序性知识三维分析
  - 推演: Inference多路径推理模拟
  - 翻译: 专业翻译标准(忠实/完整/语域保留)
- **AI 响应中断功能:**
  - 后端: 添加 `AI_CANCEL_FLAG` 原子布尔标志
  - 后端: 新增 `cancel_ai_streaming` 和 `reset_ai_cancel` Tauri命令
  - 后端: `try_claude_streaming` 流式输出时检查取消标志并终止子进程
  - 后端: 非流式路径也添加取消标志检查
  - 前端: 加载时显示红色停止按钮(带脉冲动画)
  - 前端: 点击停止后500ms超时保护，强制停止并显示部分内容
- **AI 面板宽度可调整:**
  - 嵌入式AI面板左边缘添加可拖拽调整条
  - 支持300px-700px范围内自由调整宽度
  - 拖拽条悬停时显示蓝色渐变和竖向指示器
  - 拖拽过程中禁用文本选择，光标变为col-resize

### 2026-01-22 (上午)
- **AI 流式输出支持:**
  - 实现了 Claude CLI 流式输出 (使用 `--output-format stream-json --verbose --include-partial-messages`)
  - 添加了 `chat_with_ai_streaming` Tauri 命令，使用 `tauri::ipc::Channel` 发送流式事件
  - 前端使用 `Channel` API 实时接收并渲染 AI 响应
  - 添加了流式光标动画 (打字机效果)
  - 其他提供商 (Codex/Gemini/OpenCode) 回退到非流式模式
- **可拆分磁吸式 AI 窗口:**
  - 使用 Tauri `WebviewWindow` 创建独立 AI 窗口
  - 支持将 AI 面板从主窗口拆分出来成为悬浮窗口
  - 通过 Tauri 事件系统 (`emit`/`listen`) 实现主窗口与 AI 窗口状态同步
  - 独立窗口支持上下文同步 (当前书籍、选中文本、章节内容、主题)
  - 独立窗口可通过"吸附"按钮回嵌到主窗口
  - 添加了可拖动窗口头部 (data-tauri-drag-region)
- **AI 模块调试和修复:**
  - 修复了 Claude CLI 调用参数问题（移除不支持的 `--no-markdown` 选项）
  - 将默认 AI 提供商从 Codex 改为 Claude Code
  - 清理了所有调试日志代码，保持终端输出整洁
  - 优化了 AI 可用性检测逻辑

### 2026-01-21
- 添加了 EPUB 元数据提取功能 (utils/epub.ts)
- 添加了拖拽导入支持 (Tauri onDragDropEvent)
- **Phase 4-5 功能完成**
- **AI 模块增强**: 多提供商支持、切换功能、路径查找修复

## Errors Encountered & Fixed
- Tauri 构建缓存路径问题 (已解决: 清理 target 目录)
- GUI 应用无法找到 CLI 工具 (已解决: 添加 find_command 路径搜索)
- 中文字符截断 panic (已解决: 使用 is_char_boundary 安全截断)
- Claude CLI `--no-markdown` 参数不支持 (已解决: 移除该参数)
- 独立AI窗口停止按钮无效 (已解决: 添加前端超时保护机制)
