use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::ipc::Channel;
use tokio_util::sync::CancellationToken;

use super::reading_tools::{
    execute_local_tool, is_deduplicable_readonly_tool, reading_ai_tools,
    resolve_book_text_cache, tool_activity_detail, AiToolContext, ToolCallResultCache,
};
use super::{
    build_openai_chat_request, build_openai_chat_request_from_prompt, openai_api_base,
    AIProviderConfig, StreamEvent,
};

const AI_TIMEOUT_SECS: u64 = 120;
/// Default tool rounds when the client omits `max_tool_rounds`.
pub(crate) const DEFAULT_MAX_TOOL_ROUNDS: usize = 10;
const MIN_MAX_TOOL_ROUNDS: usize = 2;
const HARD_MAX_TOOL_ROUNDS: usize = 24;
const TOOLS_EXHAUSTED_SYSTEM_PROMPT: &str =
    "工具调用次数已用尽。请基于已获取的信息直接作答，并在末尾用一行说明还缺少哪些信息或无法确认的部分，不要继续要求调用工具。";

#[derive(Default)]
struct PartialToolCall {
    id: Option<String>,
    name: String,
    arguments: String,
}

#[derive(Default)]
struct ToolCallAccumulator {
    calls: HashMap<u32, PartialToolCall>,
}

impl ToolCallAccumulator {
    fn merge_chunk(&mut self, chunk: &async_openai::types::chat::ChatCompletionMessageToolCallChunk) {
        let entry = self.calls.entry(chunk.index).or_default();
        if let Some(id) = &chunk.id {
            entry.id = Some(id.clone());
        }
        if let Some(function) = &chunk.function {
            if let Some(name) = &function.name {
                if !name.is_empty() {
                    entry.name = name.clone();
                }
            }
            if let Some(args) = &function.arguments {
                entry.arguments.push_str(args);
            }
        }
    }

    fn into_resolved_calls(self) -> Vec<(String, String, String)> {
        let mut indices: Vec<u32> = self.calls.keys().copied().collect();
        indices.sort_unstable();
        indices
            .into_iter()
            .filter_map(|index| {
                let call = self.calls.get(&index)?;
                if call.name.is_empty() {
                    return None;
                }
                Some((
                    call.id
                        .clone()
                        .unwrap_or_else(|| format!("call_{index}")),
                    call.name.clone(),
                    call.arguments.clone(),
                ))
            })
            .collect()
    }
}

pub(crate) fn resolve_max_tool_rounds(limit: Option<usize>) -> usize {
    limit
        .unwrap_or(DEFAULT_MAX_TOOL_ROUNDS)
        .clamp(MIN_MAX_TOOL_ROUNDS, HARD_MAX_TOOL_ROUNDS)
}

fn openai_client(
    config: &AIProviderConfig,
    api_key: &str,
) -> async_openai::Client<async_openai::config::OpenAIConfig> {
    let openai_config = async_openai::config::OpenAIConfig::new()
        .with_api_base(openai_api_base(&config.base_url))
        .with_api_key(api_key);
    async_openai::Client::with_config(openai_config)
}

