use std::path::Path;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use tauri::Manager;

#[derive(Debug, Clone, Serialize)]
pub struct FontFilePayload {
    pub bytes_base64: String,
    pub mime_type: String,
}

const BUNDLED_FONT_RESOURCES: &[&str] = &[
    "fonts/Roboto-Regular.woff2",
    "fonts/Roboto-Italic.woff2",
    "fonts/LXGWWenKaiGBScreen-Subset.woff2",
];

pub(crate) fn mime_type_for_font_extension(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        _ => return None,
    })
}

fn read_font_bytes(path: &Path) -> Result<Vec<u8>, String> {
    if path.metadata().map_err(|e| format!("Failed to stat font file: {}", e))?.len() > 32 * 1024 * 1024
    {
        return Err("Font file is too large (max 32 MiB)".to_string());
    }

    std::fs::read(path).map_err(|e| format!("Failed to read font file: {}", e))
}

fn encode_font_payload(path: &Path, bytes: Vec<u8>) -> Result<FontFilePayload, String> {
    let mime_type = mime_type_for_font_extension(path)
        .ok_or_else(|| "Unsupported font file type".to_string())?
        .to_string();

    Ok(FontFilePayload {
        bytes_base64: STANDARD.encode(bytes),
        mime_type,
    })
}

#[tauri::command]
pub(crate) fn read_bundled_font_base64(
    app: tauri::AppHandle,
    resource_name: String,
) -> Result<FontFilePayload, String> {
    if !BUNDLED_FONT_RESOURCES.contains(&resource_name.as_str()) {
        return Err("Unknown bundled font resource".to_string());
    }

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource directory: {}", e))?;

    let font_path = resource_dir.join(&resource_name);
    if !font_path.exists() || !font_path.is_file() {
        return Err(format!("Bundled font resource not found: {}", resource_name));
    }

    let canonical = std::fs::canonicalize(&font_path)
        .map_err(|e| format!("Failed to resolve bundled font path: {}", e))?;
    let bytes = read_font_bytes(&canonical)?;
    encode_font_payload(&canonical, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mime_type_for_known_extensions() {
        assert_eq!(
            mime_type_for_font_extension(Path::new("x.woff2")),
            Some("font/woff2")
        );
        assert_eq!(mime_type_for_font_extension(Path::new("x.pdf")), None);
    }

    #[test]
    fn bundled_font_allowlist_rejects_unknown_names() {
        assert!(!BUNDLED_FONT_RESOURCES.contains(&"fonts/Evil.woff2"));
        assert!(BUNDLED_FONT_RESOURCES.contains(&"fonts/Roboto-Regular.woff2"));
        assert!(BUNDLED_FONT_RESOURCES.contains(&"fonts/LXGWWenKaiGBScreen-Subset.woff2"));
    }
}
