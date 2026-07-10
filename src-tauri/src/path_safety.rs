use std::path::{Component, Path, PathBuf};

/// Canonicalize `path` and ensure it falls inside the canonical `root`.
/// Both paths must already exist on disk.
pub(crate) fn ensure_canonical_inside_root(path: &Path, root: &Path) -> Result<PathBuf, String> {
    let root_canon = std::fs::canonicalize(root)
        .map_err(|e| format!("Failed to resolve root directory: {}", e))?;
    let path_canon = std::fs::canonicalize(path)
        .map_err(|e| format!("Failed to resolve path: {}", e))?;
    if !path_canon.starts_with(&root_canon) {
        return Err("Path is outside allowed root".to_string());
    }
    Ok(path_canon)
}

/// Join relative path components under `root`, rejecting absolute paths and
/// any `..` / irregular components. Does not require the result to exist.
/// Callers that write should follow up with [`ensure_canonical_inside_root`]
/// on the created parent or file.
pub(crate) fn safe_join_under_root(root: &Path, relative: &Path) -> Result<PathBuf, String> {
    if relative.is_absolute() {
        return Err("Relative path must not be absolute".to_string());
    }

    let mut joined = root.to_path_buf();
    for component in relative.components() {
        match component {
            Component::Normal(part) => joined.push(part),
            Component::CurDir => {}
            _ => return Err("Relative path contains unsafe components".to_string()),
        }
    }
    Ok(joined)
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
            "creader_path_safety_{}_{}_{}",
            name,
            std::process::id(),
            nanos
        ))
    }

    #[test]
    fn ensure_canonical_inside_root_accepts_nested_path() {
        let root = unique_temp_dir("inside_ok");
        let nested = root.join("a").join("b");
        std::fs::create_dir_all(&nested).unwrap();
        let file = nested.join("note.md");
        std::fs::write(&file, b"x").unwrap();

        let resolved = ensure_canonical_inside_root(&file, &root).expect("inside root");
        assert!(resolved.starts_with(std::fs::canonicalize(&root).unwrap()));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn ensure_canonical_inside_root_rejects_outside_path() {
        let root = unique_temp_dir("inside_root");
        let outside = unique_temp_dir("inside_outside");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let file = outside.join("evil.md");
        std::fs::write(&file, b"x").unwrap();

        assert!(ensure_canonical_inside_root(&file, &root).is_err());

        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn safe_join_under_root_rejects_parent_and_absolute() {
        let root = Path::new("/tmp/memory");
        assert!(safe_join_under_root(root, Path::new("../outside.md")).is_err());
        assert!(safe_join_under_root(root, Path::new("/tmp/outside.md")).is_err());
        let ok = safe_join_under_root(root, Path::new("books/slug/concepts/note.md")).unwrap();
        assert_eq!(ok, PathBuf::from("/tmp/memory/books/slug/concepts/note.md"));
    }
}