pub(crate) async fn chat_completion_stream_typed<F, G>(
    initial_messages: Vec<async_openai::types::chat::ChatCompletionRequestMessage>,
    config: &AIProviderConfig,
    api_key: &str,
    tool_ctx: Option<&AiToolContext>,
    app: Option<&tauri::AppHandle>,
    thinking_enabled: bool,
    max_tool_rounds: usize,
    cancel: Option<&CancellationToken>,
    mut on_chunk: F,
    mut on_tool_activity: G,
) -> Result<String, String>
where
    F: FnMut(String),
    G: FnMut(&str, &str, Option<String>),
{
    if cancel.is_some_and(|token| token.is_cancelled()) {
        return Ok(String::new());
    }

    use async_openai::types::chat::{
        ChatCompletionMessageToolCall, ChatCompletionMessageToolCalls,
        ChatCompletionRequestAssistantMessage, ChatCompletionRequestMessage,
        ChatCompletionRequestSystemMessage, ChatCompletionRequestToolMessage, FinishReason,
        FunctionCall,
    };
    use futures_util::StreamExt;

    let client = openai_client(config, api_key);
    let mut messages = initial_messages;
    let tools = tool_ctx.map(|_| reading_ai_tools());
    let mut tools_active = tools.is_some();
    let mut tool_rounds_used = 0usize;
    let chapter_cache = resolve_book_text_cache(app);
    let mut tool_result_cache = ToolCallResultCache::default();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(AI_TIMEOUT_SECS);
    let chat = client.chat();

    let mut full_text = String::new();

    loop {
        if cancel.is_some_and(|token| token.is_cancelled()) {
            break;
        }

        let request = build_openai_chat_request(
            messages.clone(),
            &config.model,
            true,
            0.7,
            if tools_active { tools.clone() } else { None },
            thinking_enabled,
        )?;

        let stream_future = chat.create_stream(request);
        let mut stream = tokio::time::timeout_at(deadline, stream_future)
            .await
            .map_err(|_| format!("AI request timed out after {} seconds", AI_TIMEOUT_SECS))?
            .map_err(|e| format!("OpenAI client stream request failed: {}", e))?;

        let mut round_text = String::new();
        let mut tool_accumulator = ToolCallAccumulator::default();
        let mut finish_reason: Option<FinishReason> = None;

        loop {
            if cancel.is_some_and(|token| token.is_cancelled()) {
                break;
            }
            let next = tokio::time::timeout_at(deadline, stream.next())
                .await
                .map_err(|_| format!("AI stream timed out after {} seconds", AI_TIMEOUT_SECS))?;
            let Some(chunk_result) = next else {
                break;
            };
            let chunk = chunk_result
                .map_err(|e| format!("OpenAI client stream read failed: {}", e))?;
            for choice in chunk.choices {
                if let Some(reason) = choice.finish_reason {
                    finish_reason = Some(reason);
                }
                if let Some(piece) = choice.delta.content {
                    if !piece.is_empty() {
                        round_text.push_str(&piece);
                        full_text.push_str(&piece);
                        on_chunk(piece);
                    }
                }
                if let Some(tool_calls) = choice.delta.tool_calls {
                    for tool_call in tool_calls {
                        tool_accumulator.merge_chunk(&tool_call);
                    }
                }
            }
        }

        if cancel.is_some_and(|token| token.is_cancelled()) {
            break;
        }

        if finish_reason != Some(FinishReason::ToolCalls) {
            break;
        }

        if !tools_active {
            break;
        }

        let resolved_calls = tool_accumulator.into_resolved_calls();
        if resolved_calls.is_empty() {
            break;
        }

        if tool_ctx.is_none() {
            return Err("Model requested tools but no tool context was provided".to_string());
        }
        let tool_ctx = tool_ctx.expect("tool context checked above");

        let mut assistant_tool_calls = Vec::with_capacity(resolved_calls.len());
        for (id, name, arguments) in &resolved_calls {
            assistant_tool_calls.push(ChatCompletionMessageToolCalls::Function(
                ChatCompletionMessageToolCall {
                    id: id.clone(),
                    function: FunctionCall {
                        name: name.clone(),
                        arguments: arguments.clone(),
                    },
                },
            ));
        }

        messages.push(ChatCompletionRequestMessage::Assistant(
            ChatCompletionRequestAssistantMessage {
                content: if round_text.is_empty() {
                    None
                } else {
                    Some(round_text.into())
                },
                tool_calls: Some(assistant_tool_calls),
                ..Default::default()
            },
        ));

        tool_rounds_used += 1;

        enum CallExecution {
            Resolved { tool_result: String, status: &'static str },
            ReadonlyPending,
            WritePending,
        }

        struct ResolvedToolCall {
            id: String,
            name: String,
            arguments: String,
            execution: CallExecution,
        }

        let mut calls: Vec<ResolvedToolCall> = Vec::with_capacity(resolved_calls.len());
        for (id, name, arguments) in resolved_calls {
            let detail = tool_activity_detail(&name, "started", &arguments);
            on_tool_activity(&name, "started", detail);
            let execution = if let Some(cached) = tool_result_cache.lookup(&name, &arguments) {
                CallExecution::Resolved {
                    tool_result: cached,
                    status: "completed",
                }
            } else if is_deduplicable_readonly_tool(&name) {
                CallExecution::ReadonlyPending
            } else {
                CallExecution::WritePending
            };
            calls.push(ResolvedToolCall {
                id,
                name,
                arguments,
                execution,
            });
        }

        let readonly_tasks: Vec<_> = calls
            .iter()
            .enumerate()
            .filter(|(_, call)| matches!(call.execution, CallExecution::ReadonlyPending))
            .map(|(index, call)| {
                let name = call.name.clone();
                let arguments = call.arguments.clone();
                let cache = Arc::clone(&chapter_cache);
                async move {
                    let result = execute_local_tool(
                        app,
                        tool_ctx,
                        &cache,
                        &name,
                        &arguments,
                    )
                    .await;
                    (index, name, arguments, result)
                }
            })
            .collect();

        for (index, name, arguments, result) in futures_util::future::join_all(readonly_tasks).await
        {
            let (tool_result, status) = match result {
                Ok(result) => {
                    tool_result_cache.store(&name, &arguments, &result);
                    (result, "completed")
                }
                Err(err) => (serde_json::json!({ "error": err }).to_string(), "failed"),
            };
            calls[index].execution = CallExecution::Resolved {
                tool_result,
                status,
            };
        }

        for call in &mut calls {
            if !matches!(call.execution, CallExecution::WritePending) {
                continue;
            }
            let name = call.name.clone();
            let arguments = call.arguments.clone();
            let result = execute_local_tool(app, tool_ctx, &chapter_cache, &name, &arguments)
                .await;
            let (tool_result, status) = match result {
                Ok(result) => {
                    tool_result_cache.store(&name, &arguments, &result);
                    (result, "completed")
                }
                Err(err) => (serde_json::json!({ "error": err }).to_string(), "failed"),
            };
            call.execution = CallExecution::Resolved {
                tool_result,
                status,
            };
        }

        for call in calls {
            let CallExecution::Resolved {
                tool_result,
                status,
            } = call.execution
            else {
                unreachable!("all tool calls should be resolved before emitting results")
            };
            let detail = tool_activity_detail(&call.name, status, &call.arguments);
            on_tool_activity(&call.name, status, detail);
            messages.push(ChatCompletionRequestMessage::Tool(
                ChatCompletionRequestToolMessage {
                    content: tool_result.into(),
                    tool_call_id: call.id,
                },
            ));
        }

        if tool_rounds_used >= max_tool_rounds {
            tools_active = false;
            messages.push(ChatCompletionRequestMessage::System(
                ChatCompletionRequestSystemMessage {
                    content: TOOLS_EXHAUSTED_SYSTEM_PROMPT.into(),
                    ..Default::default()
                },
            ));
        }
    }

    Ok(full_text)
}

/// Streaming chat completion over an OpenAI-compatible endpoint. Emits
/// `StreamEvent`s through the Tauri Channel, honoring the request cancel token.
pub(crate) async fn chat_completion_stream(
    initial_messages: Vec<async_openai::types::chat::ChatCompletionRequestMessage>,
    config: &AIProviderConfig,
    api_key: &str,
    tool_ctx: Option<&AiToolContext>,
    app: Option<&tauri::AppHandle>,
    thinking_enabled: bool,
    max_tool_rounds: usize,
    cancel: Option<&CancellationToken>,
    on_event: &Channel<StreamEvent>,
) -> Result<String, String> {
    let _ = on_event.send(StreamEvent::Started {
        provider: config.name.clone(),
    });

    chat_completion_stream_typed(
        initial_messages,
        config,
        api_key,
        tool_ctx,
        app,
        thinking_enabled,
        max_tool_rounds,
        cancel,
        |piece| {
            let _ = on_event.send(StreamEvent::Chunk { text: piece });
        },
        |name, status, detail| {
            let _ = on_event.send(StreamEvent::ToolActivity {
                name: name.to_string(),
                status: status.to_string(),
                detail,
            });
        },
    )
    .await
}

/// One-shot (non-streaming) chat completion. Returns the full assistant text.
pub(crate) async fn chat_completion_oneshot(
    prompt: &str,
    config: &AIProviderConfig,
    api_key: &str,
) -> Result<String, String> {
    chat_completion_oneshot_typed(prompt, config, api_key).await
}

pub(crate) async fn chat_completion_oneshot_typed(
    prompt: &str,
    config: &AIProviderConfig,
    api_key: &str,
) -> Result<String, String> {
    let client = openai_client(config, api_key);
    let request = build_openai_chat_request_from_prompt(prompt, &config.model, None, false, 0.3)?;

    let chat = client.chat();
    let response = tokio::time::timeout(Duration::from_secs(AI_TIMEOUT_SECS), chat.create(request))
        .await
        .map_err(|_| format!("AI request timed out after {} seconds", AI_TIMEOUT_SECS))?
        .map_err(|e| format!("OpenAI client request failed: {}", e))?;

    response
        .choices
        .into_iter()
        .next()
        .and_then(|choice| choice.message.content)
        .ok_or_else(|| "API response missing choices[0].message.content".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::thread;

    fn spawn_chat_completion_server(
        response_body: &'static str,
    ) -> (String, mpsc::Receiver<String>, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let (tx, rx) = mpsc::channel();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = Vec::new();
            let mut temp = [0_u8; 1024];
            let mut header_end = None;
            let mut content_length = 0_usize;

            loop {
                let read = stream.read(&mut temp).unwrap();
                if read == 0 {
                    break;
                }
                buffer.extend_from_slice(&temp[..read]);
                if header_end.is_none() {
                    if let Some(pos) = buffer.windows(4).position(|w| w == b"\r\n\r\n") {
                        header_end = Some(pos + 4);
                        let headers = String::from_utf8_lossy(&buffer[..pos]);
                        content_length = headers
                            .lines()
                            .find_map(|line| {
                                let (name, value) = line.split_once(':')?;
                                name.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse::<usize>().ok())
                                    .flatten()
                            })
                            .unwrap_or(0);
                    }
                }
                if let Some(end) = header_end {
                    if buffer.len() >= end + content_length {
                        break;
                    }
                }
            }

            tx.send(String::from_utf8_lossy(&buffer).to_string())
                .unwrap();
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                response_body.as_bytes().len(),
                response_body
            );
            stream.write_all(response.as_bytes()).unwrap();
        });
        (base_url, rx, handle)
    }

    fn spawn_sequential_chat_server(
        responses: Vec<&'static str>,
    ) -> (String, mpsc::Receiver<Vec<String>>, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let (tx, rx) = mpsc::channel();
        let handle = thread::spawn(move || {
            let mut captured = Vec::new();
            for response_body in responses {
                let (mut stream, _) = listener.accept().unwrap();
                let mut buffer = Vec::new();
                let mut temp = [0_u8; 1024];
                let mut header_end = None;
                let mut content_length = 0_usize;

                loop {
                    let read = stream.read(&mut temp).unwrap();
                    if read == 0 {
                        break;
                    }
                    buffer.extend_from_slice(&temp[..read]);
                    if header_end.is_none() {
                        if let Some(pos) = buffer.windows(4).position(|w| w == b"\r\n\r\n") {
                            header_end = Some(pos + 4);
                            let headers = String::from_utf8_lossy(&buffer[..pos]);
                            content_length = headers
                                .lines()
                                .find_map(|line| {
                                    let (name, value) = line.split_once(':')?;
                                    name.eq_ignore_ascii_case("content-length")
                                        .then(|| value.trim().parse::<usize>().ok())
                                        .flatten()
                                })
                                .unwrap_or(0);
                        }
                    }
                    if let Some(end) = header_end {
                        if buffer.len() >= end + content_length {
                            break;
                        }
                    }
                }

                captured.push(String::from_utf8_lossy(&buffer).to_string());
                let response = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    response_body.as_bytes().len(),
                    response_body
                );
                stream.write_all(response.as_bytes()).unwrap();
            }
            tx.send(captured).unwrap();
        });
        (base_url, rx, handle)
    }

    fn sample_tool_ctx() -> AiToolContext {
        AiToolContext {
            book_file_path: Some("/tmp/missing-book.epub".to_string()),
            book_title: Some("Test Book".to_string()),
            book_author: Some("Author".to_string()),
            source_chapter: Some("Chapter 1".to_string()),
            source_cfi: None,
            source_progress: Some(10.0),
            reading_memory_path: None,
            user_question: "Explain chapter two".to_string(),
            selected_excerpt: Some("selected".to_string()),
        }
    }

    const TOOL_CALL_ROUND: &'static str = concat!(
        "data: {\"id\":\"chatcmpl-tool\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"reader-model\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_list\",\"type\":\"function\",\"function\":{\"name\":\"list_chapters\",\"arguments\":\"\"}}]},\"finish_reason\":null}]}\n\n",
        "data: {\"id\":\"chatcmpl-tool\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"reader-model\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"{}\"}}]},\"finish_reason\":null}]}\n\n",
        "data: {\"id\":\"chatcmpl-tool\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"reader-model\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n",
        "data: [DONE]\n\n"
    );

    const FINAL_TEXT_ROUND: &'static str = concat!(
        "data: {\"id\":\"chatcmpl-final\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"reader-model\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Final\"},\"finish_reason\":null}]}\n\n",
        "data: {\"id\":\"chatcmpl-final\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"reader-model\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\" answer\"},\"finish_reason\":\"stop\"}]}\n\n",
        "data: [DONE]\n\n"
    );

    fn sample_stream_messages() -> Vec<async_openai::types::chat::ChatCompletionRequestMessage> {
        use async_openai::types::chat::ChatCompletionRequestUserMessage;

        vec![ChatCompletionRequestUserMessage::from("prompt text").into()]
    }

    #[test]
    fn tool_call_accumulator_merges_streaming_chunks() {
        use async_openai::types::chat::ChatCompletionMessageToolCallChunk;
        use async_openai::types::chat::FunctionCallStream;
        use async_openai::types::chat::FunctionType;

        let mut acc = ToolCallAccumulator::default();
        acc.merge_chunk(&ChatCompletionMessageToolCallChunk {
            index: 0,
            id: Some("call_1".to_string()),
            r#type: Some(FunctionType::Function),
            function: Some(FunctionCallStream {
                name: Some("list_chapters".to_string()),
                arguments: Some("{".to_string()),
            }),
        });
        acc.merge_chunk(&ChatCompletionMessageToolCallChunk {
            index: 0,
            id: None,
            r#type: None,
            function: Some(FunctionCallStream {
                name: None,
                arguments: Some("}".to_string()),
            }),
        });

        let calls = acc.into_resolved_calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "call_1");
        assert_eq!(calls[0].1, "list_chapters");
        assert_eq!(calls[0].2, "{}");
    }

    #[test]
    fn resolve_max_tool_rounds_clamps_and_defaults() {
        assert_eq!(resolve_max_tool_rounds(None), DEFAULT_MAX_TOOL_ROUNDS);
        assert_eq!(resolve_max_tool_rounds(Some(12)), 12);
        assert_eq!(resolve_max_tool_rounds(Some(1)), 2);
        assert_eq!(resolve_max_tool_rounds(Some(99)), 24);
    }

    #[tokio::test]
    async fn typed_stream_runs_single_tool_round_then_final_answer() {
        let (base_url, request_rx, server) =
            spawn_sequential_chat_server(vec![TOOL_CALL_ROUND, FINAL_TEXT_ROUND]);
        let config = AIProviderConfig {
            id: "local".to_string(),
            name: "Local".to_string(),
            base_url: format!("{}/v1", base_url),
            model: "reader-model".to_string(),
        };
        let tool_ctx = sample_tool_ctx();
        let mut chunks = Vec::new();

        let full_text = chat_completion_stream_typed(
            sample_stream_messages(),
            &config,
            "secret-key",
            Some(&tool_ctx),
            None,
            false,
            DEFAULT_MAX_TOOL_ROUNDS,
            None,
            |piece| chunks.push(piece),
            |_, _, _| {},
        )
        .await
        .unwrap();

        assert_eq!(full_text, "Final answer");
        assert_eq!(chunks, vec!["Final".to_string(), " answer".to_string()]);
        let requests = request_rx.recv().unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[0].contains("POST /v1/chat/completions"));
        assert!(requests[1].contains("POST /v1/chat/completions"));
        let second_body = requests[1].split("\r\n\r\n").nth(1).unwrap();
        let second_json: serde_json::Value = serde_json::from_str(second_body).unwrap();
        let messages = second_json["messages"].as_array().unwrap();
        assert!(messages.iter().any(|m| m["role"] == "tool"));
        server.join().unwrap();
    }

    #[tokio::test]
    async fn typed_stream_runs_readonly_tools_concurrently_in_one_round() {
        let dual_get_chapter_round = concat!(
            "data: {\"id\":\"chatcmpl-dual\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"reader-model\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_get_0\",\"type\":\"function\",\"function\":{\"name\":\"get_chapter_text\",\"arguments\":\"{\\\"index\\\":0}\"}},{\"index\":1,\"id\":\"call_get_1\",\"type\":\"function\",\"function\":{\"name\":\"get_chapter_text\",\"arguments\":\"{\\\"index\\\":1}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n",
            "data: [DONE]\n\n"
        );
        let (base_url, _request_rx, server) =
            spawn_sequential_chat_server(vec![dual_get_chapter_round, FINAL_TEXT_ROUND]);
        let config = AIProviderConfig {
            id: "local".to_string(),
            name: "Local".to_string(),
            base_url: format!("{}/v1", base_url),
            model: "reader-model".to_string(),
        };
        let tool_ctx = sample_tool_ctx();
        let activity = std::sync::Arc::new(std::sync::Mutex::new(Vec::<(String, String)>::new()));
        let activity_for_callback = std::sync::Arc::clone(&activity);

        let full_text = chat_completion_stream_typed(
            sample_stream_messages(),
            &config,
            "secret-key",
            Some(&tool_ctx),
            None,
            false,
            DEFAULT_MAX_TOOL_ROUNDS,
            None,
            |_| {},
            move |name, status, _| {
                if name == "get_chapter_text" {
                    activity_for_callback
                        .lock()
                        .unwrap()
                        .push((name.to_string(), status.to_string()));
                }
            },
        )
        .await
        .unwrap();

        assert_eq!(full_text, "Final answer");
        let events = activity.lock().unwrap();
        let terminal_status = |status: &str| status == "completed" || status == "failed";
        let first_terminal = events
            .iter()
            .position(|(_, status)| terminal_status(status))
            .expect("each tool call should finish");
        let started_before_first_terminal = events[..first_terminal]
            .iter()
            .filter(|(_, status)| status == "started")
            .count();
        assert_eq!(
            started_before_first_terminal, 2,
            "both get_chapter_text calls should start before either completes; got {:?}",
            *events
        );
        server.join().unwrap();
    }

    #[tokio::test]
    async fn typed_stream_runs_multi_tool_rounds() {
        let get_chapter_round = concat!(
            "data: {\"id\":\"chatcmpl-get\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"reader-model\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_get\",\"type\":\"function\",\"function\":{\"name\":\"get_chapter_text\",\"arguments\":\"{\\\"index\\\":1}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n",
            "data: [DONE]\n\n"
        );
        let (base_url, request_rx, server) = spawn_sequential_chat_server(vec![
            TOOL_CALL_ROUND,
            get_chapter_round,
            FINAL_TEXT_ROUND,
        ]);
        let config = AIProviderConfig {
            id: "local".to_string(),
            name: "Local".to_string(),
            base_url: format!("{}/v1", base_url),
            model: "reader-model".to_string(),
        };
        let tool_ctx = sample_tool_ctx();

        let full_text = chat_completion_stream_typed(
            sample_stream_messages(),
            &config,
            "secret-key",
            Some(&tool_ctx),
            None,
            false,
            DEFAULT_MAX_TOOL_ROUNDS,
            None,
            |_| {},
            |_, _, _| {},
        )
        .await
        .unwrap();

        assert_eq!(full_text, "Final answer");
        assert_eq!(request_rx.recv().unwrap().len(), 3);
        server.join().unwrap();
    }

    #[tokio::test]
    async fn typed_stream_without_tool_calls_keeps_pure_text_path() {
        let response_body = concat!(
            "data: {\"id\":\"chatcmpl-test\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"reader-model\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hello\"},\"finish_reason\":\"stop\"}]}\n\n",
            "data: [DONE]\n\n"
        );
        let (base_url, request_rx, server) = spawn_chat_completion_server(response_body);
        let config = AIProviderConfig {
            id: "local".to_string(),
            name: "Local".to_string(),
            base_url: format!("{}/v1", base_url),
            model: "reader-model".to_string(),
        };
        let tool_ctx = sample_tool_ctx();

        let full_text = chat_completion_stream_typed(
            sample_stream_messages(),
            &config,
            "secret-key",
            Some(&tool_ctx),
            None,
            false,
            DEFAULT_MAX_TOOL_ROUNDS,
            None,
            |_| {},
            |_, _, _| {},
        )
        .await
        .unwrap();

        assert_eq!(full_text, "Hello");
        let body = request_rx.recv().unwrap();
        let json: serde_json::Value =
            serde_json::from_str(body.split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert!(json["messages"]
            .as_array()
            .unwrap()
            .iter()
            .all(|message| message["role"] != "tool"));
        server.join().unwrap();
    }

    #[tokio::test]
    async fn typed_stream_disables_tools_after_max_rounds_and_finishes() {
        let limit = 4usize;
        let mut responses = vec![TOOL_CALL_ROUND; limit];
        responses.push(FINAL_TEXT_ROUND);
        let (base_url, request_rx, server) = spawn_sequential_chat_server(responses);
        let config = AIProviderConfig {
            id: "local".to_string(),
            name: "Local".to_string(),
            base_url: format!("{}/v1", base_url),
            model: "reader-model".to_string(),
        };
        let tool_ctx = sample_tool_ctx();

        let full_text = chat_completion_stream_typed(
            sample_stream_messages(),
            &config,
            "secret-key",
            Some(&tool_ctx),
            None,
            false,
            limit,
            None,
            |_| {},
            |_, _, _| {},
        )
        .await
        .unwrap();

        assert_eq!(full_text, "Final answer");
        let requests = request_rx.recv().unwrap();
        assert_eq!(requests.len(), limit + 1);
        let last_body = requests.last().unwrap().split("\r\n\r\n").nth(1).unwrap();
        let last_json: serde_json::Value = serde_json::from_str(last_body).unwrap();
        let messages = last_json["messages"].as_array().unwrap();
        assert!(messages.iter().any(|message| {
            message["role"] == "system"
                && message["content"]
                    .as_str()
                    .is_some_and(|content| content.contains("工具调用次数已用尽"))
        }));
        assert!(last_json.get("tools").is_none());
        server.join().unwrap();
    }

    #[test]
    fn reading_chat_request_includes_tools() {
        use super::super::reading_tools::READING_AI_SYSTEM_PROMPT;
        use async_openai::types::chat::{
            ChatCompletionRequestSystemMessage, ChatCompletionRequestUserMessage,
        };

        let messages = vec![
            ChatCompletionRequestSystemMessage::from(READING_AI_SYSTEM_PROMPT).into(),
            ChatCompletionRequestUserMessage::from("hello").into(),
        ];
        let request =
            build_openai_chat_request(messages, "reader-model", true, 0.7, Some(reading_ai_tools()), false)
                .unwrap();
        let json = serde_json::to_value(request).unwrap();
        let tools = json["tools"].as_array().expect("tools array");
        assert_eq!(tools.len(), 4);
        let names: Vec<_> = tools
            .iter()
            .filter_map(|tool| tool["function"]["name"].as_str())
            .collect();
        assert!(names.contains(&"list_chapters"));
        assert!(names.contains(&"get_chapter_text"));
        assert!(names.contains(&"search_book"));
        assert!(names.contains(&"write_reading_memory"));
    }

    #[tokio::test]
    async fn async_openai_streams_chunks_from_compatible_provider() {
        let response_body = concat!(
            "data: {\"id\":\"chatcmpl-test\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"reader-model\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hel\"},\"finish_reason\":null}]}\n\n",
            "data: {\"id\":\"chatcmpl-test\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"reader-model\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"lo\"},\"finish_reason\":null}]}\n\n",
            "data: [DONE]\n\n"
        );
        let (base_url, request_rx, server) = spawn_chat_completion_server(response_body);
        let config = AIProviderConfig {
            id: "local".to_string(),
            name: "Local".to_string(),
            base_url: format!("{}/v1", base_url),
            model: "reader-model".to_string(),
        };
        let mut chunks = Vec::new();

        let full_text = chat_completion_stream_typed(
            sample_stream_messages(),
            &config,
            "secret-key",
            None,
            None,
            false,
            DEFAULT_MAX_TOOL_ROUNDS,
            None,
            |piece| chunks.push(piece),
            |_, _, _| {},
        )
        .await
        .unwrap();

        assert_eq!(full_text, "Hello");
        assert_eq!(chunks, vec!["Hel".to_string(), "lo".to_string()]);
        let request = request_rx.recv().unwrap();
        assert!(request.starts_with("POST /v1/chat/completions HTTP/1.1"));
        assert!(request.contains("authorization: Bearer secret-key"));
        let body = request.split("\r\n\r\n").nth(1).unwrap();
        let json: serde_json::Value = serde_json::from_str(body).unwrap();
        assert_eq!(json["model"], "reader-model");
        assert_eq!(json["stream"], true);
        assert!(json["messages"]
            .as_array()
            .unwrap()
            .iter()
            .any(|message| message["content"] == "prompt text"));
        server.join().unwrap();
    }

    #[tokio::test]
    async fn typed_stream_honors_cancellation_before_chunks() {
        let cancel = CancellationToken::new();
        cancel.cancel();
        let config = AIProviderConfig {
            id: "local".to_string(),
            name: "Local".to_string(),
            base_url: "http://127.0.0.1:9/v1".to_string(),
            model: "reader-model".to_string(),
        };
        let mut chunks = Vec::new();

        let full_text = chat_completion_stream_typed(
            sample_stream_messages(),
            &config,
            "secret-key",
            None,
            None,
            false,
            DEFAULT_MAX_TOOL_ROUNDS,
            Some(&cancel),
            |piece| chunks.push(piece),
            |_, _, _| {},
        )
        .await
        .unwrap();

        assert!(full_text.is_empty());
        assert!(chunks.is_empty());
    }

    fn spawn_oneshot_completion_server(
        response_body: &'static str,
    ) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = Vec::new();
            let mut temp = [0_u8; 1024];
            let mut header_end = None;
            let mut content_length = 0_usize;

            loop {
                let read = stream.read(&mut temp).unwrap();
                if read == 0 {
                    break;
                }
                buffer.extend_from_slice(&temp[..read]);
                if header_end.is_none() {
                    if let Some(pos) = buffer.windows(4).position(|w| w == b"\r\n\r\n") {
                        header_end = Some(pos + 4);
                        let headers = String::from_utf8_lossy(&buffer[..pos]);
                        content_length = headers
                            .lines()
                            .find_map(|line| {
                                let (name, value) = line.split_once(':')?;
                                name.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse::<usize>().ok())
                                    .flatten()
                            })
                            .unwrap_or(0);
                    }
                }
                if let Some(end) = header_end {
                    if buffer.len() >= end + content_length {
                        break;
                    }
                }
            }

            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                response_body.as_bytes().len(),
                response_body
            );
            stream.write_all(response.as_bytes()).unwrap();
        });
        (base_url, handle)
    }

    #[tokio::test]
    async fn typed_stream_fails_on_noncanonical_chunks_without_compat_fallback() {
        let response_body = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n",
            "data: [DONE]\n\n"
        );
        let (base_url, _request_rx, server) = spawn_chat_completion_server(response_body);
        let config = AIProviderConfig {
            id: "local".to_string(),
            name: "Local".to_string(),
            base_url: format!("{}/v1", base_url),
            model: "reader-model".to_string(),
        };

        let err = chat_completion_stream_typed(
            sample_stream_messages(),
            &config,
            "secret-key",
            None,
            None,
            false,
            DEFAULT_MAX_TOOL_ROUNDS,
            None,
            |_| {},
            |_, _, _| {},
        )
        .await
        .unwrap_err();

        assert!(err.contains("failed to deserialize"));
        assert!(!err.contains("compatibility fallback"));
        server.join().unwrap();
    }

    #[tokio::test]
    async fn typed_oneshot_fails_on_noncanonical_response_without_compat_fallback() {
        let response_body = r#"{"choices":[{"message":{"content":"ok"}}]}"#;
        let (base_url, server) = spawn_oneshot_completion_server(response_body);
        let config = AIProviderConfig {
            id: "local".to_string(),
            name: "Local".to_string(),
            base_url: format!("{}/v1", base_url),
            model: "reader-model".to_string(),
        };

        let err = chat_completion_oneshot_typed("prompt text", &config, "secret-key")
            .await
            .unwrap_err();

        assert!(err.contains("failed to deserialize"));
        assert!(!err.contains("compatibility fallback"));
        server.join().unwrap();
    }
}
