# 元数据和封面加载优化

## 问题描述

正式版的书籍导入时不加载元数据，连封面都不显示。

## 根本原因分析

1. **元数据提取不完整**：原始代码只尝试一种方法提取元数据和封面
2. **缺少详细日志**：出错时无法诊断具体在哪个步骤失败
3. **错误处理不当**：失败时静默返回fallback，用户不知道出了什么问题

## 解决方案

### 1. 改进元数据提取 (`src/utils/epub.ts`)

**增强的元数据提取**:
- ✅ 添加详细的日志记录每个步骤
- ✅ 正确创建ArrayBuffer（使用slice方法而不是直接blob.arrayBuffer）
- ✅ 多源提取标题和作者（尝试多个可能的metadata字段）
- ✅ 三种方法提取封面：
  1. `coverUrl()` 方法
  2. 从archive直接读取
  3. 从resources获取

**日志增强**:
```typescript
console.log('[EPUB] Starting metadata extraction for:', filePath);
console.log('[EPUB] File read successfully, size:', fileData.length, 'bytes');
console.log('[EPUB] Raw metadata:', metadata);
console.log('[EPUB] Cover extracted successfully via coverUrl, size:', coverBlob.size, 'bytes');
```

### 2. 改进导入流程 (`src/App.tsx`)

**增强的导入日志**:
- ✅ 每个步骤都有清晰的日志标记 `[Import]`
- ✅ 记录book ID生成
- ✅ 记录文件复制过程
- ✅ 记录元数据提取结果
- ✅ 记录封面保存状态
- ✅ 用户友好的错误提示（alert）

### 3. 改进封面存储服务 (`src/services/CoverStore.ts`)

**增强的存储日志**:
- ✅ saveCover: 记录保存的blob大小和成功/失败状态
- ✅ loadCover: 记录是否找到封面及其大小
- ✅ getCoverUrl: 记录缓存命中和URL创建

## 详细改进

### 元数据提取改进

**标题提取** - 尝试多个源:
```typescript
let title = metadata.title || 
           bookAny.package?.metadata?.title ||
           metadata.dc?.title ||
           filePath.split('/').pop()?.replace('.epub', '') || 
           'Unknown';
```

**作者提取** - 尝试多个源:
```typescript
let author = metadata.creator || 
            metadata.author ||
            bookAny.package?.metadata?.creator ||
            metadata.dc?.creator ||
            'Unknown';
```

**封面提取** - 三种方法:

1. **coverUrl 方法** (epub.js API):
```typescript
if (typeof bookAny.coverUrl === 'function') {
    const coverUrl = await bookAny.coverUrl();
    if (coverUrl) {
        const response = await fetch(coverUrl);
        if (response.ok) {
            coverBlob = await response.blob();
        }
    }
}
```

2. **Archive 直接访问**:
```typescript
if (!coverBlob && bookAny.archive) {
    const coverPath = bookAny.cover || 
                     metadata.cover || 
                     bookAny.packaging?.manifest?.cover;
    if (coverPath) {
        const coverData = await bookAny.archive.request(coverPath);
        const mimeType = determineMimeType(coverPath);
        coverBlob = new Blob([coverData], { type: mimeType });
    }
}
```

3. **Resources 访问**:
```typescript
if (!coverBlob && bookAny.resources) {
    const coverResource = bookAny.resources.get('cover') || 
                         bookAny.resources.get('cover-image');
    if (coverResource && coverResource.url) {
        const response = await fetch(coverResource.url);
        if (response.ok) {
            coverBlob = await response.blob();
        }
    }
}
```

## 调试步骤

当遇到元数据或封面问题时，查看浏览器控制台日志：

1. **导入开始**: `[Import] Starting import process for: xxx.epub`
2. **文件读取**: `[EPUB] File read successfully, size: XXX bytes`
3. **Book创建**: `[EPUB] Book instance created, waiting for ready...`
4. **元数据提取**: `[EPUB] Extracted metadata - Title: XXX, Author: XXX`
5. **封面提取**: `[EPUB] Cover extracted successfully via coverUrl, size: XXX bytes`
6. **封面保存**: `[CoverStore] Cover saved successfully for: XXX`
7. **导入完成**: `[Import] Import completed successfully`

## 错误处理改进

- ✅ 详细的错误日志包含堆栈跟踪
- ✅ 用户友好的alert提示
- ✅ 每个catch块都记录错误详情

## 使用建议

1. **打开浏览器开发者工具**（F12或Cmd+Option+I）
2. **切换到Console标签页**
3. **导入一本EPUB书籍**
4. **观察日志输出**，查找以下内容：
   - `[EPUB]` - 元数据提取过程
   - `[Import]` - 导入流程
   - `[CoverStore]` - 封面存储
5. **如果出现错误**，日志会显示具体在哪个步骤失败

## 测试

运行以下命令测试：
```bash
cd /Users/lima/Downloads/creader
npm run typecheck  # 类型检查通过
npm run dev        # 启动开发服务器
```

## 预期效果

- ✅ 书籍标题和作者正确显示
- ✅ 封面图片正确加载
- ✅ 即使部分元数据缺失，也能优雅降级
- ✅ 详细的日志帮助诊断问题
- ✅ 用户收到清晰的错误提示

## 兼容性

支持各种EPUB格式：
- 标准EPUB 2.0
- EPUB 3.0
- 带有非标准元数据结构的EPUB
- 封面在不同位置的EPUB
