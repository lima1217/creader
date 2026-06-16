use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::sync::OnceLock;
use tauri::ipc::Channel;
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as TokioCommand;
use tokio::time::{timeout, Duration};

// Global state for selected AI provider
static SELECTED_PROVIDER: Mutex<Option<String>> = Mutex::new(None);
// Cache for AI availability check (to avoid slow repeated checks)
static AI_AVAILABILITY_CACHE: Mutex<Option<Vec<AIProviderInfo>>> = Mutex::new(None);
// Global cancel flag for AI streaming requests
static AI_CANCEL_FLAG: AtomicBool = AtomicBool::new(false);
const AI_TIMEOUT_SECS: u64 = 60;
const AI_AVAILABILITY_TIMEOUT_SECS: u64 = 5;

static COMMAND_PATH_CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn command_path_cache() -> &'static Mutex<HashMap<String, String>> {
    COMMAND_PATH_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn clear_command_path_cache() {
    if let Ok(mut cache) = command_path_cache().lock() {
        cache.clear();
    }
}

fn configure_command_path(cmd: &mut TokioCommand, cmd_path: &str) {
    let mut parts: Vec<String> = Vec::new();

    if let Some(parent) = Path::new(cmd_path).parent() {
        let p = parent.to_string_lossy().to_string();
        if !p.is_empty() {
            parts.push(p);
        }
    }

    // Common GUI-app PATH gaps on macOS.
    parts.push("/opt/homebrew/bin".to_string());
    parts.push("/usr/local/bin".to_string());
    parts.push("/usr/bin".to_string());
    parts.push("/bin".to_string());

    if let Ok(existing) = std::env::var("PATH") {
        if !existing.is_empty() {
            parts.push(existing);
        }
    }

    // De-duplicate while preserving order.
    let mut seen = std::collections::HashSet::<String>::new();
    parts.retain(|p| seen.insert(p.clone()));

    cmd.env("PATH", parts.join(":"));
}

fn ai_workdir() -> Option<PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
        .filter(|value| !value.is_empty())?;
    let home = PathBuf::from(home);
    let workdir = home.join(".creader").join("ai-workdir");

    if std::fs::create_dir_all(&workdir).is_ok() {
        Some(workdir)
    } else {
        Some(home)
    }
}

fn configure_ai_command(cmd: &mut TokioCommand, cmd_path: &str) {
    configure_command_path(cmd, cmd_path);
    if let Some(workdir) = ai_workdir() {
        cmd.current_dir(workdir);
    }
}

fn append_model_arg(cmd: &mut TokioCommand, model: Option<&str>) {
    if let Some(m) = model {
        let trimmed = m.trim();
        if !trimmed.is_empty() {
            cmd.arg("--model").arg(trimmed);
        }
    }
}

fn new_ai_command(cmd_name: &str) -> TokioCommand {
    let cmd_path = find_command(cmd_name);
    let mut cmd = TokioCommand::new(&cmd_path);
    configure_ai_command(&mut cmd, &cmd_path);
    cmd
}

fn new_hermes_command() -> TokioCommand {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    let hermes_root = PathBuf::from(home).join(".hermes").join("hermes-agent");
    let hermes_script = hermes_root.join("hermes");
    let hermes_python = hermes_root.join("venv").join("bin").join("python");

    if hermes_python.exists() && hermes_script.exists() {
        let python_path = hermes_python.to_string_lossy().to_string();
        let mut cmd = TokioCommand::new(&python_path);
        configure_ai_command(&mut cmd, &python_path);
        cmd.arg(hermes_script.to_string_lossy().to_string());
        cmd
    } else {
        new_ai_command("hermes")
    }
}

// Chat request structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub message: String,
    pub context: Option<String>,
    pub book_title: Option<String>,
    pub chapter_content: Option<String>,
    pub conversation_summary: Option<String>,
    pub history: Option<Vec<ChatHistoryItem>>,
    pub provider: Option<String>, // Optional: specify provider per request
    pub model: Option<String>,    // Optional: specify model (e.g., "sonnet", "opus", "haiku")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatHistoryItem {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummarizeConversationRequest {
    pub existing_summary: Option<String>,
    pub messages: Vec<ChatHistoryItem>,
    pub book_title: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
}

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
    pub provider: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadingMemoryDirectIngestResult {
    pub note_path: String,
    pub log_path: String,
    pub skipped: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ReadingMemoryDirectDecision {
    should_ingest: bool,
    target_dir: Option<String>,
    title: Option<String>,
    note_type: Option<String>,
    summary: Option<String>,
    body: Option<String>,
    links: Option<Vec<String>>,
    confidence: Option<f64>,
    reason: Option<String>,
}

// AI Provider info for frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIProviderInfo {
    pub id: String,
    pub name: String,
    pub model: String,
    pub available: bool,
}

// Stream events for AI responses
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum StreamEvent {
    /// Stream started
    Started { provider: String },
    /// A chunk of text data
    Chunk { text: String },
    /// Stream completed successfully
    Done { full_text: String },
    /// An error occurred
    Error {
        message: String,
        provider: Option<String>,
    },
}

