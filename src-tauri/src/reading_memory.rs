use crate::ai::{active_provider, chat_completion_oneshot, truncate_for_prompt};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadingMemoryDirectIngestRequest {
    pub root_path: String,
    pub book_title: String,
    pub book_author: Option<String>,
    pub source_chapter: Option<String>,
    pub source_cfi: Option<String>,
    pub source_progress: Option<f64>,
    pub user_question: String,
    pub selected_excerpt: Option<String>,
    pub assistant_answer: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadingMemoryDirectIngestResult {
    pub note_path: String,
    pub log_path: String,
    pub skipped: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadingMemoryDirectDecision {
    pub(crate) should_ingest: bool,
    pub(crate) target_dir: Option<String>,
    pub(crate) title: Option<String>,
    pub(crate) note_type: Option<String>,
    pub(crate) summary: Option<String>,
    pub(crate) body: Option<String>,
    pub(crate) links: Option<Vec<String>>,
    pub(crate) confidence: Option<f64>,
    pub(crate) reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadingMemoryDirectReviewResult {
    pub skipped: bool,
    pub reason: String,
    pub decision: Option<ReadingMemoryDirectDecision>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadingMemoryPageRewriteResult {
    pub page_path: String,
    pub skipped: bool,
    pub reason: String,
}
pub(crate) fn build_reading_memory_direct_prompt(
    request: &ReadingMemoryDirectIngestRequest,
) -> String {
    let excerpt = request
        .selected_excerpt
        .as_deref()
        .map(|s| truncate_for_prompt(s, 1800))
        .unwrap_or_default();
    let answer = truncate_for_prompt(&request.assistant_answer, 2600);
    let question = truncate_for_prompt(&request.user_question, 900);

    format!(
        r#"你是 CReader 的 Reading Memory 审稿员。判断本轮对话是否形成了值得长期保存、可追溯的阅读知识对象。

默认跳过。只有同时满足以下条件才写入：
1. 形成了概念、模型、原则、机制、反例、证据链、开放问题、清晰主张或章节洞见之一。
2. 内容能追溯到选中文本、书籍信息或用户的明确问题。
3. 脱离本轮聊天后仍有复用价值。

用户明确要求“记住、保存、沉淀、加入 Reading Memory”时，可以放宽复用价值门槛，仍需保留来源边界。

直接跳过：普通章节总结、继续总结、翻译、润色、闲聊、短期追问、苏格拉底式出题、工具提示词、重复解释、AI 回答全文复述，以及没有来源的临时推断。

如果写入，请选择一个目录：
- books: 只用于某本书的整体阅读脉络、章节洞见、作者观点索引。
- concepts: 可跨书复用的概念、模型、原则、机制。
- questions: 值得长期追踪的开放问题。
- claims: 明确可争辩、可引用的主张或判断。

只输出 JSON，不要 Markdown 代码块，不要解释。
JSON schema:
{{
  "should_ingest": boolean,
  "target_dir": "books" | "concepts" | "questions" | "claims" | null,
  "title": string | null,
  "note_type": "book" | "concept" | "question" | "claim" | "note" | null,
  "summary": string | null,
  "body": string | null,
  "links": string[],
  "confidence": number,
  "reason": string
}}

完成标准：
- should_ingest 为 false 时，target_dir/title/body 使用 null，reason 用一句中文说明跳过原因。
- should_ingest 为 true 时，title 是适合作为文件名的短标题；body 是 120-500 字、可直接追加的中文知识块，不复制整段回答。
- body 明确区分“书中内容”“用户观点”和“AI 推断”。
- confidence 范围为 0 到 1；低于 0.7 时 should_ingest 必须为 false。

[书籍]
书名：{book_title}
作者：{book_author}
章节：{chapter}
CFI：{cfi}
进度：{progress}

[选中文本]
<source>
{excerpt}
</source>

[用户问题]
{question}

[AI 回答]
{answer}
"#,
        book_title = request.book_title,
        book_author = request.book_author.as_deref().unwrap_or(""),
        chapter = request.source_chapter.as_deref().unwrap_or(""),
        cfi = request.source_cfi.as_deref().unwrap_or(""),
        progress = request
            .source_progress
            .map(|p| format!("{:.2}", p))
            .unwrap_or_default(),
        excerpt = excerpt,
        question = question,
        answer = answer
    )
}
// ============================================================
// Reading Memory ingestion (OKF Wiki)
// ============================================================

pub(crate) fn allowed_reading_memory_dir(dir: &str) -> Option<&'static str> {
    match dir.trim() {
        "books" => Some("books"),
        "concepts" => Some("concepts"),
        "questions" => Some("questions"),
        "claims" => Some("claims"),
        _ => None,
    }
}

pub(crate) fn normalize_note_type(value: Option<&str>, target_dir: &str) -> &'static str {
    match (
        value.map(|v| v.trim().to_lowercase()).as_deref(),
        target_dir,
    ) {
        (Some("question"), _) => "question",
        (Some("concept"), _) => "concept",
        (Some("claim"), _) => "claim",
        (Some("book"), _) => "book",
        (_, "concepts") => "concept",
        (_, "questions") => "question",
        (_, "claims") => "claim",
        (_, "books") => "book",
        _ => "note",
    }
}

fn extract_json_object(raw: &str) -> Option<&str> {
    let start = raw.find('{')?;
    let mut depth = 0;
    let bytes = raw.as_bytes();
    for (i, &b) in bytes.iter().enumerate().skip(start) {
        match b {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&raw[start..=i]);
                }
            }
            _ => {}
        }
    }
    None
}

