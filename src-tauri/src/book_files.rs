use crate::search_index;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Manager;

// ============================================================
// Library / book file commands
// ============================================================

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

pub(crate) fn is_supported_book_extension(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
        return false;
    };
    matches!(ext.to_ascii_lowercase().as_str(), "epub")
}

pub(crate) fn is_under_any_root(candidate: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|root| candidate.starts_with(root))
}

pub(crate) fn validate_book_path_inner(app: &tauri::AppHandle, file_path: &str) -> bool {
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

#[tauri::command]
pub(crate) fn import_book_to_library(
    app: tauri::AppHandle,
    source_path: String,
    book_id: String,
) -> Result<ImportBookResult, String> {
    let source = Path::new(&source_path);

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

    let file_name = source
        .file_name()
        .ok_or("Invalid source file name")?
        .to_str()
        .ok_or("Invalid file name encoding")?;

    let extension = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("epub");
    let new_file_name = format!("{}_{}.{}", book_id, sanitize_filename(file_name), extension);

    let books_dir = ensure_books_dir(&app)?;
    let dest_path = books_dir.join(&new_file_name);

    std::fs::copy(source, &dest_path).map_err(|e| format!("Failed to copy file: {}", e))?;

    let new_path = dest_path
        .to_str()
        .ok_or("Invalid destination path encoding")?
        .to_string();

    Ok(ImportBookResult { new_path, book_id })
}

#[tauri::command]
pub(crate) fn validate_book_path(app: tauri::AppHandle, file_path: String) -> bool {
    validate_book_path_inner(&app, &file_path)
}

#[tauri::command]
pub(crate) fn validate_book_paths(app: tauri::AppHandle, file_paths: Vec<String>) -> Vec<bool> {
    file_paths
        .iter()
        .map(|p| validate_book_path_inner(&app, p))
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FindBookResult {
    pub found: bool,
    pub path: Option<String>,
}

fn validated_book_file_path(app: &tauri::AppHandle, file_path: &str) -> Result<PathBuf, String> {
    if !validate_book_path_inner(app, file_path) {
        return Err("Refusing to read book file outside allowed directories".to_string());
    }
    std::fs::canonicalize(Path::new(file_path))
        .map_err(|e| format!("Failed to resolve book file path: {}", e))
}

#[tauri::command]
pub(crate) fn extract_epub_search_preview(
    app: tauri::AppHandle,
    file_path: String,
) -> Result<search_index::EpubExtraction, String> {
    let file_path = validated_book_file_path(&app, &file_path)?;
    search_index::extract_epub_for_search(&file_path)
}

#[tauri::command]
pub(crate) fn get_search_index_status(
    app: tauri::AppHandle,
    book_id: String,
    file_path: String,
) -> Result<search_index::SearchIndexStatus, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    let file_path = validated_book_file_path(&app, &file_path)?;
    Ok(search_index::get_index_status(
        &app_data_dir,
        &book_id,
        &file_path,
    ))
}

#[tauri::command]
pub(crate) fn rebuild_search_index(
    app: tauri::AppHandle,
    book_id: String,
    file_path: String,
) -> Result<search_index::SearchIndexStatus, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    let file_path = validated_book_file_path(&app, &file_path)?;
    search_index::rebuild_index(&app_data_dir, &book_id, &file_path)
}

#[tauri::command]
pub(crate) fn search_book(
    app: tauri::AppHandle,
    book_id: String,
    file_path: String,
    query: String,
) -> Result<Vec<search_index::SearchResult>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    let file_path = validated_book_file_path(&app, &file_path)?;
    search_index::search_index(&app_data_dir, &book_id, &file_path, &query)
}

#[tauri::command]
pub(crate) fn find_book_in_library(
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

    if let Ok(entries) = std::fs::read_dir(&books_dir) {
        for entry in entries.flatten() {
            let file_name = entry.file_name().to_string_lossy().to_string();
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

    if let Some(orig_name) = original_filename {
        let orig_base = orig_name
            .rsplit_once('.')
            .map(|(n, _)| n)
            .unwrap_or(&orig_name);
        let sanitized = sanitize_filename(orig_base);

        if let Ok(entries) = std::fs::read_dir(&books_dir) {
            for entry in entries.flatten() {
                let file_name = entry.file_name().to_string_lossy().to_string();
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

#[tauri::command]
pub(crate) fn delete_book_file(app: tauri::AppHandle, file_path: String) -> Result<(), String> {
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

fn sanitize_filename(name: &str) -> String {
    let name = name.rsplit_once('.').map(|(n, _)| n).unwrap_or(name);

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
}
