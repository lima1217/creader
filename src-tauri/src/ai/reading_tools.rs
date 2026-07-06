use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;

use crate::book_files::validate_book_path_inner;
use crate::book_text::{
    get_chapter_text_async, list_chapters_async, search_book_async, AppBookTextCache,
    BookSearchResult, BookTextCache,
};
use crate::reading_memory::{
    allowed_reading_memory_dir, write_reading_memory_from_tool, ReadingMemoryDirectDecision,
    ReadingMemoryDirectIngestRequest,
};

use super::ChatRequest;

pub(crate) const READING_AI_SYSTEM_PROMPT: &str = include_str!("../../prompts/reading_ai_system.md");
const SEARCH_BOOK_TRUNCATED_HINT: &str =
    "结果已截断：请收窄查询词，或对最相关的 1-2 个命中章节调用 get_chapter_text 确认全文。";

#[derive(Debug, Clone)]
pub(crate) struct AiToolContext {
    pub book_file_path: Option<String>,
    pub book_title: Option<String>,
    pub book_author: Option<String>,
    pub source_chapter: Option<String>,
    pub source_cfi: Option<String>,
    pub source_progress: Option<f64>,
    pub reading_memory_path: Option<String>,
    pub user_question: String,
    pub selected_excerpt: Option<String>,
}

impl AiToolContext {
    pub fn from_chat_request(request: &ChatRequest) -> Self {
        Self {
            book_file_path: request.book_file_path.clone(),
            book_title: request.book_title.clone(),
            book_author: request.book_author.clone(),
            source_chapter: request.source_chapter.clone(),
            source_cfi: request.source_cfi.clone(),
            source_progress: request.source_progress,
            reading_memory_path: request.reading_memory_path.clone(),
            user_question: request.message.clone(),
            selected_excerpt: request.context.clone(),
        }
    }
}

pub(crate) fn reading_ai_tools() -> Vec<async_openai::types::chat::ChatCompletionTools> {
    use async_openai::types::chat::{ChatCompletionTool, ChatCompletionTools, FunctionObject};

    let list_chapters = ChatCompletionTools::Function(ChatCompletionTool {
        function: FunctionObject {
            name: "list_chapters".to_string(),
            description: Some(
                "List all chapters in the current EPUB. Each entry has `index` (0-based spine position), `title`, and `byte_len` — the uncompressed XHTML byte size, a rough proxy for length only (UTF-8 is ~1-3 bytes/char). Do not use `byte_len` as a character count or as an offset bound."
                    .to_string(),
            ),
            parameters: Some(serde_json::json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            })),
            strict: None,
        },
    });

    let get_chapter_text = ChatCompletionTools::Function(ChatCompletionTool {
        function: FunctionObject {
            name: "get_chapter_text".to_string(),
            description: Some(
                "Fetch plain text for a chapter by spine index. `offset` and `limit` are in characters (Unicode scalars), not bytes or tokens. Defaults: offset=0, limit=16000. Returns `{ text, index, offset, next_offset }`; to page forward pass `next_offset` as the next `offset` — `next_offset` is null when the chapter end was reached. Do not recompute the next offset yourself; whitespace is normalized so `offset + limit` may overlap or skip. Repeated calls with the same `(index, offset, limit)` within one conversation are deduplicated automatically; you do not need to avoid them."
                    .to_string(),
            ),
            parameters: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "index": { "type": "integer", "minimum": 0 },
                    "offset": { "type": "integer", "minimum": 0 },
                    "limit": { "type": "integer", "minimum": 1 }
                },
                "required": ["index"],
                "additionalProperties": false
            })),
            strict: None,
        },
    });

    let search_book = ChatCompletionTools::Function(ChatCompletionTool {
        function: FunctionObject {
            name: "search_book".to_string(),
            description: Some(
                "Scan chapter plain text for a keyword or phrase. Returns matching chapter indexes and short excerpts. Results may be truncated on large books."
                    .to_string(),
            ),
            parameters: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "minLength": 1 },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 20 }
                },
                "required": ["query"],
                "additionalProperties": false
            })),
            strict: None,
        },
    });

    let write_reading_memory = ChatCompletionTools::Function(ChatCompletionTool {
        function: FunctionObject {
            name: "write_reading_memory".to_string(),
            description: Some(
                "Write a durable, source-grounded note to the user's Reading Memory repository."
                    .to_string(),
            ),
            parameters: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "target_dir": {
                        "type": "string",
                        "enum": ["books", "concepts", "questions", "claims"]
                    },
                    "title": { "type": "string" },
                    "note_type": { "type": "string" },
                    "body": { "type": "string" },
                    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
                    "reason": { "type": "string" }
                },
                "required": ["target_dir", "title", "body", "confidence"],
                "additionalProperties": false
            })),
            strict: None,
        },
    });

    vec![list_chapters, get_chapter_text, search_book, write_reading_memory]
}

