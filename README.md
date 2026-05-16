# CReader - 轻量级 EPUB 阅读器

一个基于 Tauri 2.x 的本地轻量级 EPUB 阅读器，支持书库管理、阅读进度追踪、多种主题、内嵌 AI 对话助手，以及本地 Markdown 形式的 Reading Memory。

## 功能特性

### 核心阅读功能
- **EPUB 渲染**: 基于 epub.js 的高质量 EPUB 渲染
- **章节导航**: 目录侧边栏快速跳转
- **阅读进度**: 自动保存和恢复阅读位置
- **全文搜索**: Cmd+F 快速搜索书籍内容
- **脚本兼容**: 默认启用 EPUB scripts，加载异常时可用安全模式重新打开当前书

### 书库管理
- **导入书籍**: 拖拽或选择文件导入 EPUB
- **元数据提取**: 自动提取书名、作者、封面
- **书库展示**: 封面网格/列表视图
- **删除管理**: 安全删除确认

### 阅读体验
- **多主题支持**: 日间 / 夜间 / 护眼模式
- **字体调节**: 自定义字号大小
- **键盘快捷键**: 
  - `←` / `→`: 翻页
  - `Cmd+F`: 搜索
  - `Esc`: 关闭面板
  - `A`: 选中文字后打开 AI 助手

### AI 对话助手
- **多提供商支持**: Hermes Agent / Claude Code / Codex CLI / OpenCode
- **上下文关联**: 自动传递当前阅读内容
- **智能裁剪**: 有选中文本时优先使用选区，并只附带少量章节周边背景，减少重复上下文
- **文字选择**: 选中文字直接询问 AI，并记录选区 CFI 用于来源追溯
- **对话历史**: 本地持久化保存
- **上下文轮次**: 可在设置中选择近 5 条、近 20 条或近 40 条聊天记录作为本轮上下文
- **自动压缩**: 超出上下文轮次的旧对话会压缩成隐藏摘要继续参与后续回答
- **快捷提示词**: 在设置中增删改快捷提示词，AI 面板底部最多直接显示 6 个，其余收进“更多”
- **阅读排版**: AI 对话文字大小可在设置中调节
- **集中设置**: 设置面板按 `AI`、`Reading Memory`、`快捷提示词` 三个一级菜单组织

### Reading Memory
- **本地 Markdown 仓库**: 可在设置中选择 Reading Memory 文件夹
- **自动沉淀**: 高置信阅读知识会无感写入 `inbox/`，翻译、元提示词和普通追问默认不摄入
- **外部可编辑**: 仓库可直接用 Obsidian、Typora、VS Code 等 Markdown 工具打开
- **可追溯**: 每条笔记保留书籍、作者、章节、进度和 EPUB CFI 等来源信息

## 更新日志

### v0.2.0 (2026-05-17)
- **Reading Memory**: 收紧自动摄入规则，只沉淀高置信阅读知识，避免把每轮对话写入 `inbox/`
- **AI 上下文**: 新增上下文轮次设置、隐藏摘要压缩和选区智能裁剪
- **Hermes 集成**: 新增 Hermes Agent provider，并支持在 CReader 中单独配置 Hermes 模型
- **来源追溯**: 记录选区 EPUB CFI，Reading Memory 优先使用选区位置作为来源
- **设置体验**: 设置面板按 `AI`、`Reading Memory`、`快捷提示词` 三个一级菜单组织
- **界面打磨**: 调整 AI 面板题字、侧边栏、快捷提示词和设置入口体验

### v0.1.1 (2026-05-16)
- **界面优化**: 精简 AI 面板交互和样式
- **设置集中化**: 将 AI 提供商、模型、Reading Memory 和快捷提示词配置集中到设置面板
- **设置分组**: 设置面板新增 `AI`、`Reading Memory`、`快捷提示词` 三个一级菜单
- **Reading Memory**: 新增本地 Markdown 仓库初始化和 AI 回答自动写入 `inbox/`
- **阅读器改进**: 优化 EPUB 阅读器布局和样式
- **组件增强**: 改进选择工具栏、侧边栏和工具栏设计
- **响应式优化**: 提升界面响应性和用户体验
- **安装包**: 新增 macOS Apple Silicon 版本安装包

### v0.1.0 (2026-05-15)
- **初始发布**: CReader 首个公开版本
- **核心功能**: EPUB 渲染、书库管理、阅读进度追踪
- **AI 集成**: 支持多种 AI 助手提供商
- **主题支持**: 日间/夜间/护眼三种模式
- **搜索功能**: 全文搜索和快速导航

