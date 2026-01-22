use serde::{Deserialize, Serialize};
use std::process::Command as StdCommand;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
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

// Greet command (keep for testing)
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// AI Provider enum
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AIProvider {
    Droid,  // Factory Droid with GLM-4.7
    Claude, // Claude Code CLI
    Gemini,
    OpenAI,
}

// Chat request structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub message: String,
    pub context: Option<String>,
    pub book_title: Option<String>,
    pub chapter_content: Option<String>,
    pub history: Option<Vec<ChatHistoryItem>>,
    pub provider: Option<String>, // Optional: specify provider per request
    pub model: Option<String>,    // Optional: specify model (e.g., "sonnet", "opus", "haiku")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatHistoryItem {
    pub role: String,
    pub content: String,
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
    Error { message: String },
}

// Build a rich prompt with context
fn build_prompt(request: &ChatRequest) -> String {
    let mut prompt_parts = Vec::new();

    // System context
    prompt_parts.push(r#"你是用户的**首席深度思维教练（Chief Thinking Coach）**。你的任务是利用人类文明中最优秀的思维模型，拆解问题本质，提供极具洞察力、批判性和启发性的回应。

永远不要出现"不是···，而是"的句式。不要出现破折号。不要用emjio表情。

- 自然语言与流畅度："像和熟人聊天一样重写这个"、"像在喝咖啡时和同事聊天一样解释这个"。

- 情感连接："增加回复的温度，同时保持专业性"、"用更具同理心和理解力的方式重述"。

- 个性化触感："多用'你'和'我们'让内容更个人化"。

- 技术平衡："简化技术信息，但保持准确性"、"像一个专家在进行随意交谈那样解释"。"#.to_string());

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
            "\n\nCurrent chapter content:\n---\n{}\n---",
            truncated
        ));
    }

    // Selected text context
    if let Some(ref ctx) = request.context {
        prompt_parts.push(format!("\n\nUser has selected this text: \"{}\"", ctx));
    }

    // Include recent conversation history for context
    if let Some(ref history) = request.history {
        if !history.is_empty() {
            prompt_parts.push("\n\nRecent conversation:".to_string());
            // Only include last 5 messages to avoid too long prompts
            let recent: Vec<_> = history.iter().rev().take(5).rev().collect();
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

// Find command in common paths (GUI apps don't inherit shell PATH)
fn find_command(cmd: &str) -> String {
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
        format!("{}/.local/bin/{}", home, cmd), // ~/.local/bin (Factory Droid)
        format!("{}/.cargo/bin/{}", home, cmd), // Cargo installs
        format!("{}/.bun/bin/{}", home, cmd),   // Bun installs
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
            return path.clone();
        }
    }

    // Fallback to just the command name (might work if PATH is set)
    cmd.to_string()
}

async fn run_with_timeout(mut cmd: TokioCommand) -> Option<std::process::Output> {
    timeout(Duration::from_secs(AI_TIMEOUT_SECS), cmd.output())
        .await
        .ok()?
        .ok()
}

