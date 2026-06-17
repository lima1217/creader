# CReader

本地 EPUB 阅读器：书库、阅读进度、上下文 AI 对话和 Markdown Reading Memory 都留在本机。

## 功能

- EPUB 阅读、目录跳转、进度恢复、全文搜索
- 书库导入、封面提取、标签分类
- 日间、夜间、护眼主题和字号调节
- OpenAI-compatible HTTP AI provider 配置
- 选区、进度、CFI 和章节上下文驱动的 AI 对话
- AI 审稿后选择性写入本地 Reading Memory Markdown 仓库

## 开发

```bash
npm install
npm run dev
npm run tauri dev
```

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
src/domain/     AI 请求、上下文裁剪、Reading Memory 纯逻辑
src/services/   IndexedDB、本地存储、导入、封面、搜索
src-tauri/      Tauri shell 和 Rust commands
public/         Vite 静态资源
```

## Reading Memory

Reading Memory 是用户选择的本地 Markdown 仓库。CReader 会初始化 OKF-compatible LLM Wiki 结构，并只在 AI 判断内容有长期阅读价值时写入当前书的子包。普通总结、翻译、短追问和闲聊默认跳过。

## AI

AI provider 在设置面板配置为 `{ id, name, baseUrl, model }`。API key 存在应用配置目录的 `ai_keys.env`，不会回显到 UI。后端使用 OpenAI-compatible Chat Completions，并通过 Tauri channel 流式返回。