// Build a rich prompt with context
fn build_prompt(request: &ChatRequest) -> String {
    let mut prompt_parts = Vec::new();

    // System context
    prompt_parts.push(
        r#"你是一个极其出色的阅读助手，同时诚实、并且关心这个世界。

永远不要出现"不是···，而是"的句式。不要出现破折号。不要用 emoji 表情。

- 自然语言与流畅度："像和熟人聊天一样重写这个"、"像在喝咖啡时和同事聊天一样解释这个"。

- 情感连接："增加回复的温度，同时保持专业性"、"用更具同理心和理解力的方式重述"。

- 个性化触感："多用'你'和'我们'让内容更个人化"。

- 技术平衡："简化技术信息，但保持准确性"、"像一个专家在进行随意交谈那样解释"。"#
            .to_string(),
    );

    // Book context
    if let Some(ref title) = request.book_title {
        prompt_parts.push(format!("\n\nCurrently reading: \"{}\"", title));
    }

    // Chapter content context (if provided)
    if let Some(ref content) = request.chapter_content {
        // Limit content to avoid token limits (safely handle UTF-8 char boundaries)
        let truncated = if content.len() > 3000 {
            // Find the last valid char boundary before 3000 bytes
            let mut end = 3000;
            while end > 0 && !content.is_char_boundary(end) {
                end -= 1;
            }
            format!("{}...[content truncated]", &content[..end])
        } else {
            content.clone()
        };
        prompt_parts.push(format!(
            "\n\nChapter background context:\n---\n{}\n---",
            truncated
        ));
    }

    // Selected text context
    if let Some(ref ctx) = request.context {
        prompt_parts.push(format!("\n\nUser has selected this text: \"{}\"", ctx));
    }

    if let Some(ref summary) = request.conversation_summary {
        if !summary.trim().is_empty() {
            prompt_parts.push(format!(
                "\n\nConversation memory summary. This is hidden running memory from earlier turns, not source text from the book:\n---\n{}\n---",
                summary.trim()
            ));
        }
    }

    // Include recent conversation history for context
    if let Some(ref history) = request.history {
        if !history.is_empty() {
            prompt_parts.push("\n\nRecent conversation:".to_string());
            // Frontend controls the history window size from user settings.
            let recent: Vec<_> = history.iter().collect();
            for item in recent {
                let role_label = if item.role == "user" {
                    "User"
                } else {
                    "Assistant"
                };
                prompt_parts.push(format!("{}: {}", role_label, item.content));
            }
        }
    }

    // Current user message
    prompt_parts.push(format!("\n\nUser's current question: {}", request.message));
    prompt_parts.push("\n\nPlease respond helpfully:".to_string());

    prompt_parts.join("")
}

fn build_summary_prompt(request: &SummarizeConversationRequest) -> String {
    let mut prompt_parts = Vec::new();
    prompt_parts.push(r#"你在维护一个阅读器 AI 对话的隐藏摘要记忆。请把旧对话压缩成一份短而有用的中文摘要，供后续继续回答用户问题时使用。

要求：
- 保留用户正在理解的问题、关键概念、已经形成的解释、未解决的疑问、用户偏好。
- 删除寒暄、重复、失败重试、临时 UI 操作。
- 不要把摘要写成书中原文；如果是对话推断，要保留这是对话记忆的语气。
- 控制在 800 字以内。
- 只输出摘要正文，不要标题。"#.to_string());

    if let Some(ref title) = request.book_title {
        prompt_parts.push(format!("\n\nCurrent book: \"{}\"", title));
    }

    if let Some(ref summary) = request.existing_summary {
        if !summary.trim().is_empty() {
            prompt_parts.push(format!(
                "\n\nExisting hidden summary:\n---\n{}\n---",
                summary.trim()
            ));
        }
    }

    prompt_parts.push("\n\nMessages to fold into the summary:".to_string());
    for item in request.messages.iter() {
        let role_label = if item.role == "user" {
            "User"
        } else {
            "Assistant"
        };
        prompt_parts.push(format!("{}: {}", role_label, item.content));
    }

    prompt_parts.join("")
}

fn truncate_for_prompt(value: &str, limit: usize) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= limit {
        return trimmed.to_string();
    }
    let mut out: String = trimmed.chars().take(limit).collect();
    out.push_str("...");
    out
}

fn build_reading_memory_direct_prompt(request: &ReadingMemoryDirectIngestRequest) -> String {
    let excerpt = request
        .selected_excerpt
        .as_deref()
        .map(|s| truncate_for_prompt(s, 1800))
        .unwrap_or_default();
    let answer = truncate_for_prompt(&request.assistant_answer, 2600);
    let question = truncate_for_prompt(&request.user_question, 900);

    format!(
        r#"你是 CReader 的 Reading Memory 写入审稿员。你的任务是判断这一轮阅读对话是否值得直接写入用户的本地 Markdown 知识仓库。

默认不要写入。只有当内容形成长期可复用的阅读知识对象时才写入，例如：
- 一个可复用概念、模型、原则、机制、反例、证据链、开放问题或清晰主张。
- 内容必须能从书籍来源或用户明确问题追溯出来。
- 如果用户明确要求“记住、保存、沉淀、加入 Reading Memory”，可以放宽门槛。

不要写入：
- 普通章节总结、继续总结、翻译、润色、闲聊、短期追问、苏格拉底式出题、工具提示词、重复解释。
- 只是复述 AI 回答全文，没有形成更小的知识对象。
- 没有来源且只是 AI 临时推断的内容。

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

字段要求：
- should_ingest 为 false 时，target_dir/title/body 使用 null，reason 用一句中文说明跳过原因。
- should_ingest 为 true 时，title 必须短，适合作为 Markdown 文件名；body 用中文写成可直接追加到笔记中的知识块，控制在 120-500 字，不要复制整段回答。
- body 必须区分“书中内容”和“AI 推断”。
- confidence 范围 0 到 1，低于 0.7 应该 should_ingest=false。

Book: {book_title}
Author: {book_author}
Chapter: {chapter}
CFI: {cfi}
Progress: {progress}

Selected source excerpt:
---
{excerpt}
---

User question:
---
{question}
---

Assistant answer:
---
{answer}
---"#,
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

// Find command in common paths (GUI apps don't inherit shell PATH)
fn find_command(cmd: &str) -> String {
    if let Ok(cache) = command_path_cache().lock() {
        if let Some(found) = cache.get(cmd) {
            return found.clone();
        }
    }

    // Get home directory - try multiple methods
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| {
            // Fallback: try to get from user info on macOS
            if let Ok(output) = StdCommand::new("sh").arg("-c").arg("echo $HOME").output() {
                let home = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !home.is_empty() {
                    return home;
                }
            }
            // Last resort - use a default that will likely fail gracefully
            String::new()
        });

    // Build list of paths to check - prioritize common locations
    let mut paths = vec![
        format!("{}/.hermes/hermes-agent/{}", home, cmd), // Hermes local agent
        format!("{}/.local/bin/{}", home, cmd),           // ~/.local/bin (Codex CLI)
        format!("{}/.cargo/bin/{}", home, cmd),           // Cargo installs
        format!("{}/.bun/bin/{}", home, cmd),             // Bun installs
    ];

    // Check NVM versions dynamically
    let nvm_versions_dir = format!("{}/.nvm/versions/node", home);
    if let Ok(entries) = std::fs::read_dir(&nvm_versions_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let bin_path = entry.path().join("bin").join(cmd);
                if bin_path.exists() {
                    return bin_path.to_string_lossy().to_string();
                }
            }
        }
    }

    // Python version paths
    for py_version in &["3.9", "3.10", "3.11", "3.12", "3.13"] {
        paths.push(format!(
            "{}/Library/Python/{}/bin/{}",
            home, py_version, cmd
        ));
    }

    // System paths
    paths.push("/opt/homebrew/bin/".to_string() + cmd); // Homebrew ARM
    paths.push("/usr/local/bin/".to_string() + cmd); // Homebrew Intel / system
    paths.push("/usr/bin/".to_string() + cmd); // System

    for path in &paths {
        if std::path::Path::new(path).exists() {
            if let Ok(mut cache) = command_path_cache().lock() {
                cache.insert(cmd.to_string(), path.clone());
            }
            return path.clone();
        }
    }

    // Fallback to just the command name (might work if PATH is set)
    let fallback = cmd.to_string();
    if let Ok(mut cache) = command_path_cache().lock() {
        cache.insert(cmd.to_string(), fallback.clone());
    }
    fallback
}