#[derive(Debug, Deserialize)]
struct GetChapterTextToolArgs {
    index: usize,
    #[serde(default)]
    offset: Option<usize>,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct SearchBookToolArgs {
    query: String,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct WriteReadingMemoryToolArgs {
    target_dir: String,
    title: String,
    #[serde(default)]
    note_type: Option<String>,
    body: String,
    confidence: f64,
    #[serde(default)]
    reason: Option<String>,
}

pub(crate) fn tool_activity_detail(name: &str, status: &str, arguments: &str) -> Option<String> {
    match (name, status) {
        ("list_chapters", "started") => Some("正在获取目录…".to_string()),
        ("list_chapters", "completed") => Some("已获取目录".to_string()),
        ("list_chapters", "failed") => Some("获取目录失败".to_string()),
        ("get_chapter_text", "started") | ("get_chapter_text", "completed")
        | ("get_chapter_text", "failed") => {
            let chapter_index = serde_json::from_str::<GetChapterTextToolArgs>(arguments)
                .ok()
                .map(|args| args.index);
            match (status, chapter_index) {
                ("started", Some(index)) => Some(format!("正在查阅第 {} 章…", index)),
                ("started", None) => Some("正在查阅章节…".to_string()),
                ("completed", Some(index)) => Some(format!("已查阅第 {} 章", index)),
                ("completed", None) => Some("已查阅章节".to_string()),
                ("failed", Some(index)) => Some(format!("查阅第 {} 章失败", index)),
                ("failed", None) => Some("查阅章节失败".to_string()),
                _ => None,
            }
        }
        ("search_book", "started") => {
            let query = serde_json::from_str::<SearchBookToolArgs>(arguments)
                .ok()
                .map(|args| args.query.trim().to_string())
                .filter(|q| !q.is_empty());
            match query {
                Some(q) if q.chars().count() <= 24 => Some(format!("正在搜索「{}」…", q)),
                Some(_) => Some("正在搜索全书…".to_string()),
                None => Some("正在搜索全书…".to_string()),
            }
        }
        ("search_book", "completed") => Some("已完成全书搜索".to_string()),
        ("search_book", "failed") => Some("全书搜索失败".to_string()),
        ("write_reading_memory", "started") => Some("正在写入阅读记忆…".to_string()),
        ("write_reading_memory", "completed") => Some("已写入阅读记忆".to_string()),
        ("write_reading_memory", "failed") => Some("写入阅读记忆失败".to_string()),
        _ => None,
    }
}

fn validated_book_path(app: &tauri::AppHandle, book_file_path: &str) -> Result<PathBuf, String> {
    if !validate_book_path_inner(app, book_file_path) {
        return Err("Book file path is not allowed or does not exist".to_string());
    }
    std::fs::canonicalize(book_file_path)
        .map_err(|e| format!("Failed to resolve book path: {}", e))
}

pub(crate) fn resolve_book_text_cache(app: Option<&tauri::AppHandle>) -> Arc<BookTextCache> {
    if let Some(handle) = app {
        if let Some(state) = handle.try_state::<AppBookTextCache>() {
            return Arc::clone(&state.0);
        }
    }
    Arc::new(BookTextCache::with_default_capacity())
}

fn is_deduplicable_readonly_tool(name: &str) -> bool {
    matches!(
        name,
        "list_chapters" | "get_chapter_text" | "search_book"
    )
}

fn canonicalize_json_value(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            let mut sorted = serde_json::Map::new();
            let mut keys: Vec<_> = map.keys().collect();
            keys.sort();
            for key in keys {
                sorted.insert(key.clone(), canonicalize_json_value(&map[key]));
            }
            serde_json::Value::Object(sorted)
        }
        serde_json::Value::Array(items) => serde_json::Value::Array(
            items.iter().map(canonicalize_json_value).collect(),
        ),
        other => other.clone(),
    }
}