// Try Factory Droid CLI with GLM-4.7 model
async fn try_droid(prompt: &str) -> Option<String> {
    let droid_cmd = find_command("droid");
    let output = run_with_timeout({
        let mut cmd = TokioCommand::new(&droid_cmd);
        cmd.arg("exec")
            .arg("--model")
            .arg("custom:glm-4.7")
            .arg(prompt);
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

// Try Gemini CLI
async fn try_gemini(prompt: &str) -> Option<String> {
    let gemini_cmd = find_command("gemini");
    let output = run_with_timeout({
        let mut cmd = TokioCommand::new(&gemini_cmd);
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

// Try Claude CLI
async fn try_claude(prompt: &str, model: Option<&str>) -> Option<String> {
    let claude_cmd = find_command("claude");
    let output = run_with_timeout({
        let mut cmd = TokioCommand::new(&claude_cmd);
        cmd.arg("-p").arg(prompt);
        // Add model parameter if specified
        if let Some(m) = model {
            cmd.arg("--model").arg(m);
        }
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
    let claude_cmd = find_command("claude");

    let mut cmd = TokioCommand::new(&claude_cmd);
    cmd.arg("-p")
        .arg(prompt)
        .arg("--output-format")
        .arg("stream-json")
        .arg("--verbose")
        .arg("--include-partial-messages");

    // Add model parameter if specified
    if let Some(m) = model {
        cmd.arg("--model").arg(m);
    }

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

// Try OpenAI CLI
async fn try_openai(prompt: &str) -> Option<String> {
    let openai_cmd = find_command("openai");
    let output = run_with_timeout({
        let mut cmd = TokioCommand::new(openai_cmd);
        cmd.arg("api")
            .arg("chat.completions.create")
            .arg("-m")
            .arg("gpt-4")
            .arg("-g")
            .arg("user")
            .arg(prompt);
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

// Helper function to perform actual AI availability check
fn do_check_ai_availability() -> Vec<AIProviderInfo> {
    let mut providers = Vec::new();

    // Check Factory Droid (GLM-4.7)
    let droid_cmd = find_command("droid");
    let droid_available = StdCommand::new(&droid_cmd)
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    providers.push(AIProviderInfo {
        id: "droid".to_string(),
        name: "Factory Droid".to_string(),
        model: "GLM-4.7".to_string(),
        available: droid_available,
    });

    // Check Claude CLI
    let claude_cmd = find_command("claude");
    let claude_available = StdCommand::new(&claude_cmd)
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    providers.push(AIProviderInfo {
        id: "claude".to_string(),
        name: "Claude Code".to_string(),
        model: "Claude".to_string(),
        available: claude_available,
    });

    // Check Gemini CLI
    let gemini_cmd = find_command("gemini");
    let gemini_available = StdCommand::new(&gemini_cmd)
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    providers.push(AIProviderInfo {
        id: "gemini".to_string(),
        name: "Google Gemini".to_string(),
        model: "Gemini".to_string(),
        available: gemini_available,
    });

    // Check OpenAI CLI
    let openai_cmd = find_command("openai");
    let openai_available = StdCommand::new(&openai_cmd)
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    providers.push(AIProviderInfo {
        id: "openai".to_string(),
        name: "OpenAI".to_string(),
        model: "GPT-4".to_string(),
        available: openai_available,
    });

    providers
}

// Check which AI CLIs are available and return detailed info (uses cache after first call)
#[tauri::command]
fn check_ai_availability() -> Vec<AIProviderInfo> {
    // Try to return cached result first
    if let Ok(cache) = AI_AVAILABILITY_CACHE.lock() {
        if let Some(ref cached) = *cache {
            return cached.clone();
        }
    }

    // Perform actual check
    let providers = do_check_ai_availability();

    // Cache the result
    if let Ok(mut cache) = AI_AVAILABILITY_CACHE.lock() {
        *cache = Some(providers.clone());
    }

    providers
}

// Force refresh AI availability check (clears cache and re-checks)
#[tauri::command]
fn refresh_ai_availability() -> Vec<AIProviderInfo> {
    let providers = do_check_ai_availability();

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
    let valid_providers = ["droid", "claude", "gemini", "openai"];
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

// Simple chat command (backward compatible)
#[tauri::command]
async fn chat_with_ai(message: String, context: Option<String>) -> Result<String, String> {
    let request = ChatRequest {
        message,
        context,
        book_title: None,
        chapter_content: None,
        history: None,
        provider: None,
        model: None,
    };

    chat_with_ai_advanced(request).await
}

// Advanced chat with full context
#[tauri::command]
async fn chat_with_ai_advanced(request: ChatRequest) -> Result<String, String> {
    let prompt = build_prompt(&request);

    // Determine which provider to use
    let provider = request
        .provider
        .or_else(|| SELECTED_PROVIDER.lock().ok()?.clone())
        .unwrap_or_else(|| "claude".to_string()); // Default to Claude

    // Try the selected provider first
    match provider.as_str() {
        "droid" => {
            if let Some(response) = try_droid(&prompt).await {
                return Ok(response);
            }
        }
        "claude" => {
            if let Some(response) = try_claude(&prompt, request.model.as_deref()).await {
                return Ok(response);
            }
        }
        "gemini" => {
            if let Some(response) = try_gemini(&prompt).await {
                return Ok(response);
            }
        }
        "openai" => {
            if let Some(response) = try_openai(&prompt).await {
                return Ok(response);
            }
        }
        _ => {}
    }

    // Fallback: try other providers if selected one fails
    let fallback_order = match provider.as_str() {
        "droid" => vec!["claude", "gemini", "openai"],
        "claude" => vec!["droid", "gemini", "openai"],
        "gemini" => vec!["droid", "claude", "openai"],
        "openai" => vec!["droid", "claude", "gemini"],
        _ => vec!["droid", "claude", "gemini", "openai"],
    };

    for fallback in fallback_order {
        let response = match fallback {
            "droid" => try_droid(&prompt).await,
            "claude" => try_claude(&prompt, request.model.as_deref()).await,
            "gemini" => try_gemini(&prompt).await,
            "openai" => try_openai(&prompt).await,
            _ => None,
        };
        if let Some(response) = response {
            return Ok(response);
        }
    }

    Err("No AI CLI available. Please install one of: droid (Factory), claude, gemini, or openai CLI.".to_string())
}

// Streaming chat with AI using Tauri Channel
#[tauri::command]
async fn chat_with_ai_streaming(
    request: ChatRequest,
    on_event: Channel<StreamEvent>,
) -> Result<(), String> {
    let prompt = build_prompt(&request);

    // Determine which provider to use
    let provider = request
        .provider
        .or_else(|| SELECTED_PROVIDER.lock().ok()?.clone())
        .unwrap_or_else(|| "claude".to_string());

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

    let result = match provider.as_str() {
        "droid" => try_droid(&prompt).await,
        "claude" => try_claude(&prompt, request.model.as_deref()).await, // Non-streaming fallback
        "gemini" => try_gemini(&prompt).await,
        "openai" => try_openai(&prompt).await,
        _ => None,
    };

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
    let fallback_order = match provider.as_str() {
        "droid" => vec!["claude", "gemini", "openai"],
        "claude" => vec!["droid", "gemini", "openai"],
        "gemini" => vec!["droid", "claude", "openai"],
        "openai" => vec!["droid", "claude", "gemini"],
        _ => vec!["claude", "droid", "gemini", "openai"],
    };

    for fallback in fallback_order {
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

        let result = match fallback {
            "droid" => try_droid(&prompt).await,
            "claude" => try_claude(&prompt, request.model.as_deref()).await,
            "gemini" => try_gemini(&prompt).await,
            "openai" => try_openai(&prompt).await,
            _ => None,
        };

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
        message: "No AI CLI available. Please install claude, gemini, openai, or droid CLI."
            .to_string(),
    });

    Err("No AI CLI available".to_string())
}

// Response for book import
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportBookResult {
    pub new_path: String,
    pub book_id: String,
}

// Get the books directory path in app data
#[tauri::command]
fn get_books_directory(app: tauri::AppHandle) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let books_dir = app_data_dir.join("books");

    // Create the directory if it doesn't exist
    if !books_dir.exists() {
        std::fs::create_dir_all(&books_dir)
            .map_err(|e| format!("Failed to create books directory: {}", e))?;
    }

    books_dir
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid path encoding".to_string())
}

// Import a book by copying it to the app's books directory
#[tauri::command]
fn import_book_to_library(
    app: tauri::AppHandle,
    source_path: String,
    book_id: String,
) -> Result<ImportBookResult, String> {
    let source = std::path::Path::new(&source_path);

    // Verify source file exists
    if !source.exists() {
        return Err(format!("Source file does not exist: {}", source_path));
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

    // Get the books directory
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let books_dir = app_data_dir.join("books");

    // Create the directory if it doesn't exist
    if !books_dir.exists() {
        std::fs::create_dir_all(&books_dir)
            .map_err(|e| format!("Failed to create books directory: {}", e))?;
    }

    let dest_path = books_dir.join(&new_file_name);

    // Copy the file
    std::fs::copy(source, &dest_path).map_err(|e| format!("Failed to copy file: {}", e))?;

    let new_path = dest_path
        .to_str()
        .ok_or("Invalid destination path encoding")?
        .to_string();

    Ok(ImportBookResult { new_path, book_id })
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            chat_with_ai,
            chat_with_ai_advanced,
            chat_with_ai_streaming,
            check_ai_availability,
            refresh_ai_availability,
            get_ai_provider,
            set_ai_provider,
            cancel_ai_streaming,
            reset_ai_cancel,
            get_books_directory,
            import_book_to_library,
            delete_book_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_prompt_includes_context_and_truncates() {
        let request = ChatRequest {
            message: "What does this mean?".to_string(),
            context: Some("selected".to_string()),
            book_title: Some("Book".to_string()),
            chapter_content: Some("a".repeat(4000)),
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
        assert!(prompt.contains("Recent conversation:"));
        assert!(prompt.contains("User: u1"));
        assert!(prompt.contains("Assistant: a1"));
    }
}