async fn run_with_timeout(mut cmd: TokioCommand) -> Option<std::process::Output> {
    timeout(Duration::from_secs(AI_TIMEOUT_SECS), cmd.output())
        .await
        .ok()?
        .ok()
}

// Try Codex CLI
async fn try_codex(prompt: &str) -> Option<String> {
    let output = run_with_timeout({
        let mut cmd = new_ai_command("codex");
        cmd.arg("-p").arg(prompt);
        cmd
    })
    .await?;

    if output.status.success() {
        let response = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !response.is_empty() {
            return Some(response);
        }
    }
    None
}

async fn try_opencode(prompt: &str) -> Option<String> {
    let output = run_with_timeout({
        let mut cmd = new_ai_command("opencode");
        cmd.arg("run").arg(prompt);
        cmd
    })
    .await?;

    if output.status.success() {
        let response = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !response.is_empty() {
            return Some(response);
        }
    }

    None
}

async fn try_hermes(prompt: &str, model: Option<&str>) -> Option<String> {
    let output = run_with_timeout({
        let mut cmd = new_hermes_command();
        cmd.arg("-z").arg(prompt);
        append_model_arg(&mut cmd, model);
        cmd
    })
    .await?;

    if output.status.success() {
        let response = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !response.is_empty() {
            return Some(response);
        }
    }

    None
}

// Try Claude CLI
async fn try_claude(prompt: &str, model: Option<&str>) -> Option<String> {
    let output = run_with_timeout({
        let mut cmd = new_ai_command("claude");
        cmd.arg("-p").arg(prompt);
        append_model_arg(&mut cmd, model);
        cmd
    })
    .await?;

    if output.status.success() {
        let response = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !response.is_empty() {
            return Some(response);
        }
    }
    None
}

// Try Claude CLI with streaming output (with cancel support)
async fn try_claude_streaming(
    prompt: &str,
    model: Option<&str>,
    on_event: &Channel<StreamEvent>,
) -> Option<String> {
    let mut cmd = new_ai_command("claude");
    cmd.arg("-p")
        .arg(prompt)
        .arg("--output-format")
        .arg("stream-json")
        .arg("--verbose")
        .arg("--include-partial-messages");

    append_model_arg(&mut cmd, model);

    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let stdout = child.stdout.take()?;
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    let mut full_text = String::new();
    let mut was_cancelled = false;

    // Send started event
    let _ = on_event.send(StreamEvent::Started {
        provider: "claude".to_string(),
    });

    // Process streaming output line by line
    while let Ok(Some(line)) = lines.next_line().await {
        // Check if cancelled
        if AI_CANCEL_FLAG.load(Ordering::Relaxed) {
            was_cancelled = true;
            // Kill the child process
            let _ = child.kill().await;
            break;
        }

        // Parse JSON line to extract text delta
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
            // Check for content_block_delta with text_delta
            if json.get("type").and_then(|t| t.as_str()) == Some("stream_event") {
                if let Some(event) = json.get("event") {
                    if event.get("type").and_then(|t| t.as_str()) == Some("content_block_delta") {
                        if let Some(delta) = event.get("delta") {
                            if delta.get("type").and_then(|t| t.as_str()) == Some("text_delta") {
                                if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
                                    full_text.push_str(text);
                                    let _ = on_event.send(StreamEvent::Chunk {
                                        text: text.to_string(),
                                    });
                                }
                            }
                        }
                    }
                }
            }
            // Check for final result
            if json.get("type").and_then(|t| t.as_str()) == Some("result") {
                if let Some(result) = json.get("result").and_then(|r| r.as_str()) {
                    // If we didn't get streaming chunks, use the final result
                    if full_text.is_empty() {
                        full_text = result.to_string();
                    }
                }
            }
        }
    }

    // Wait for the process to finish
    let _ = child.wait().await;

    // Handle cancellation
    if was_cancelled {
        // Send cancelled event with partial content
        let _ = on_event.send(StreamEvent::Done {
            full_text: if full_text.is_empty() {
                "[Generation stopped by user]".to_string()
            } else {
                format!("{}\n\n[Generation stopped by user]", full_text)
            },
        });
        return Some(full_text);
    }

    if !full_text.is_empty() {
        let _ = on_event.send(StreamEvent::Done {
            full_text: full_text.clone(),
        });
        Some(full_text)
    } else {
        None
    }
}