pub(crate) fn canonical_tool_arguments(arguments: &str) -> Result<String, String> {
    let value: serde_json::Value = serde_json::from_str(arguments)
        .map_err(|e| format!("Invalid tool arguments JSON: {}", e))?;
    serde_json::to_string(&canonicalize_json_value(&value))
        .map_err(|e| format!("Failed to canonicalize tool arguments: {}", e))
}

fn tool_call_cache_key(name: &str, arguments: &str) -> Option<(String, String)> {
    if !is_deduplicable_readonly_tool(name) {
        return None;
    }
    let canonical_args = canonical_tool_arguments(arguments).ok()?;
    Some((name.to_string(), canonical_args))
}

fn mark_duplicate_tool_result(result_json: &str) -> String {
    let value = serde_json::from_str::<serde_json::Value>(result_json)
        .unwrap_or_else(|_| serde_json::json!({ "result": result_json }));

    match value {
        serde_json::Value::Object(mut obj) => {
            obj.insert(
                "duplicate_call".to_string(),
                serde_json::Value::Bool(true),
            );
            serde_json::to_string(&serde_json::Value::Object(obj))
                .unwrap_or_else(|_| result_json.to_string())
        }
        serde_json::Value::Array(chapters) => serde_json::to_string(&serde_json::json!({
            "duplicate_call": true,
            "chapters": chapters,
        }))
        .unwrap_or_else(|_| result_json.to_string()),
        other => serde_json::to_string(&serde_json::json!({
            "duplicate_call": true,
            "result": other,
        }))
        .unwrap_or_else(|_| result_json.to_string()),
    }
}

#[derive(Default)]
pub(crate) struct ToolCallResultCache {
    entries: HashMap<(String, String), String>,
}

impl ToolCallResultCache {
    pub fn lookup(&self, name: &str, arguments: &str) -> Option<String> {
        let key = tool_call_cache_key(name, arguments)?;
        self.entries
            .get(&key)
            .map(|result| mark_duplicate_tool_result(result))
    }

    pub fn store(&mut self, name: &str, arguments: &str, result: &str) {
        if let Some(key) = tool_call_cache_key(name, arguments) {
            self.entries.insert(key, result.to_string());
        }
    }
}

pub(crate) fn serialize_search_book_tool_result(result: &BookSearchResult) -> Result<String, String> {
    if result.truncated {
        let mut value = serde_json::to_value(result)
            .map_err(|e| format!("Failed to serialize search results: {}", e))?;
        value["hint"] = serde_json::Value::String(SEARCH_BOOK_TRUNCATED_HINT.to_string());
        serde_json::to_string(&value)
            .map_err(|e| format!("Failed to serialize search results: {}", e))
    } else {
        serde_json::to_string(result)
            .map_err(|e| format!("Failed to serialize search results: {}", e))
    }
}