fn content_hash(input: &str) -> String {
    let mut hasher = DefaultHasher::new();
    input.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

/// HTML comment marker appended to each ingested block so duplicate writes can
/// be detected idempotently. It is invisible in rendered Markdown and safe for
/// the unified/remark pipeline that owns rendering/rewrites.
fn block_hash_marker(hash: &str) -> String {
    format!("\n\n<!-- creader:block_hash={} -->\n", hash)
}

fn block_hash_already_present(note_path: &Path, hash: &str) -> bool {
    let Ok(existing) = std::fs::read_to_string(note_path) else {
        return false;
    };
    let needle = format!("creader:block_hash={}", hash);
    existing.contains(&needle)
}

pub(crate) fn build_direct_reading_memory_markdown(
    request: &ReadingMemoryDirectIngestRequest,
    decision: &ReadingMemoryDirectDecision,
    note_type: &str,
    target_dir: &str,
) -> String {
    let source_excerpt = request
        .selected_excerpt
        .as_deref()
        .map(|s| truncate_for_prompt(s, 1800))
        .unwrap_or_default();
    let links = decision
        .links
        .clone()
        .unwrap_or_default()
        .into_iter()
        .map(|l| safe_wiki_title(&l))
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>();
    let links_block = if links.is_empty() {
        format!("- [[{}]]", safe_wiki_title(&request.book_title))
    } else {
        links
            .into_iter()
            .map(|l| format!("- [[{}]]", l))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let body = decision
        .body
        .as_deref()
        .or(decision.summary.as_deref())
        .unwrap_or("")
        .trim();

    let title = decision
        .title
        .as_deref()
        .filter(|t| !t.trim().is_empty())
        .unwrap_or(&request.book_title);

    format!(
        r#"---
type: {okf_type}
title: {title}
source_app: CReader
source_refs: [{book_ref}]
chapter_refs: [{chapter_ref}]
source_book: {source_book}
source_author: {source_author}
source_chapter: {source_chapter}
source_cfi: {source_cfi}
source_progress: {source_progress:.2}
target_dir: {target_dir}
tags: [creader, {note_type}]
status: inbox
timestamp: {timestamp}
confidence: {confidence:.2}
ingestion_reason: {reason}
---

# {title_plain}

## Source
{source}

## Question
{question}

## Note
{body}

## Links
{links}
"#,
        okf_type = okf_type_for(note_type),
        title = escape_json_string(title),
        title_plain = title,
        book_ref = escape_json_string(&safe_wiki_title(&request.book_title)),
        chapter_ref = escape_json_string(request.source_chapter.as_deref().unwrap_or("")),
        source_book = escape_json_string(&request.book_title),
        source_author = escape_json_string(request.book_author.as_deref().unwrap_or("")),
        source_chapter = escape_json_string(request.source_chapter.as_deref().unwrap_or("")),
        source_cfi = escape_json_string(request.source_cfi.as_deref().unwrap_or("")),
        source_progress = request.source_progress.unwrap_or(0.0),
        target_dir = target_dir,
        note_type = note_type,
        timestamp = iso_timestamp_from_millis(timestamp_millis().unwrap_or(0)),
        confidence = decision.confidence.unwrap_or(0.0).clamp(0.0, 1.0),
        reason = escape_json_string(decision.reason.as_deref().unwrap_or("")),
        source = if source_excerpt.is_empty() {
            "_No selected excerpt was captured._".to_string()
        } else {
            source_excerpt
                .lines()
                .map(|line| format!("> {}", line))
                .collect::<Vec<_>>()
                .join("\n")
        },
        question = request.user_question.trim(),
        body = body,
        links = links_block
    )
}

pub(crate) fn okf_type_for(note_type: &str) -> &'static str {
    match note_type {
        "question" => "OpenQuestions",
        "concept" => "Concept",
        "claim" => "Claim",
        "book" => "ChapterNote",
        _ => "ChapterNote",
    }
}

fn iso_timestamp_from_millis(millis: u128) -> String {
    let secs = (millis / 1000) as i64;
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    let h = rem / 3600;
    let mi = (rem % 3600) / 60;
    let s = rem % 60;
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", year, m, d, h, mi, s)
}

fn escape_json_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

fn timestamp_millis() -> Result<u128, String> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .map_err(|e| format!("System clock error: {}", e))
}

