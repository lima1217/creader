mod ai;
mod book_files;
mod reading_memory;

// ============================================================
// App entry
// ============================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            ai::chat_with_ai_streaming,
            ai::summarize_ai_conversation,
            ai::list_ai_providers,
            ai::save_ai_provider,
            ai::delete_ai_provider,
            ai::set_active_ai_provider,
            ai::get_active_ai_provider,
            ai::set_ai_api_key,
            ai::has_ai_api_key,
            ai::test_ai_provider,
            ai::cancel_ai_streaming,
            ai::reset_ai_cancel,
            book_files::import_book_to_library,
            book_files::delete_book_file,
            book_files::validate_book_path,
            book_files::validate_book_paths,
            book_files::find_book_in_library,
            reading_memory::ensure_reading_memory_repository,
            reading_memory::review_reading_memory_direct,
            reading_memory::write_reading_memory_note,
            reading_memory::rewrite_reading_memory_page,
            reading_memory::ingest_reading_memory_direct
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