fn selected_ai_provider(provider: Option<String>) -> String {
    provider
        .or_else(|| SELECTED_PROVIDER.lock().ok()?.clone())
        .unwrap_or_else(|| "claude".to_string())
}

fn ai_fallback_order(provider: &str) -> Vec<&'static str> {
    match provider {
        "hermes" => vec!["claude", "codex", "opencode"],
        "codex" => vec!["claude", "hermes", "opencode"],
        "claude" => vec!["hermes", "codex", "opencode"],
        "opencode" => vec!["hermes", "codex", "claude"],
        _ => vec!["hermes", "codex", "claude", "opencode"],
    }
}

async fn try_ai_provider(provider: &str, prompt: &str, model: Option<&str>) -> Option<String> {
    match provider {
        "codex" => try_codex(prompt).await,
        "claude" => try_claude(prompt, model).await,
        "opencode" => try_opencode(prompt).await,
        "hermes" => try_hermes(prompt, model).await,
        _ => None,
    }
}

async fn check_cli_available(mut cmd: TokioCommand) -> bool {
    timeout(
        Duration::from_secs(AI_AVAILABILITY_TIMEOUT_SECS),
        cmd.output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok())
    .map(|o| o.status.success())
    .unwrap_or(false)
}

async fn do_check_ai_availability() -> Vec<AIProviderInfo> {
    let codex_task = tokio::spawn(async move {
        check_cli_available({
            let mut cmd = new_ai_command("codex");
            cmd.arg("--version");
            cmd
        })
        .await
    });
    let claude_task = tokio::spawn(async move {
        check_cli_available({
            let mut cmd = new_ai_command("claude");
            cmd.arg("--version");
            cmd
        })
        .await
    });
    let opencode_task = tokio::spawn(async move {
        check_cli_available({
            let mut cmd = new_ai_command("opencode");
            cmd.arg("--version");
            cmd
        })
        .await
    });
    let hermes_task = tokio::spawn(async move {
        check_cli_available({
            let mut cmd = new_hermes_command();
            cmd.arg("--version");
            cmd
        })
        .await
    });

    let codex_available = codex_task.await.unwrap_or(false);
    let claude_available = claude_task.await.unwrap_or(false);
    let opencode_available = opencode_task.await.unwrap_or(false);
    let hermes_available = hermes_task.await.unwrap_or(false);

    vec![
        AIProviderInfo {
            id: "hermes".to_string(),
            name: "Hermes".to_string(),
            model: "Hermes Agent".to_string(),
            available: hermes_available,
        },
        AIProviderInfo {
            id: "codex".to_string(),
            name: "Codex CLI".to_string(),
            model: "Codex".to_string(),
            available: codex_available,
        },
        AIProviderInfo {
            id: "claude".to_string(),
            name: "Claude Code".to_string(),
            model: "Claude".to_string(),
            available: claude_available,
        },
        AIProviderInfo {
            id: "opencode".to_string(),
            name: "OpenCode".to_string(),
            model: "OpenCode".to_string(),
            available: opencode_available,
        },
    ]
}

// Check which AI CLIs are available and return detailed info (uses cache after first call)
#[tauri::command]
async fn check_ai_availability() -> Vec<AIProviderInfo> {
    // Try to return cached result first
    if let Ok(cache) = AI_AVAILABILITY_CACHE.lock() {
        if let Some(ref cached) = *cache {
            return cached.clone();
        }
    }

    // Perform actual check
    let providers = do_check_ai_availability().await;

    // Cache the result
    if let Ok(mut cache) = AI_AVAILABILITY_CACHE.lock() {
        *cache = Some(providers.clone());
    }

    providers
}

// Force refresh AI availability check (clears cache and re-checks)
#[tauri::command]
async fn refresh_ai_availability() -> Vec<AIProviderInfo> {
    clear_command_path_cache();
    let providers = do_check_ai_availability().await;

    // Update cache
    if let Ok(mut cache) = AI_AVAILABILITY_CACHE.lock() {
        *cache = Some(providers.clone());
    }

    providers
}

// Get currently selected AI provider
#[tauri::command]
fn get_ai_provider() -> Option<String> {
    SELECTED_PROVIDER.lock().ok()?.clone()
}

// Set AI provider
#[tauri::command]
fn set_ai_provider(provider: String) -> Result<(), String> {
    let valid_providers = ["hermes", "codex", "claude", "opencode"];
    if !valid_providers.contains(&provider.as_str()) {
        return Err(format!(
            "Invalid provider: {}. Valid options: {:?}",
            provider, valid_providers
        ));
    }

    if let Ok(mut selected) = SELECTED_PROVIDER.lock() {
        *selected = Some(provider);
        Ok(())
    } else {
        Err("Failed to set provider".to_string())
    }
}

// Cancel ongoing AI streaming request
#[tauri::command]
fn cancel_ai_streaming() {
    AI_CANCEL_FLAG.store(true, Ordering::Relaxed);
}

// Reset AI cancel flag (call before starting a new request)
#[tauri::command]
fn reset_ai_cancel() {
    AI_CANCEL_FLAG.store(false, Ordering::Relaxed);
}

