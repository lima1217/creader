## 目标（你已确认）
- **先做组A安全保底**。
- **EPUB 脚本默认完全禁用**；仅在“明确必要”时通过开关启用（默认关闭）。

## 变更范围（组A包含哪些点）
1. **Reader：默认禁用 EPUB 内脚本执行**
- 将 `allowScriptedContent` 默认改为 `false`，并移除/收紧 sandbox 中的 `allow-scripts`（默认模式）。
- 增加一个“兼容模式/允许 EPUB 脚本”的用户设置项（默认关闭），开启时才恢复 `allowScriptedContent: true` 与 `allow-scripts`。
- 若当前某功能依赖脚本（例如某些书的交互/注释），在 UI 里明确提示“此模式有安全风险”。

2. **后端：限制 delete_book_file 只能删库目录内文件**
- 在 Rust command 中解析 app data/books 目录，强制校验 `file_path` 必须位于该目录下（canonicalize 防止 `../` 绕过）。
- 可选：进一步要求文件名符合导入时生成的命名规则（如 `book_{id}.epub`），防止删除同目录下非本应用文件。

3. **CSP：prod 去掉 unsafe-eval（dev 保留）**
- 将 CSP 拆分为 dev/prod 两套：
  - dev：允许 HMR 所需来源（按现状）
  - prod：移除 `script-src 'unsafe-eval'`，并收紧到 `self`（结合 tauri 的资源加载方式）

4. **Capability：缩小文件系统权限半径（按最小授权）**
- 将 `$HOME/**` 等大范围放行改为更符合阅读器的最小集合：
  - 只保留“用户通过对话框选择文件”所需能力（如 read-file 对选中文件），或
  - 只允许访问 app data/books（对已导入书籍）
- 保留必要的 dialog 能力用于选书。

## 验收标准（完成后你能明确验证）
- 默认情况下：
  - 打开任意 EPUB，其内嵌脚本不执行；阅读/选中/翻页等基础功能正常。
  - 前端无法通过 invoke 调用造成“删除库目录外任意文件”；后端对非法路径返回明确错误。
  - prod 构建不再包含 `unsafe-eval` CSP。
  - capability 不再放开 `$HOME/**` 等超大范围（除非你明确要求保留）。
- 兼容模式开启后：
  - 仅当用户显式打开“允许 EPUB 脚本”时才启用脚本，并且 UI 有风险提示。

## 执行步骤（我将按顺序落地）
1. 阅读并定位 Reader 的 epub.js 初始化与 sandbox 配置，改为“默认禁脚本 + 可选开关”。
2. 增加 settings 结构与 UI 开关（尽量复用现有 settings 体系与持久化方式）。
3. 修改 Rust `delete_book_file` 做目录约束与错误返回。
4. 拆分 CSP dev/prod（尽量沿用现有 tauri 配置结构）。
5. 收紧 capability 权限，确保不影响导入/读取已导入书籍。
6. 本地验证：跑前端构建/启动，走一遍导入→阅读→删除；后端加最小单测或至少本地调用验证。

如果你确认按以上范围执行，我会开始做代码改动与验证。