fn write_if_missing(path: &Path, content: &str) -> Result<(), String> {
    if !path.exists() {
        std::fs::write(path, content)
            .map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
    }
    Ok(())
}

fn ensure_package_index(dir: &Path, content: &str) -> Result<(), String> {
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("Failed to create {}: {}", dir.display(), e))?;
    write_if_missing(&dir.join("index.md"), content)
}

const OKF_AGENTS_MD: &str = "# AGENTS.md\n\nThis is an OKF-compatible LLM Wiki package.\n\n- Read `index.md` first for scope and navigation.\n- Every note starts with YAML frontmatter and a non-empty `type`.\n- Cite sources via `source_refs` / `chapter_refs`; keep traceability.\n- Merge duplicates instead of creating parallel pages.\n- Record meaningful changes in `log.md`.\n- Put uncertainty in `questions/`.\n";

const READING_MEMORY_ROOT_AGENTS_MD: &str = "# AGENTS.md\n\nThis Reading Memory repository is an OKF-compatible LLM Wiki.\n\n## Layout\n\n- `shared/` — cross-book concepts, claims, questions, glossary.\n- `books/<book-slug>/` — one OKF sub-package per book (chapters, concepts,\n  claims, questions, sources). Book-related notes land here.\n- Legacy flat directories (`concepts/`, `claims/`, `questions/`) are kept for\n  backward compatibility; new writes prefer the book sub-packages.\n- `.reading-memory/ingestion-log.jsonl` records automatic writes for linting.\n\n## Rules\n\n- Read a book's `index.md` before adding notes to its sub-package.\n- Preserve source metadata (book, chapter, CFI, excerpt).\n- Merge duplicate notes; prefer concept/claim pages over recaps.\n- Mark low-value automatic blocks as archived during lint instead of deleting.\n";

#[tauri::command]
pub(crate) fn ensure_reading_memory_repository(root_path: String) -> Result<String, String> {
    let root = ensure_directory(Path::new(&root_path))?;
    for dir in [
        "inbox",
        "books",
        "concepts",
        "questions",
        "claims",
        "sources",
        ".reading-memory",
    ] {
        std::fs::create_dir_all(root.join(dir))
            .map_err(|e| format!("Failed to create {}: {}", dir, e))?;
    }

    write_if_missing(&root.join("AGENTS.md"), READING_MEMORY_ROOT_AGENTS_MD)?;
    write_if_missing(
        &root.join("log.md"),
        "# log.md\n\nReading Memory repository log.\n",
    )?;
    write_if_missing(
        &root.join("index.md"),
        "# Reading Memory\n\nOKF-compatible LLM Wiki for CReader reading notes.\n\n## Structure\n\n- `shared/` — cross-book concepts, claims, questions, glossary.\n- `books/<book-slug>/` — one OKF sub-package per book.\n- `.reading-memory/ingestion-log.jsonl` — automatic write log.\n",
    )?;

    ensure_package_index(
        &root.join("shared"),
        "# shared\n\nCross-book, reusable knowledge.\n",
    )?;
    for sub in ["concepts", "claims", "questions", "glossary"] {
        ensure_package_index(
            &root.join("shared").join(sub),
            &format!("# shared/{}\n\n", sub),
        )?;
    }

    let rules_path = root.join(".reading-memory").join("lint-rules.md");
    if !rules_path.exists() {
        std::fs::write(
            &rules_path,
            "# Reading Memory Lint Rules\n\n- Preserve source metadata and original excerpts.\n- Prefer book sub-packages (`books/<book-slug>/`) for book-related notes.\n- Merge duplicate notes across packages.\n- Improve links and headings without removing source traceability.\n- Mark low-value automatic blocks as archived during routine lint instead of deleting them silently.\n",
        )
        .map_err(|e| format!("Failed to write lint-rules.md: {}", e))?;
    }

    root.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid repository path encoding".to_string())
}

pub(crate) fn ensure_book_subpackage(
    root: &Path,
    book_title: &str,
    book_author: Option<&str>,
) -> Result<PathBuf, String> {
    let slug = book_slug(book_title);
    let pkg = root.join("books").join(&slug);
    std::fs::create_dir_all(&pkg)
        .map_err(|e| format!("Failed to create book package {}: {}", slug, e))?;

    write_if_missing(&pkg.join("AGENTS.md"), OKF_AGENTS_MD)?;
    write_if_missing(
        &pkg.join("log.md"),
        &format!("# log.md\n\n{} reading log.\n", book_title),
    )?;
    write_if_missing(
        &pkg.join("index.md"),
        &format!(
            "# {}\n\n{}OKF sub-package for this book.\n\n## Structure\n\n- `chapters/` — chapter notes.\n- `concepts/` — reusable concepts from this book.\n- `claims/` — claims and arguments.\n- `questions/` — open questions.\n- `sources/` — pinned source text.\n",
            book_title,
            book_author
                .filter(|a| !a.trim().is_empty())
                .map(|a| format!("> {}\n\n", a))
                .unwrap_or_default()
        ),
    )?;

    for sub in ["chapters", "concepts", "claims", "questions", "sources"] {
        ensure_package_index(&pkg.join(sub), &format!("# {}/{}\n\n", slug, sub))?;
    }

    Ok(pkg)
}