#[tauri::command]
async fn summarize_ai_conversation(
    request: SummarizeConversationRequest,
) -> Result<String, String> {
    if request.messages.is_empty() {
        return Ok(request.existing_summary.unwrap_or_default());
    }

    let prompt = build_summary_prompt(&request);
    run_ai_oneshot_with_fallback(&prompt, request.provider, request.model.as_deref())
        .await
        .ok_or_else(|| "No AI CLI available to summarize conversation.".to_string())
}

async fn run_ai_oneshot_with_fallback(
    prompt: &str,
    provider: Option<String>,
    model: Option<&str>,
) -> Option<String> {
    let provider = selected_ai_provider(provider);

    let selected = try_ai_provider(&provider, prompt, model).await;
    if selected.is_some() {
        return selected;
    }

    for fallback in ai_fallback_order(&provider) {
        let response = try_ai_provider(fallback, prompt, model).await;
        if response.is_some() {
            return response;
        }
    }

    None
}

// Streaming chat with AI using Tauri Channel
#[tauri::command]
async fn chat_with_ai_streaming(
    request: ChatRequest,
    on_event: Channel<StreamEvent>,
) -> Result<(), String> {
    let prompt = build_prompt(&request);

    let provider = selected_ai_provider(request.provider.clone());

    // Currently only Claude supports streaming
    if provider == "claude" {
        if let Some(_) = try_claude_streaming(&prompt, request.model.as_deref(), &on_event).await {
            return Ok(());
        }
    }

    // Fallback to non-streaming for other providers or if Claude streaming fails
    // Check if cancelled before proceeding
    if AI_CANCEL_FLAG.load(Ordering::Relaxed) {
        let _ = on_event.send(StreamEvent::Done {
            full_text: "[Generation stopped by user]".to_string(),
        });
        return Ok(());
    }

    let result = try_ai_provider(&provider, &prompt, request.model.as_deref()).await;

    // Check if cancelled after getting result
    if AI_CANCEL_FLAG.load(Ordering::Relaxed) {
        let _ = on_event.send(StreamEvent::Done {
            full_text: "[Generation stopped by user]".to_string(),
        });
        return Ok(());
    }

    if let Some(response) = result {
        let _ = on_event.send(StreamEvent::Started {
            provider: provider.clone(),
        });
        let _ = on_event.send(StreamEvent::Chunk {
            text: response.clone(),
        });
        let _ = on_event.send(StreamEvent::Done {
            full_text: response,
        });
        return Ok(());
    }

    // Try fallback providers
    for fallback in ai_fallback_order(&provider) {
        // Check if cancelled at start of each iteration
        if AI_CANCEL_FLAG.load(Ordering::Relaxed) {
            let _ = on_event.send(StreamEvent::Done {
                full_text: "[Generation stopped by user]".to_string(),
            });
            return Ok(());
        }

        // Try streaming for Claude in fallback
        if fallback == "claude" {
            if let Some(_) =
                try_claude_streaming(&prompt, request.model.as_deref(), &on_event).await
            {
                return Ok(());
            }
        }

        let result = try_ai_provider(fallback, &prompt, request.model.as_deref()).await;

        // Check if cancelled after getting result
        if AI_CANCEL_FLAG.load(Ordering::Relaxed) {
            let _ = on_event.send(StreamEvent::Done {
                full_text: "[Generation stopped by user]".to_string(),
            });
            return Ok(());
        }

        if let Some(response) = result {
            let _ = on_event.send(StreamEvent::Started {
                provider: fallback.to_string(),
            });
            let _ = on_event.send(StreamEvent::Chunk {
                text: response.clone(),
            });
            let _ = on_event.send(StreamEvent::Done {
                full_text: response,
            });
            return Ok(());
        }
    }

    let _ = on_event.send(StreamEvent::Error {
        message: "No AI CLI available. Please install hermes, codex, claude, or opencode CLI."
            .to_string(),
        provider: Some(provider),
    });

    Err("No AI CLI available".to_string())
}

// Response for book import
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportBookResult {
    pub new_path: String,
    pub book_id: String,
}

fn ensure_books_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let books_dir = app_data_dir.join("books");

    if !books_dir.exists() {
        std::fs::create_dir_all(&books_dir)
            .map_err(|e| format!("Failed to create books directory: {}", e))?;
    }

    std::fs::canonicalize(&books_dir)
        .map_err(|e| format!("Failed to resolve books directory: {}", e))
}

fn canonicalize_if_exists(path: &Path) -> Option<PathBuf> {
    std::fs::canonicalize(path).ok()
}

fn allowed_read_roots(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Ok(dir) = app.path().document_dir() {
        if let Some(canon) = canonicalize_if_exists(&dir) {
            roots.push(canon);
        }
    }
    if let Ok(dir) = app.path().desktop_dir() {
        if let Some(canon) = canonicalize_if_exists(&dir) {
            roots.push(canon);
        }
    }
    if let Ok(dir) = app.path().download_dir() {
        if let Some(canon) = canonicalize_if_exists(&dir) {
            roots.push(canon);
        }
    }

    if let Ok(books_dir) = ensure_books_dir(app) {
        roots.push(books_dir);
    }

    roots
}

fn is_supported_book_extension(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
        return false;
    };
    matches!(ext.to_ascii_lowercase().as_str(), "epub")
}

fn is_under_any_root(candidate: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|root| candidate.starts_with(root))
}

fn validate_book_path_inner(app: &tauri::AppHandle, file_path: &str) -> bool {
    let candidate = Path::new(file_path);
    if !candidate.exists() || !candidate.is_file() {
        return false;
    }
    if !is_supported_book_extension(candidate) {
        return false;
    }

    let allowed_roots = allowed_read_roots(app);
    let candidate = match std::fs::canonicalize(candidate) {
        Ok(p) => p,
        Err(_) => return false,
    };
    is_under_any_root(&candidate, &allowed_roots)
}

