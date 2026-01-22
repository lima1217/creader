# EPUB Reader - 研究笔记

## UI/UX 设计研究

### 推荐风格: E-Ink / Paper
- **关键词**: Paper-like, matte, high contrast, texture, reading, calm, slow tech
- **配色**:
  - Off-White: `#FDFBF7`
  - Paper White: `#F5F5F5`
  - Ink Black: `#1A1A1A`
- **特效**: 无动态模糊，清晰的页面切换，纹理/噪点，锐利过渡
- **适用**: 阅读应用、数字报纸、极简日记、无干扰写作
- **性能**: 极佳
- **可访问性**: WCAG AAA

### 推荐字体: Inter (Minimal Swiss)
- **类别**: Sans + Sans
- **风格**: minimal, clean, swiss, functional, neutral, professional
- **Google Fonts**: `https://fonts.google.com/share?selection.family=Inter:wght@300;400;500;600;700`
- **CSS Import**: 
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
```

### 夜间模式配色
- **背景**: `#0D1117`
- **文字**: `#E6EDF3`
- **边框**: `#30363D`

## 技术研究

### Tauri 2.x 特点
- 使用系统 WebView
- Rust 后端
- 打包体积 3-10 MB
- 支持 Vite + React

### epub.js 库
- 官网: https://github.com/futurepress/epub.js
- 纯 JavaScript EPUB 渲染
- 支持: 翻页、目录、搜索、注解

### 文件存储方案
1. **JSON 文件**: 简单，适合小型书库
2. **SQLite**: 更适合大量书籍和复杂查询

## AI 集成思路

### 方案 1: 终端 CLI 调用
- 通过 Tauri 的 Shell 命令执行 CLI
- 支持: Claude CLI, Gemini CLI, OpenAI CLI
- 优点: 灵活，用户可自定义 AI

### 方案 2: API 直接调用
- 在 Rust 后端直接调用 AI API
- 需要用户配置 API Key
- 优点: 更稳定，响应更快

## 参考应用
- Apple Books
- Kindle
- Foliate (Linux)
- Calibre
