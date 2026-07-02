# Render Reading Memory Markdown With TypeScript AST Tools

CReader will use the TypeScript Markdown ecosystem, especially unified and remark, to generate or rewrite structured OKF Markdown for Reading Memory notes. Rust remains the file safety boundary: it validates repository paths, restricts target directories, writes files, and appends ingestion logs instead of trusting AI-generated or frontend-provided paths.