// Import a book by copying it to the app's books directory
#[tauri::command]
fn import_book_to_library(
    app: tauri::AppHandle,
    source_path: String,
    book_id: String,
) -> Result<ImportBookResult, String> {
    let source = Path::new(&source_path);

    // Verify source file exists
    if !source.exists() {
        return Err(format!("Source file does not exist: {}", source_path));
    }
    if !source.is_file() {
        return Err(format!("Source path is not a file: {}", source_path));
    }
    if !is_supported_book_extension(source) {
        return Err("Unsupported book file type. Only EPUB is supported.".to_string());
    }

    let allowed_roots = allowed_read_roots(&app);
    let source_canon = std::fs::canonicalize(source)
        .map_err(|e| format!("Failed to resolve source path: {}", e))?;
    if !is_under_any_root(&source_canon, &allowed_roots) {
        return Err("Refusing to import file outside allowed directories".to_string());
    }

    // Get the file name
    let file_name = source
        .file_name()
        .ok_or("Invalid source file name")?
        .to_str()
        .ok_or("Invalid file name encoding")?;

    // Create a unique file name using book_id to avoid conflicts
    let extension = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("epub");
    let new_file_name = format!("{}_{}.{}", book_id, sanitize_filename(file_name), extension);

    let books_dir = ensure_books_dir(&app)?;

    let dest_path = books_dir.join(&new_file_name);

    // Copy the file
    std::fs::copy(source, &dest_path).map_err(|e| format!("Failed to copy file: {}", e))?;

    let new_path = dest_path
        .to_str()
        .ok_or("Invalid destination path encoding")?
        .to_string();

    Ok(ImportBookResult { new_path, book_id })
}

// Validate if a book file exists at the given path
#[tauri::command]
fn validate_book_path(app: tauri::AppHandle, file_path: String) -> bool {
    validate_book_path_inner(&app, &file_path)
}

#[tauri::command]
fn validate_book_paths(app: tauri::AppHandle, file_paths: Vec<String>) -> Vec<bool> {
    file_paths
        .iter()
        .map(|p| validate_book_path_inner(&app, p))
        .collect()
}

// Result for finding a book in the library
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FindBookResult {
    pub found: bool,
    pub path: Option<String>,
}

// Try to find a book file in the app's books directory by book_id or filename pattern
#[tauri::command]
fn find_book_in_library(
    app: tauri::AppHandle,
    book_id: String,
    original_filename: Option<String>,
) -> Result<FindBookResult, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let books_dir = app_data_dir.join("books");

    if !books_dir.exists() {
        return Ok(FindBookResult {
            found: false,
            path: None,
        });
    }

    // First, try to find by book_id prefix
    if let Ok(entries) = std::fs::read_dir(&books_dir) {
        for entry in entries.flatten() {
            let file_name = entry.file_name().to_string_lossy().to_string();
            // Check if file starts with the book_id
            if file_name.starts_with(&format!("{}_", book_id)) {
                if let Some(path_str) = entry.path().to_str() {
                    return Ok(FindBookResult {
                        found: true,
                        path: Some(path_str.to_string()),
                    });
                }
            }
        }
    }

    // Second, try to find by original filename (partial match)
    if let Some(orig_name) = original_filename {
        // Extract the base name without extension
        let orig_base = orig_name
            .rsplit_once('.')
            .map(|(n, _)| n)
            .unwrap_or(&orig_name);
        let sanitized = sanitize_filename(orig_base);

        if let Ok(entries) = std::fs::read_dir(&books_dir) {
            for entry in entries.flatten() {
                let file_name = entry.file_name().to_string_lossy().to_string();
                // Check if file contains the sanitized original name
                if file_name.contains(&sanitized) {
                    if let Some(path_str) = entry.path().to_str() {
                        return Ok(FindBookResult {
                            found: true,
                            path: Some(path_str.to_string()),
                        });
                    }
                }
            }
        }
    }

    Ok(FindBookResult {
        found: false,
        path: None,
    })
}

