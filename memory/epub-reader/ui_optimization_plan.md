# CReader UI/UX 优化记录

## 当前方向

CReader 现在定位为纯 EPUB 阅读器，而不是通用文档查看器。界面方向是 warm paper / native desktop：低阴影、低装饰、墨蓝强调、书库和阅读区共享纸面底色。

## 已完成

- 移除 Markdown / PDF reader 入口，导入和拖拽只接受 EPUB。
- 将工具栏、书库、目录、AI panel 对齐到同一套 paper token。
- 去掉偏网页化的玻璃态、渐变、高强度阴影和大图标空状态。
- AI panel 保留为主窗口内嵌面板，删除独立 AI window。
- EPUB scripts 默认开启，以保证选中文本上下文可用。
- 加入单本书安全模式：加载异常时可用无脚本方式重新打开该书。
- 导入失败、删除书籍、删除分类使用应用内轻量 dialog，不再使用原生 alert/confirm。

## 视觉原则

- 书库、目录、阅读页、AI panel 都使用同一纸面材质层级。
- 工具按钮只表达明确动作，避免把技术开关暴露在主 toolbar。
- 空状态和加载状态使用小封面/书脊占位，不使用大图标卡片。
- AI 代码块使用纸面内嵌样式，不使用 VS Code 风格深色块。

## 后续观察点

- 如果某些 EPUB scripts 导致渲染异常，优先增强安全模式提示，而不是恢复 toolbar 开关。
- 如果 AI panel 继续变复杂，再抽 `AIChatSurface` 等共享子组件。
- CSS 继续按 token / shell / reader / AI markdown 分层，避免大文件互相覆盖。