async fn review_reading_memory_decision(
    app: tauri::AppHandle,
    request: &ReadingMemoryDirectIngestRequest,
) -> Result<ReadingMemoryDirectReviewResult, String> {
    // Resolve the active provider early so a missing config/key short-circuits
    // with a clear message instead of writing a skipped log entry.
    let (config, api_key) = active_provider(&app)?;

    let prompt = build_reading_memory_direct_prompt(request);
    let raw = chat_completion_oneshot(&prompt, &config, &api_key)
        .await
        .map_err(|e| format!("Reading Memory review failed: {}", e))?;

    let json_text = extract_json_object(&raw)
        .ok_or_else(|| "Reading Memory ingestion review did not return JSON".to_string())?;
    let decision: ReadingMemoryDirectDecision = serde_json::from_str(json_text)
        .map_err(|e| format!("Failed to parse Reading Memory ingestion JSON: {}", e))?;
    let confidence = decision.confidence.unwrap_or(0.0).clamp(0.0, 1.0);
    if !decision.should_ingest || confidence < 0.7 {
        return Ok(ReadingMemoryDirectReviewResult {
            skipped: true,
            reason: decision
                .reason
                .unwrap_or_else(|| "AI decided not to ingest this turn".to_string()),
            decision: None,
        });
    }

    Ok(ReadingMemoryDirectReviewResult {
        skipped: false,
        reason: "ready".to_string(),
        decision: Some(decision),
    })
}

pub(crate) fn write_reading_memory_from_tool(
    request: ReadingMemoryDirectIngestRequest,
    decision: ReadingMemoryDirectDecision,
) -> Result<ReadingMemoryDirectIngestResult, String> {
    let target_dir = decision
        .target_dir
        .as_deref()
        .and_then(allowed_reading_memory_dir)
        .ok_or_else(|| "AI selected an invalid Reading Memory directory".to_string())?;
    let note_type = normalize_note_type(decision.note_type.as_deref(), target_dir);
    let rendered_markdown = build_direct_reading_memory_markdown(&request, &decision, note_type, target_dir);
    write_reading_memory_note_inner(request, decision, rendered_markdown)
}

pub(crate) fn write_reading_memory_note_inner(
    request: ReadingMemoryDirectIngestRequest,
    decision: ReadingMemoryDirectDecision,
    rendered_markdown: String,
) -> Result<ReadingMemoryDirectIngestResult, String> {
    let root = ensure_directory(Path::new(&request.root_path))?;
    let meta_dir = root.join(".reading-memory");
    std::fs::create_dir_all(&meta_dir)
        .map_err(|e| format!("Failed to create .reading-memory: {}", e))?;

    let confidence = decision.confidence.unwrap_or(0.0).clamp(0.0, 1.0);
    if !decision.should_ingest || confidence < 0.7 {
        return Ok(ReadingMemoryDirectIngestResult {
            note_path: String::new(),
            log_path: meta_dir
                .join("ingestion-log.jsonl")
                .to_string_lossy()
                .to_string(),
            skipped: true,
            reason: decision
                .reason
                .unwrap_or_else(|| "AI decided not to ingest this turn".to_string()),
        });
    }
    let target_dir = decision
        .target_dir
        .as_deref()
        .and_then(allowed_reading_memory_dir)
        .ok_or_else(|| "AI selected an invalid Reading Memory directory".to_string())?;
    let title = safe_wiki_title(
        decision
            .title
            .as_deref()
            .filter(|t| !t.trim().is_empty())
            .unwrap_or(&request.book_title),
    );
    let note_type = normalize_note_type(decision.note_type.as_deref(), target_dir);
    let body_text = decision
        .body
        .as_deref()
        .or(decision.summary.as_deref())
        .unwrap_or("")
        .trim();
    if body_text.is_empty() {
        return Ok(ReadingMemoryDirectIngestResult {
            note_path: String::new(),
            log_path: meta_dir
                .join("ingestion-log.jsonl")
                .to_string_lossy()
                .to_string(),
            skipped: true,
            reason: "AI chose ingestion but produced an empty note body".to_string(),
        });
    }
    if !rendered_markdown.trim_start().starts_with("---") {
        return Err("Rendered Reading Memory note is missing OKF frontmatter".to_string());
    }

    let book_pkg =
        ensure_book_subpackage(&root, &request.book_title, request.book_author.as_deref())?;
    let book_subdir = match target_dir {
        "books" => "sources",
        other => other,
    };
    let dir = book_pkg.join(book_subdir);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create {}: {}", book_subdir, e))?;
    let note_path = dir.join(format!("{}.md", title));
    let new_file = !note_path.exists();
    let block_hash = content_hash(&rendered_markdown);

    // Idempotent ingest: if this exact block hash is already in the note,
    // skip the write and log so repeat ingestion does not bloat the file.
    if !new_file && block_hash_already_present(&note_path, &block_hash) {
        let log_path = meta_dir.join("ingestion-log.jsonl");
        return Ok(ReadingMemoryDirectIngestResult {
            note_path: note_path
                .to_str()
                .map(|s| s.to_string())
                .unwrap_or_default(),
            log_path: log_path.to_string_lossy().to_string(),
            skipped: true,
            reason: "duplicate block".to_string(),
        });
    }

    // Append the invisible hash marker so future writes can detect the same
    // block without re-reading or maintaining a separate index.
    let rendered_with_marker = format!("{}{}", rendered_markdown, block_hash_marker(&block_hash));

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&note_path)
        .map_err(|e| format!("Failed to open Reading Memory note: {}", e))?;
    if !new_file {
        writeln!(file)
            .map_err(|e| format!("Failed to separate Reading Memory note append: {}", e))?;
    }
    write!(file, "{}", rendered_with_marker)
        .map_err(|e| format!("Failed to append Reading Memory note: {}", e))?;

    let millis = timestamp_millis()?;
    let log_path = meta_dir.join("ingestion-log.jsonl");
    let log_entry = serde_json::json!({
        "created_at_ms": millis,
        "source_app": "CReader",
        "mode": "direct",
        "action": if new_file { "create" } else { "append" },
        "note_path": note_path.to_string_lossy(),
        "package_path": book_pkg.to_string_lossy(),
        "book_slug": book_slug(&request.book_title),
        "target_dir": target_dir,
        "title": title,
        "note_type": note_type,
        "confidence": confidence,
        "reason": decision.reason.unwrap_or_default(),
        "block_hash": block_hash,
        "source_book": request.book_title,
        "source_chapter": request.source_chapter,
        "source_cfi": request.source_cfi,
    });
    let mut log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("Failed to open ingestion log: {}", e))?;
    writeln!(log_file, "{}", log_entry)
        .map_err(|e| format!("Failed to append ingestion log: {}", e))?;

    Ok(ReadingMemoryDirectIngestResult {
        note_path: note_path
            .to_str()
            .map(|s| s.to_string())
            .unwrap_or_default(),
        log_path: log_path.to_str().map(|s| s.to_string()).unwrap_or_default(),
        skipped: false,
        reason: "ingested".to_string(),
    })
}

