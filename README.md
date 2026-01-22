# CReader - 轻量级 EPUB 阅读器

一个基于 Tauri 2.x 的本地轻量级 EPUB 阅读器，支持书库管理、阅读进度追踪、多种主题，以及 AI 对话助手功能。

![CReader](./docs/screenshot.png)

## 功能特性

### 核心阅读功能
- **EPUB 渲染**: 基于 epub.js 的高质量 EPUB 渲染
- **章节导航**: 目录侧边栏快速跳转
- **阅读进度**: 自动保存和恢复阅读位置
- **全文搜索**: Cmd+F 快速搜索书籍内容

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
- **多提供商支持**: Factory Droid (GLM-4.7) / Claude / Gemini / OpenAI
- **上下文关联**: 自动传递当前阅读内容
- **文字选择**: 选中文字直接询问 AI
- **对话历史**: 本地持久化保存

## 技术栈

- **框架**: Tauri 2.x (Rust 后端)
- **前端**: Vite + React + TypeScript
- **样式**: Vanilla CSS (E-Ink 极简设计)
- **EPUB**: epub.js
- **AI**: 终端 CLI 调用 (droid/claude/gemini/openai)

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

CReader 支持多种 AI 提供商。请确保已安装对应的 CLI 工具：

| 提供商 | 安装命令 | 说明 |
|--------|----------|------|
| Factory Droid | 参见 [Factory AI](https://factory.ai) | 默认，使用 GLM-4.7 模型 |
| Claude | `npm install -g @anthropic-ai/claude-code` | Anthropic Claude |
| Gemini | 参见 [Gemini CLI](https://ai.google.dev/gemini-api/docs/quickstart?lang=web) | Google Gemini |
| OpenAI | `pip install openai` | OpenAI GPT-4 |

## 项目结构

```
creader/
├── src/                    # 前端源码
│   ├── components/         # React 组件
│   ├── stores/             # 状态管理 (Context)
│   ├── services/           # 服务层 (同步等)
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

## 设计理念

CReader 采用 **E-Ink / Paper** 极简设计风格：

- **配色**: 
  - 日间: Off-White `#FDFBF7`, Ink Black `#1A1A1A`
  - 夜间: Background `#0D1117`, Text `#E6EDF3`
- **字体**: Inter (Swiss Minimal)
- **交互**: 低动效，高对比度，WCAG AAA 可访问性

## 许可证

MIT License

## 致谢

- [Tauri](https://tauri.app/) - 跨平台桌面应用框架
- [epub.js](https://github.com/futurepress/epub.js) - EPUB 渲染库
- [React](https://react.dev/) - 用户界面库