// Delete a book file from the library
#[tauri::command]
fn delete_book_file(app: tauri::AppHandle, file_path: String) -> Result<(), String> {
    let path = std::path::Path::new(&file_path);

    if !path.exists() {
        return Ok(());
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let books_dir = app_data_dir.join("books");
    if !books_dir.exists() {
        return Ok(());
    }

    let books_dir = std::fs::canonicalize(&books_dir)
        .map_err(|e| format!("Failed to resolve books directory: {}", e))?;
    let path =
        std::fs::canonicalize(path).map_err(|e| format!("Failed to resolve file path: {}", e))?;

    if !path.starts_with(&books_dir) {
        return Err("Refusing to delete file outside library directory".to_string());
    }

    if path.is_file() {
        std::fs::remove_file(&path).map_err(|e| format!("Failed to delete file: {}", e))?;
    }

    Ok(())
}

// Helper function to sanitize file names
fn sanitize_filename(name: &str) -> String {
    // Remove the extension if present
    let name = name.rsplit_once('.').map(|(n, _)| n).unwrap_or(name);

    // Replace invalid characters
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim()
        .to_string()
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

fn safe_wiki_title(input: &str) -> String {
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

fn allowed_reading_memory_dir(dir: &str) -> Option<&'static str> {
    match dir.trim() {
        "books" => Some("books"),
        "concepts" => Some("concepts"),
        "questions" => Some("questions"),
        "claims" => Some("claims"),
        _ => None,
    }
}

fn normalize_note_type(value: Option<&str>, target_dir: &str) -> &'static str {
    match value.unwrap_or("").trim() {
        "book" => "book",
        "concept" => "concept",
        "question" => "question",
        "claim" => "claim",
        "note" => "note",
        _ => match target_dir {
            "books" => "book",
            "concepts" => "concept",
            "questions" => "question",
            "claims" => "claim",
            _ => "note",
        },
    }
}

fn extract_json_object(raw: &str) -> Option<&str> {
    let start = raw.find('{')?;
    let end = raw.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(&raw[start..=end])
}

fn content_hash(input: &str) -> String {
    let mut hasher = DefaultHasher::new();
    input.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn build_direct_reading_memory_markdown(
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

    format!(
        r#"
## CReader Ingestion

```yaml
type: {note_type}
source_app: CReader
source_book: {source_book}
source_author: {source_author}
source_chapter: {source_chapter}
source_cfi: {source_cfi}
source_progress: {source_progress:.2}
target_dir: {target_dir}
confidence: {confidence:.2}
ingestion_reason: {reason}
```

### Source
{source}

### Question
{question}

### Note
{body}

### Links
{links}
"#,
        note_type = note_type,
        source_book = escape_json_string(&request.book_title),
        source_author = escape_json_string(request.book_author.as_deref().unwrap_or("")),
        source_chapter = escape_json_string(request.source_chapter.as_deref().unwrap_or("")),
        source_cfi = escape_json_string(request.source_cfi.as_deref().unwrap_or("")),
        source_progress = request.source_progress.unwrap_or(0.0),
        target_dir = target_dir,
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

fn escape_json_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

fn timestamp_millis() -> Result<u128, String> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .map_err(|e| format!("System clock error: {}", e))
}

#[tauri::command]
fn ensure_reading_memory_repository(root_path: String) -> Result<String, String> {
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

    let index_path = root.join("index.md");
    if !index_path.exists() {
        std::fs::write(
            &index_path,
            "# Reading Memory\n\n- `books/`, `concepts/`, `questions/`, and `claims/` capture AI-reviewed CReader ingestions.\n- `.reading-memory/ingestion-log.jsonl` records automatic writes for linting and rollback.\n",
        )
        .map_err(|e| format!("Failed to write index.md: {}", e))?;
    }

    let rules_path = root.join(".reading-memory").join("lint-rules.md");
    if !rules_path.exists() {
        std::fs::write(
            &rules_path,
            "# Reading Memory Lint Rules\n\n- Preserve source metadata and original excerpts.\n- Merge duplicate notes across `books/`, `concepts/`, `questions/`, and `claims/`.\n- Improve links and headings without removing source traceability.\n- Mark low-value automatic blocks as archived during routine lint instead of deleting them silently.\n",
        )
        .map_err(|e| format!("Failed to write lint-rules.md: {}", e))?;
    }

    root.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid repository path encoding".to_string())
}

#[tauri::command]
async fn ingest_reading_memory_direct(
    request: ReadingMemoryDirectIngestRequest,
) -> Result<ReadingMemoryDirectIngestResult, String> {
    let root = ensure_reading_memory_repository(request.root_path.clone())?;
    let root = PathBuf::from(root);
    let meta_dir = root.join(".reading-memory");
    std::fs::create_dir_all(&meta_dir)
        .map_err(|e| format!("Failed to create metadata directory: {}", e))?;

    if request.assistant_answer.trim().is_empty()
        || request.assistant_answer.contains("No AI CLI available")
        || request.assistant_answer.contains("Generation stopped")
    {
        return Ok(ReadingMemoryDirectIngestResult {
            note_path: String::new(),
            log_path: meta_dir
                .join("ingestion-log.jsonl")
                .to_string_lossy()
                .to_string(),
            skipped: true,
            reason: "assistant answer is empty, failed, or interrupted".to_string(),
        });
    }

    let prompt = build_reading_memory_direct_prompt(&request);
    let raw = match run_ai_oneshot_with_fallback(
        &prompt,
        request.provider.clone(),
        request.model.as_deref(),
    )
    .await
    {
        Some(response) => response,
        None => {
            return Ok(ReadingMemoryDirectIngestResult {
                note_path: String::new(),
                log_path: meta_dir
                    .join("ingestion-log.jsonl")
                    .to_string_lossy()
                    .to_string(),
                skipped: true,
                reason: "no AI provider available for Reading Memory ingestion review".to_string(),
            });
        }
    };

    let json_text = extract_json_object(&raw)
        .ok_or_else(|| "Reading Memory ingestion review did not return JSON".to_string())?;
    let decision: ReadingMemoryDirectDecision = serde_json::from_str(json_text)
        .map_err(|e| format!("Failed to parse Reading Memory ingestion JSON: {}", e))?;
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

    let dir = root.join(target_dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create {}: {}", target_dir, e))?;
    let note_path = dir.join(format!("{}.md", title));
    let new_file = !note_path.exists();
    let block = build_direct_reading_memory_markdown(&request, &decision, note_type, target_dir);
    let block_hash = content_hash(&block);

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&note_path)
        .map_err(|e| format!("Failed to open Reading Memory note: {}", e))?;
    if new_file {
        writeln!(file, "# {}\n", title)
            .map_err(|e| format!("Failed to write Reading Memory title: {}", e))?;
    }
    writeln!(file, "\n{}", block)
        .map_err(|e| format!("Failed to append Reading Memory note: {}", e))?;

    let millis = timestamp_millis()?;
    let log_path = meta_dir.join("ingestion-log.jsonl");
    let log_entry = serde_json::json!({
        "created_at_ms": millis,
        "source_app": "CReader",
        "mode": "direct",
        "action": if new_file { "create" } else { "append" },
        "note_path": note_path.to_string_lossy(),
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
            .ok_or_else(|| "Invalid note path encoding".to_string())?,
        log_path: log_path
            .to_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "Invalid log path encoding".to_string())?,
        skipped: false,
        reason: "ingested".to_string(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            chat_with_ai_streaming,
            summarize_ai_conversation,
            check_ai_availability,
            refresh_ai_availability,
            get_ai_provider,
            set_ai_provider,
            cancel_ai_streaming,
            reset_ai_cancel,
            import_book_to_library,
            delete_book_file,
            validate_book_path,
            validate_book_paths,
            find_book_in_library,
            ensure_reading_memory_repository,
            ingest_reading_memory_direct
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
    fn supported_extensions() {
        assert!(is_supported_book_extension(Path::new("a.epub")));
        assert!(is_supported_book_extension(Path::new("a.EPUB")));
        assert!(!is_supported_book_extension(Path::new("a.pdf")));
        assert!(!is_supported_book_extension(Path::new("a.md")));
        assert!(!is_supported_book_extension(Path::new("a.markdown")));
        assert!(!is_supported_book_extension(Path::new("a.txt")));
        assert!(!is_supported_book_extension(Path::new("a")));
    }

    #[test]
    fn under_any_root_matches_canonical_paths() {
        let root1 = unique_temp_dir("root1");
        let root2 = unique_temp_dir("root2");
        std::fs::create_dir_all(&root1).unwrap();
        std::fs::create_dir_all(&root2).unwrap();

        let nested = root1.join("nested");
        std::fs::create_dir_all(&nested).unwrap();
        let file = nested.join("book.epub");
        std::fs::write(&file, b"test").unwrap();

        let roots = vec![
            std::fs::canonicalize(&root1).unwrap(),
            std::fs::canonicalize(&root2).unwrap(),
        ];
        let candidate = std::fs::canonicalize(&file).unwrap();
        assert!(is_under_any_root(&candidate, &roots));

        let outside = unique_temp_dir("outside").join("x.epub");
        std::fs::create_dir_all(outside.parent().unwrap()).unwrap();
        std::fs::write(&outside, b"test").unwrap();
        let outside = std::fs::canonicalize(&outside).unwrap();
        assert!(!is_under_any_root(&outside, &roots));

        let _ = std::fs::remove_dir_all(&root1);
        let _ = std::fs::remove_dir_all(&root2);
    }

    #[test]
    fn build_prompt_includes_context_and_truncates() {
        let request = ChatRequest {
            message: "What does this mean?".to_string(),
            context: Some("selected".to_string()),
            book_title: Some("Book".to_string()),
            chapter_content: Some("a".repeat(4000)),
            conversation_summary: Some("Earlier conversation memory".to_string()),
            history: Some(vec![
                ChatHistoryItem {
                    role: "user".to_string(),
                    content: "u1".to_string(),
                },
                ChatHistoryItem {
                    role: "assistant".to_string(),
                    content: "a1".to_string(),
                },
                ChatHistoryItem {
                    role: "user".to_string(),
                    content: "u2".to_string(),
                },
            ]),
            provider: None,
            model: None,
        };

        let prompt = build_prompt(&request);
        assert!(prompt.contains("Currently reading: \"Book\""));
        assert!(prompt.contains("User has selected this text: \"selected\""));
        assert!(prompt.contains("User's current question: What does this mean?"));
        assert!(prompt.contains("...[content truncated]"));
        assert!(prompt.contains("Conversation memory summary"));
        assert!(prompt.contains("Earlier conversation memory"));
        assert!(prompt.contains("Recent conversation:"));
        assert!(prompt.contains("User: u1"));
        assert!(prompt.contains("Assistant: a1"));
    }

    #[test]
    fn build_summary_prompt_preserves_existing_summary_and_messages() {
        let request = SummarizeConversationRequest {
            existing_summary: Some("旧摘要".to_string()),
            messages: vec![
                ChatHistoryItem {
                    role: "user".to_string(),
                    content: "我关心机会成本".to_string(),
                },
                ChatHistoryItem {
                    role: "assistant".to_string(),
                    content: "机会成本是决策比较的核心。".to_string(),
                },
            ],
            book_title: Some("Book".to_string()),
            provider: None,
            model: None,
        };

        let prompt = build_summary_prompt(&request);
        assert!(prompt.contains("Existing hidden summary"));
        assert!(prompt.contains("旧摘要"));
        assert!(prompt.contains("Current book: \"Book\""));
        assert!(prompt.contains("User: 我关心机会成本"));
        assert!(prompt.contains("Assistant: 机会成本是决策比较的核心。"));
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
            provider: None,
            model: None,
        };

        let prompt = build_reading_memory_direct_prompt(&request);
        assert!(prompt.contains("普通章节总结"));
        assert!(prompt.contains("默认不要写入"));
        assert!(prompt.contains("\"should_ingest\": boolean"));
        assert!(prompt.contains("继续总结第二章"));
    }

    #[test]
    fn safe_wiki_title_and_allowed_dirs_restrict_model_output() {
        assert_eq!(safe_wiki_title("../概念/机会成本?.md"), "概念 机会成本 md");
        assert_eq!(allowed_reading_memory_dir("concepts"), Some("concepts"));
        assert_eq!(allowed_reading_memory_dir("../outside"), None);
        assert_eq!(normalize_note_type(Some("weird"), "claims"), "claim");
    }

    #[test]
    fn hermes_provider_is_valid() {
        assert!(set_ai_provider("hermes".to_string()).is_ok());
        assert_eq!(get_ai_provider(), Some("hermes".to_string()));
    }

    #[test]
    fn ai_fallback_order_prefers_complementary_providers() {
        assert_eq!(ai_fallback_order("claude"), vec!["hermes", "codex", "opencode"]);
        assert_eq!(ai_fallback_order("hermes"), vec!["claude", "codex", "opencode"]);
        assert_eq!(ai_fallback_order("unknown"), vec!["hermes", "codex", "claude", "opencode"]);
    }
}