pub(crate) fn safe_relative_markdown_path(relative_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative_path);
    if path.is_absolute() {
        return Err("Reading Memory page path must be relative".to_string());
    }
    if path.extension().and_then(|e| e.to_str()) != Some("md") {
        return Err("Reading Memory page path must be a Markdown file".to_string());
    }

    let mut safe = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::Normal(part) => safe.push(part),
            _ => return Err("Reading Memory page path contains unsafe components".to_string()),
        }
    }

    Ok(safe)
}

pub(crate) fn allowed_reading_memory_page_path(relative_path: &Path) -> bool {
    let parts = relative_path
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(part) => part.to_str(),
            _ => None,
        })
        .collect::<Vec<_>>();
    match parts.as_slice() {
        ["index.md"] | ["log.md"] | ["AGENTS.md"] => true,
        ["books", _, ..] => parts.len() >= 3,
        ["shared", ..] => parts.len() >= 2,
        _ => false,
    }
}

#[tauri::command]
pub(crate) fn rewrite_reading_memory_page(
    root_path: String,
    relative_path: String,
    markdown: String,
) -> Result<ReadingMemoryPageRewriteResult, String> {
    if markdown.trim().is_empty() {
        return Ok(ReadingMemoryPageRewriteResult {
            page_path: String::new(),
            skipped: true,
            reason: "Rendered Markdown is empty".to_string(),
        });
    }

    let root = ensure_directory(Path::new(&root_path))?;
    let relative = safe_relative_markdown_path(&relative_path)?;
    if !allowed_reading_memory_page_path(&relative) {
        return Err("Reading Memory page path is outside allowed package areas".to_string());
    }

    let page_path = root.join(&relative);
    let parent = page_path
        .parent()
        .ok_or_else(|| "Invalid Reading Memory page path".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create Reading Memory page directory: {}", e))?;

    let canonical_parent = std::fs::canonicalize(parent)
        .map_err(|e| format!("Failed to resolve Reading Memory page directory: {}", e))?;
    if !canonical_parent.starts_with(&root) {
        return Err("Refusing to rewrite page outside Reading Memory root".to_string());
    }

    let temp_path = page_path.with_extension("md.tmp");
    std::fs::write(&temp_path, markdown)
        .map_err(|e| format!("Failed to write temporary Reading Memory page: {}", e))?;
    std::fs::rename(&temp_path, &page_path)
        .map_err(|e| format!("Failed to replace Reading Memory page: {}", e))?;

    Ok(ReadingMemoryPageRewriteResult {
        page_path: page_path.to_string_lossy().to_string(),
        skipped: false,
        reason: "rewritten".to_string(),
    })
}

#[tauri::command]
pub(crate) async fn review_reading_memory_direct(
    app: tauri::AppHandle,
    request: ReadingMemoryDirectIngestRequest,
) -> Result<ReadingMemoryDirectReviewResult, String> {
    let root = ensure_directory(Path::new(&request.root_path))?;
    std::fs::create_dir_all(root.join(".reading-memory"))
        .map_err(|e| format!("Failed to create .reading-memory: {}", e))?;
    review_reading_memory_decision(app, &request).await
}

#[tauri::command]
pub(crate) fn write_reading_memory_note(
    request: ReadingMemoryDirectIngestRequest,
    decision: ReadingMemoryDirectDecision,
    rendered_markdown: String,
) -> Result<ReadingMemoryDirectIngestResult, String> {
    write_reading_memory_note_inner(request, decision, rendered_markdown)
}

#[tauri::command]
pub(crate) async fn ingest_reading_memory_direct(
    app: tauri::AppHandle,
    request: ReadingMemoryDirectIngestRequest,
) -> Result<ReadingMemoryDirectIngestResult, String> {
    let review = review_reading_memory_decision(app, &request).await?;
    let Some(decision) = review.decision else {
        let root = ensure_directory(Path::new(&request.root_path))?;
        let meta_dir = root.join(".reading-memory");
        std::fs::create_dir_all(&meta_dir)
            .map_err(|e| format!("Failed to create .reading-memory: {}", e))?;
        return Ok(ReadingMemoryDirectIngestResult {
            note_path: String::new(),
            log_path: meta_dir
                .join("ingestion-log.jsonl")
                .to_string_lossy()
                .to_string(),
            skipped: true,
            reason: review.reason,
        });
    };
    let target_dir = decision
        .target_dir
        .as_deref()
        .and_then(allowed_reading_memory_dir)
        .ok_or_else(|| "AI selected an invalid Reading Memory directory".to_string())?;
    let note_type = normalize_note_type(decision.note_type.as_deref(), target_dir);
    let rendered_markdown =
        build_direct_reading_memory_markdown(&request, &decision, note_type, target_dir);
    write_reading_memory_note_inner(request, decision, rendered_markdown)
}

fn ensure_directory(path: &Path) -> Result<PathBuf, String> {
    if !path.exists() {
        std::fs::create_dir_all(path).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    if !path.is_dir() {
        return Err("Path is not a directory".to_string());
    }
    std::fs::canonicalize(path).map_err(|e| format!("Failed to resolve directory: {}", e))
}

pub(crate) fn safe_wiki_title(input: &str) -> String {
    let cleaned = input
        .replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|', '.'], " ")
        .replace(['\n', '\r', '\t'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let trimmed: String = cleaned.trim().chars().take(80).collect();
    if trimmed.is_empty() {
        "reading-memory".to_string()
    } else {
        trimmed
    }
}

pub(crate) fn book_slug(input: &str) -> String {
    let slug: String = input
        .trim()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let mut out = String::new();
    let mut prev_dash = true;
    for c in slug.chars() {
        if c == '-' {
            if !prev_dash {
                out.push('-');
                prev_dash = true;
            }
        } else {
            out.push(c);
            prev_dash = false;
        }
    }
    let trimmed = out.trim_matches('-');
    let capped: String = trimmed.chars().take(60).collect();
    if capped.is_empty() {
        "untitled-book".to_string()
    } else {
        capped
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp_dir(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "creader_test_{}_{}_{}",
            name,
            std::process::id(),
            nanos
        ))
    }

    #[test]
    fn reading_memory_direct_prompt_rejects_ordinary_summaries() {
        let request = ReadingMemoryDirectIngestRequest {
            root_path: "/tmp/memory".to_string(),
            book_title: "左耳听风".to_string(),
            book_author: Some("左耳听风".to_string()),
            source_chapter: Some("02".to_string()),
            source_cfi: Some("epubcfi(/6/8)".to_string()),
            source_progress: Some(1.75),
            user_question: "继续总结第二章".to_string(),
            selected_excerpt: Some("章节原文".to_string()),
            assistant_answer: "这章主要讲程序员如何用技术变现。".to_string(),
        };

        let prompt = build_reading_memory_direct_prompt(&request);
        assert!(prompt.contains("普通章节总结"));
        assert!(prompt.contains("默认跳过"));
        assert!(prompt.contains("\"should_ingest\": boolean"));
        assert!(prompt.contains("继续总结第二章"));
    }

    #[test]
    fn reading_memory_direct_prompt_keeps_selective_ingestion_rules() {
        let request = ReadingMemoryDirectIngestRequest {
            root_path: "/tmp/memory".to_string(),
            book_title: "Book".to_string(),
            book_author: Some("Author".to_string()),
            source_chapter: Some("Chapter 1".to_string()),
            source_cfi: Some("epubcfi(/6/8)".to_string()),
            source_progress: Some(12.5),
            user_question: "翻译这段".to_string(),
            selected_excerpt: Some("source".to_string()),
            assistant_answer: "translated text".to_string(),
        };

        let prompt = build_reading_memory_direct_prompt(&request);
        for rule in [
            "翻译",
            "闲聊",
            "短期追问",
            "苏格拉底式出题",
            "工具提示词",
            "重复解释",
            "低于 0.7 时 should_ingest 必须为 false",
        ] {
            assert!(prompt.contains(rule), "missing ingestion rule: {}", rule);
        }
    }

    #[test]
    fn safe_wiki_title_and_allowed_dirs_restrict_model_output() {
        assert_eq!(safe_wiki_title("../概念/机会成本?.md"), "概念 机会成本 md");
        assert_eq!(allowed_reading_memory_dir("concepts"), Some("concepts"));
        assert_eq!(allowed_reading_memory_dir("../outside"), None);
        assert_eq!(normalize_note_type(Some("weird"), "claims"), "claim");
    }

    #[test]
    fn reading_memory_note_type_maps_to_okf_types() {
        assert_eq!(normalize_note_type(None, "concepts"), "concept");
        assert_eq!(normalize_note_type(None, "questions"), "question");
        assert_eq!(normalize_note_type(None, "claims"), "claim");
        assert_eq!(normalize_note_type(None, "books"), "book");
        assert_eq!(okf_type_for("concept"), "Concept");
        assert_eq!(okf_type_for("question"), "OpenQuestions");
        assert_eq!(okf_type_for("claim"), "Claim");
        assert_eq!(okf_type_for("book"), "ChapterNote");
    }

    #[test]
    fn reading_memory_markdown_preserves_source_traceability() {
        let request = ReadingMemoryDirectIngestRequest {
            root_path: "/tmp/memory".to_string(),
            book_title: "Book".to_string(),
            book_author: Some("Author".to_string()),
            source_chapter: Some("Chapter 1".to_string()),
            source_cfi: Some("epubcfi(/6/8,/1:0,/1:10)".to_string()),
            source_progress: Some(12.5),
            user_question: "解释这个概念".to_string(),
            selected_excerpt: Some("source excerpt".to_string()),
            assistant_answer: "assistant answer".to_string(),
        };
        let decision = ReadingMemoryDirectDecision {
            should_ingest: true,
            target_dir: Some("concepts".to_string()),
            title: Some("机会成本".to_string()),
            note_type: Some("concept".to_string()),
            summary: None,
            body: Some("这是一个可复用概念。".to_string()),
            links: Some(vec!["Related".to_string()]),
            confidence: Some(0.82),
            reason: Some("形成可复用概念".to_string()),
        };

        let markdown =
            build_direct_reading_memory_markdown(&request, &decision, "concept", "concepts");
        assert!(markdown.trim_start().starts_with("---"));
        assert!(markdown.contains("type: Concept"));
        assert!(markdown.contains("source_refs: [\"Book\"]"));
        assert!(markdown.contains("chapter_refs: [\"Chapter 1\"]"));
        assert!(markdown.contains("source_chapter: \"Chapter 1\""));
        assert!(markdown.contains("source_cfi: \"epubcfi(/6/8,/1:0,/1:10)\""));
        assert!(markdown.contains("tags: [creader, concept]"));
        assert!(markdown.contains("# 机会成本"));
        assert!(markdown.contains("> source excerpt"));
        assert!(markdown.contains("这是一个可复用概念。"));
        assert!(markdown.contains("- [[Related]]"));
    }

    #[test]
    fn reading_memory_write_uses_rendered_markdown_inside_book_package() {
        let root = unique_temp_dir("reading_memory_write");
        let request = ReadingMemoryDirectIngestRequest {
            root_path: root.to_string_lossy().to_string(),
            book_title: "Book".to_string(),
            book_author: Some("Author".to_string()),
            source_chapter: Some("Chapter 1".to_string()),
            source_cfi: Some("epubcfi(/6/8)".to_string()),
            source_progress: Some(12.5),
            user_question: "解释这个概念".to_string(),
            selected_excerpt: Some("source excerpt".to_string()),
            assistant_answer: "assistant answer".to_string(),
        };
        let decision = ReadingMemoryDirectDecision {
            should_ingest: true,
            target_dir: Some("concepts".to_string()),
            title: Some("机会成本".to_string()),
            note_type: Some("concept".to_string()),
            summary: None,
            body: Some("这是一个可复用概念。".to_string()),
            links: Some(vec!["Related".to_string()]),
            confidence: Some(0.82),
            reason: Some("形成可复用概念".to_string()),
        };
        let rendered = "---\ntype: Concept\nsource_refs:\n  - Book\nchapter_refs:\n  - Chapter 1\ntags:\n  - creader\nstatus: inbox\n---\n# 机会成本\n\n## Note\n\n这是 AST 渲染内容。\n".to_string();

        let result = write_reading_memory_note_inner(request, decision, rendered).unwrap();
        let canonical_root = std::fs::canonicalize(&root).unwrap();
        let note_path = PathBuf::from(result.note_path);
        assert!(note_path.starts_with(
            canonical_root
                .join("books")
                .join(book_slug("Book"))
                .join("concepts")
        ));
        assert!(std::fs::read_to_string(note_path)
            .unwrap()
            .contains("这是 AST 渲染内容。"));
        assert!(std::fs::read_to_string(result.log_path)
            .unwrap()
            .contains("\"block_hash\""));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reading_memory_write_is_idempotent_for_duplicate_block_hash() {
        let root = unique_temp_dir("reading_memory_dedup");
        let mk = || ReadingMemoryDirectIngestRequest {
            root_path: root.to_string_lossy().to_string(),
            book_title: "Book".to_string(),
            book_author: Some("Author".to_string()),
            source_chapter: Some("Chapter 1".to_string()),
            source_cfi: Some("epubcfi(/6/8)".to_string()),
            source_progress: Some(12.5),
            user_question: "解释这个概念".to_string(),
            selected_excerpt: Some("source excerpt".to_string()),
            assistant_answer: "assistant answer".to_string(),
        };
        let decision = ReadingMemoryDirectDecision {
            should_ingest: true,
            target_dir: Some("concepts".to_string()),
            title: Some("机会成本".to_string()),
            note_type: Some("concept".to_string()),
            summary: None,
            body: Some("这是一个可复用概念。".to_string()),
            links: Some(vec!["Related".to_string()]),
            confidence: Some(0.82),
            reason: Some("形成可复用概念".to_string()),
        };
        let rendered = "---\ntype: Concept\n---\n# 机会成本\n\n这是 AST 渲染内容。\n".to_string();

        // First write creates the note with a single block.
        let first =
            write_reading_memory_note_inner(mk(), decision.clone(), rendered.clone()).unwrap();
        assert!(!first.skipped);
        let note_path = PathBuf::from(&first.note_path);
        let bytes_after_first = std::fs::metadata(&note_path).unwrap().len();

        // Second identical write must be skipped and leave the file untouched.
        let second =
            write_reading_memory_note_inner(mk(), decision.clone(), rendered.clone()).unwrap();
        assert!(second.skipped);
        assert_eq!(second.reason, "duplicate block");
        let bytes_after_second = std::fs::metadata(&note_path).unwrap().len();
        assert_eq!(bytes_after_first, bytes_after_second);

        // A different body writes a new, second block.
        let mut diff_decision = decision.clone();
        diff_decision.body = Some("另一个不同视角的概念。".to_string());
        let diff_rendered = "---\ntype: Concept\n---\n# 机会成本\n\n另一个不同视角的概念。\n".to_string();
        let third = write_reading_memory_note_inner(mk(), diff_decision, diff_rendered).unwrap();
        assert!(!third.skipped);
        assert!(std::fs::metadata(&note_path).unwrap().len() > bytes_after_first);

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reading_memory_rewrite_page_restricts_relative_paths() {
        assert!(safe_relative_markdown_path("books/book/concepts/page.md").is_ok());
        assert!(safe_relative_markdown_path("../outside.md").is_err());
        assert!(safe_relative_markdown_path("/tmp/outside.md").is_err());
        assert!(safe_relative_markdown_path("books/book/page.txt").is_err());

        assert!(allowed_reading_memory_page_path(Path::new(
            "books/book/concepts/page.md"
        )));
        assert!(allowed_reading_memory_page_path(Path::new(
            "shared/concepts/page.md"
        )));
        assert!(allowed_reading_memory_page_path(Path::new("index.md")));
        assert!(!allowed_reading_memory_page_path(Path::new(
            "concepts/page.md"
        )));
    }

    #[test]
    fn reading_memory_rewrite_page_writes_inside_root() {
        let root = unique_temp_dir("reading_memory_rewrite");
        let result = rewrite_reading_memory_page(
            root.to_string_lossy().to_string(),
            "books/book/concepts/page.md".to_string(),
            "---\ntype: Concept\n---\n# Page\n".to_string(),
        )
        .unwrap();

        assert!(!result.skipped);
        let canonical_root = std::fs::canonicalize(&root).unwrap();
        let page_path = PathBuf::from(result.page_path);
        assert!(page_path.starts_with(&canonical_root));
        assert!(std::fs::read_to_string(page_path)
            .unwrap()
            .contains("# Page"));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn book_subpackage_lives_under_root_books_dir() {
        let root = std::env::temp_dir().join(format!(
            "creader-memory-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let pkg = ensure_book_subpackage(&root, "左耳听风", Some("左耳朵耗子")).unwrap();
        assert_eq!(pkg, root.join("books").join(book_slug("左耳听风")));
        assert!(pkg.join("index.md").exists());
        assert!(pkg.join("concepts").join("index.md").exists());
        assert!(!pkg.join("books").exists());

        std::fs::remove_dir_all(root).unwrap();
    }
}