## 技术栈

- **框架**: Tauri 2.x (Rust 后端)
- **前端**: Vite + React + TypeScript
- **样式**: Vanilla CSS (warm paper / native desktop)
- **EPUB**: epub.js
- **AI**: 终端 CLI 调用 (hermes/codex/claude/opencode)

## 安装

### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/yourusername/creader.git
cd creader

# 安装依赖
npm install

# 开发模式
npm run tauri dev

# 构建发布版本
npm run tauri build
```

### 系统要求

- macOS 10.15+ (当前版本)
- Node.js 18+
- Rust 1.70+

## AI 配置

CReader 支持多种 AI 提供商。请在左侧栏底部的设置面板中选择提供商和模型，并确保已安装对应的 CLI 工具：

| 提供商 | 安装命令 | 说明 |
|--------|----------|------|
| Hermes | 使用本地 `/Users/lima/.hermes/hermes-agent` | Hermes Agent |
| Codex CLI | 参见 Codex CLI | Codex |
| Claude | `npm install -g @anthropic-ai/claude-code` | Anthropic Claude |
| OpenCode | 参见 OpenCode CLI | OpenCode |

快捷提示词也在设置面板中管理。AI 面板底部会优先显示前 6 个启用的提示词，超过 6 个的提示词会进入“更多”菜单。

Hermes 默认使用 `/Users/lima/.hermes/config.yaml` 中的模型配置。当前 Hermes 全局默认值是 `deepseek-v4-flash`，CReader 设置面板里的 Hermes 模型默认覆盖为 `glm-5.1`。

自动压缩上下文开启后，CReader 会把上下文窗口之外的旧聊天压缩成隐藏摘要，并和最近聊天记录一起发送给 AI。摘要不会显示在聊天窗口，也不会写入 Reading Memory。

## Reading Memory

Reading Memory 是 CReader 的本地 Markdown 知识仓库。用户可以在设置面板中选择仓库目录，CReader 会初始化以下结构：

```text
Reading Memory/
├── inbox/
├── books/
├── concepts/
├── questions/
├── claims/
├── sources/
└── .reading-memory/
    ├── manifest.json
    └── ingestion-log.jsonl
```

AI 回答如果形成可长期复用的阅读知识，会自动写入 `inbox/`，并在 `.reading-memory/ingestion-log.jsonl` 追加写入记录。CReader 会跳过翻译、元提示词、苏格拉底式训练交互和普通短答追问，避免把每轮聊天都塞进 wiki。长期整理、合并、去重和升级到 `books/`、`concepts/`、`questions/`、`claims/` 的工作预留给外部 lint agent。

## 项目结构

```
creader/
├── src/                    # 前端源码
│   ├── components/         # React 组件
│   ├── stores/             # 状态管理 (Context)
│   ├── services/           # 服务层 (导入、存储、封面、搜索等)
│   ├── types/              # TypeScript 类型
│   └── utils/              # 工具函数
├── src-tauri/              # Rust 后端
│   └── src/
│       └── lib.rs          # Tauri 命令
├── memory/                 # 项目文档
│   └── epub-reader/
│       └── task_plan.md    # 任务计划
└── public/                 # 静态资源
```

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `←` / `→` | 翻页 |
| `Cmd + F` | 打开搜索 |
| `Esc` | 关闭面板 |
| `A` | 打开 AI 助手 (选中文字后) |

## 未来计划

- [ ] iCloud 同步 (跨设备同步书库和进度)
- [ ] iOS 版本
- [ ] 批注和高亮
- [ ] 书签管理
- [ ] 阅读统计
- [ ] Reading Memory lint agent 工作流

## 设计理念

CReader 采用 **warm paper / native desktop** 设计风格：

- **配色**: 
  - 日间: Off-White `#FDFBF7`, Ink Black `#1A1A1A`
  - 夜间: Background `#0D1117`, Text `#E6EDF3`
- **字体**: 系统 UI 字体 + 阅读区衬线字体
- **交互**: 低动效、低装饰、书库和阅读区一致的纸面层级

## 许可证

MIT License

## 致谢

- [Tauri](https://tauri.app/) - 跨平台桌面应用框架
- [epub.js](https://github.com/futurepress/epub.js) - EPUB 渲染库
- [React](https://react.dev/) - 用户界面库