pub(crate) async fn execute_local_tool(
    app: Option<&tauri::AppHandle>,
    tool_ctx: &AiToolContext,
    cache: &Arc<BookTextCache>,
    name: &str,
    arguments: &str,
) -> Result<String, String> {
    match name {
        "list_chapters" => {
            let app = app.ok_or_else(|| {
                "Book tools require an application handle for path validation".to_string()
            })?;
            let book_path = tool_ctx
                .book_file_path
                .as_deref()
                .ok_or_else(|| "No book file path available for list_chapters".to_string())?;
            let book_path = validated_book_path(app, book_path)?;
            let chapters = list_chapters_async(book_path).await?;
            serde_json::to_string(&chapters)
                .map_err(|e| format!("Failed to serialize chapter list: {}", e))
        }
        "get_chapter_text" => {
            let app = app.ok_or_else(|| {
                "Book tools require an application handle for path validation".to_string()
            })?;
            let args: GetChapterTextToolArgs = serde_json::from_str(arguments)
                .map_err(|e| format!("Invalid get_chapter_text arguments: {}", e))?;
            let book_path = tool_ctx
                .book_file_path
                .as_deref()
                .ok_or_else(|| "No book file path available for get_chapter_text".to_string())?;
            let book_path = validated_book_path(app, book_path)?;
            let slice = get_chapter_text_async(
                book_path,
                args.index,
                args.offset,
                args.limit,
                Arc::clone(cache),
            )
            .await?;
            serde_json::to_string(&slice)
                .map_err(|e| format!("Failed to serialize chapter text: {}", e))
        }
        "search_book" => {
            let app = app.ok_or_else(|| {
                "Book tools require an application handle for path validation".to_string()
            })?;
            let args: SearchBookToolArgs = serde_json::from_str(arguments)
                .map_err(|e| format!("Invalid search_book arguments: {}", e))?;
            let book_path = tool_ctx
                .book_file_path
                .as_deref()
                .ok_or_else(|| "No book file path available for search_book".to_string())?;
            let book_path = validated_book_path(app, book_path)?;
            let result = search_book_async(
                book_path,
                args.query,
                args.limit,
                Arc::clone(cache),
            )
            .await?;
            serialize_search_book_tool_result(&result)
        }
        "write_reading_memory" => {
            let args: WriteReadingMemoryToolArgs = serde_json::from_str(arguments)
                .map_err(|e| format!("Invalid write_reading_memory arguments: {}", e))?;
            let root_path = tool_ctx
                .reading_memory_path
                .as_deref()
                .filter(|path| !path.trim().is_empty())
                .ok_or_else(|| {
                    "Reading Memory repository is not configured".to_string()
                })?;
            let book_title = tool_ctx
                .book_title
                .clone()
                .unwrap_or_else(|| "Untitled".to_string());
            let decision = ReadingMemoryDirectDecision {
                should_ingest: true,
                target_dir: Some(args.target_dir),
                title: Some(args.title),
                note_type: args.note_type,
                summary: None,
                body: Some(args.body),
                links: None,
                confidence: Some(args.confidence),
                reason: args.reason,
            };
            if allowed_reading_memory_dir(
                decision.target_dir.as_deref().unwrap_or(""),
            )
            .is_none()
            {
                return Err("Reading Memory target_dir is outside allowed directories".to_string());
            }
            let request = ReadingMemoryDirectIngestRequest {
                root_path: root_path.to_string(),
                book_title,
                book_author: tool_ctx.book_author.clone(),
                source_chapter: tool_ctx.source_chapter.clone(),
                source_cfi: tool_ctx.source_cfi.clone(),
                source_progress: tool_ctx.source_progress,
                user_question: tool_ctx.user_question.clone(),
                selected_excerpt: tool_ctx.selected_excerpt.clone(),
                assistant_answer: String::new(),
            };
            let result = write_reading_memory_from_tool(request, decision)?;
            serde_json::to_string(&result)
                .map_err(|e| format!("Failed to serialize Reading Memory result: {}", e))
        }
        other => Err(format!("Unknown tool: {}", other)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::Arc;

    #[test]
    fn tool_activity_detail_formats_user_facing_labels() {
        assert_eq!(
            tool_activity_detail("get_chapter_text", "started", r#"{"index":2}"#),
            Some("正在查阅第 2 章…".to_string())
        );
        assert_eq!(
            tool_activity_detail("get_chapter_text", "completed", r#"{"index":2}"#),
            Some("已查阅第 2 章".to_string())
        );
        assert_eq!(
            tool_activity_detail("get_chapter_text", "failed", r#"{"index":2}"#),
            Some("查阅第 2 章失败".to_string())
        );
        assert_eq!(
            tool_activity_detail("get_chapter_text", "failed", "{}"),
            Some("查阅章节失败".to_string())
        );
        assert_eq!(
            tool_activity_detail("list_chapters", "started", "{}"),
            Some("正在获取目录…".to_string())
        );
        assert_eq!(
            tool_activity_detail("list_chapters", "failed", "{}"),
            Some("获取目录失败".to_string())
        );
        assert_eq!(
            tool_activity_detail("search_book", "started", r#"{"query":"量子"}"#),
            Some("正在搜索「量子」…".to_string())
        );
        assert_eq!(
            tool_activity_detail("search_book", "completed", r#"{"query":"量子"}"#),
            Some("已完成全书搜索".to_string())
        );
        assert_eq!(
            tool_activity_detail("search_book", "failed", r#"{"query":"量子"}"#),
            Some("全书搜索失败".to_string())
        );
        assert_eq!(
            tool_activity_detail("write_reading_memory", "completed", "{}"),
            Some("已写入阅读记忆".to_string())
        );
        assert_eq!(
            tool_activity_detail("write_reading_memory", "failed", "{}"),
            Some("写入阅读记忆失败".to_string())
        );
    }

    #[test]
    fn canonical_tool_arguments_sorts_object_keys() {
        let a = canonical_tool_arguments(r#"{"index":5,"limit":10}"#).unwrap();
        let b = canonical_tool_arguments(r#"{"limit":10,"index":5}"#).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn tool_result_cache_marks_duplicate_list_chapters() {
        let mut cache = ToolCallResultCache::default();
        let first = r#"[{"index":0,"title":"Alpha","byte_len":120}]"#;
        cache.store("list_chapters", "{}", first);

        let cached = cache.lookup("list_chapters", "{}").expect("cache hit");
        let json: serde_json::Value = serde_json::from_str(&cached).unwrap();
        assert_eq!(json["duplicate_call"], true);
        assert_eq!(json["chapters"][0]["title"], "Alpha");
    }

    #[test]
    fn tool_result_cache_marks_duplicate_search_book() {
        let mut cache = ToolCallResultCache::default();
        let first = r#"{"hits":[{"index":1,"title":"Middle","excerpt":"quantum observer"}],"truncated":false}"#;
        cache.store("search_book", r#"{"query":"quantum"}"#, first);

        let cached = cache
            .lookup("search_book", r#"{"query":"quantum"}"#)
            .expect("cache hit");
        let json: serde_json::Value = serde_json::from_str(&cached).unwrap();
        assert_eq!(json["duplicate_call"], true);
        assert_eq!(json["hits"][0]["index"], 1);
    }

    #[test]
    fn tool_result_cache_marks_duplicate_get_chapter_text() {
        let mut cache = ToolCallResultCache::default();
        let first = r#"{"text":"Chapter body","index":5,"offset":0,"next_offset":null}"#;
        cache.store("get_chapter_text", r#"{"index":5}"#, first);

        let cached = cache
            .lookup("get_chapter_text", r#"{"index":5}"#)
            .expect("cache hit");
        let json: serde_json::Value = serde_json::from_str(&cached).unwrap();
        assert_eq!(json["duplicate_call"], true);
        assert_eq!(json["text"], "Chapter body");
        assert_eq!(json["index"], 5);
    }

    #[test]
    fn tool_result_cache_does_not_deduplicate_write_reading_memory() {
        let mut cache = ToolCallResultCache::default();
        cache.store(
            "write_reading_memory",
            r#"{"target_dir":"notes","title":"Note","body":"Body","confidence":0.9}"#,
            r#"{"written":true}"#,
        );
        assert!(cache
            .lookup(
                "write_reading_memory",
                r#"{"target_dir":"notes","title":"Note","body":"Body","confidence":0.9}"#,
            )
            .is_none());
    }

    fn unique_temp_dir(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "creader_ai_test_{}_{}_{}",
            name,
            std::process::id(),
            nanos
        ))
    }

    #[tokio::test]
    async fn write_reading_memory_tool_rejects_invalid_target_dir() {
        let root = unique_temp_dir("tool_write_reject");
        std::fs::create_dir_all(&root).unwrap();
        let tool_ctx = AiToolContext {
            reading_memory_path: Some(root.to_string_lossy().to_string()),
            book_title: Some("Book".to_string()),
            book_author: None,
            source_chapter: None,
            source_cfi: None,
            source_progress: None,
            book_file_path: None,
            user_question: "save this".to_string(),
            selected_excerpt: None,
        };
        let args = r#"{"target_dir":"../outside","title":"Bad","body":"Note body","confidence":0.9}"#;
        let cache = Arc::new(BookTextCache::default());
        let err = execute_local_tool(
            None,
            &tool_ctx,
            &cache,
            "write_reading_memory",
            args,
        )
        .await
        .unwrap_err();

        assert!(err.contains("invalid Reading Memory directory")
            || err.contains("outside allowed"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn reading_ai_system_prompt_covers_search_truncation() {
        assert!(READING_AI_SYSTEM_PROMPT.contains("truncated"));
        assert!(READING_AI_SYSTEM_PROMPT.contains("get_chapter_text"));
    }

    #[test]
    fn search_book_truncated_result_includes_hint() {
        use crate::book_text::{BookSearchHit, BookSearchResult};

        let result = BookSearchResult {
            hits: vec![BookSearchHit {
                index: 1,
                title: "Chapter".to_string(),
                excerpt: "excerpt".to_string(),
            }],
            truncated: true,
        };
        let json = serialize_search_book_tool_result(&result).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["truncated"], true);
        assert!(value["hint"]
            .as_str()
            .is_some_and(|hint| hint.contains("get_chapter_text")));
    }

    #[test]
    fn search_book_untruncated_result_omits_hint() {
        use crate::book_text::BookSearchResult;

        let result = BookSearchResult {
            hits: vec![],
            truncated: false,
        };
        let json = serialize_search_book_tool_result(&result).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["truncated"], false);
        assert!(value.get("hint").is_none());
    }

    #[tokio::test]
    #[serial_test::serial]
    async fn shared_book_text_cache_reuses_chapter_text_across_requests() {
        use crate::book_text::CHAPTER_EXTRACTIONS;
        use std::io::Write;
        use std::sync::atomic::Ordering;
        use zip::write::SimpleFileOptions;
        use zip::ZipWriter;

        fn write_minimal_epub(path: &std::path::Path) {
            let file = std::fs::File::create(path).expect("create epub");
            let mut zip = ZipWriter::new(file);
            let options = SimpleFileOptions::default();
            zip.start_file("mimetype", options).unwrap();
            zip.write_all(b"application/epub+zip").unwrap();
            zip.start_file("META-INF/container.xml", options).unwrap();
            zip.write_all(
                br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#,
            )
            .unwrap();
            zip.start_file("OEBPS/content.opf", options).unwrap();
            zip.write_all(
                br#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Shared</dc:title></metadata>
  <manifest>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>"#,
            )
            .unwrap();
            zip.start_file("OEBPS/chapter1.xhtml", options).unwrap();
            zip.write_all(
                br#"<?xml version="1.0"?><html><body><p>Shared cache body.</p></body></html>"#,
            )
            .unwrap();
            zip.finish().unwrap();
        }

        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "creader_shared_cache_{}_{}.epub",
            std::process::id(),
            nanos
        ));
        write_minimal_epub(&path);

        let shared = Arc::new(BookTextCache::with_default_capacity());
        CHAPTER_EXTRACTIONS.store(0, Ordering::SeqCst);

        let first = get_chapter_text_async(path.clone(), 0, None, None, Arc::clone(&shared))
            .await
            .unwrap();
        assert_eq!(first.text, "Shared cache body.");
        assert_eq!(CHAPTER_EXTRACTIONS.load(Ordering::SeqCst), 1);

        let second = get_chapter_text_async(path.clone(), 0, None, None, Arc::clone(&shared))
            .await
            .unwrap();
        assert_eq!(second.text, "Shared cache body.");
        assert_eq!(CHAPTER_EXTRACTIONS.load(Ordering::SeqCst), 1);

        let _ = std::fs::remove_file(path);
    }
}
