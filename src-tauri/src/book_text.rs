use lru::LruCache;
use quick_xml::events::Event;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, Read};
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use zip::read::ZipArchive;

const DEFAULT_CHAPTER_CACHE_CAPACITY: usize = 32;
/// Sparse char→byte index stride. `byte_offsets[i]` is the UTF-8 byte offset of
/// char `i * CHAR_BYTE_INDEX_STRIDE`, letting deep pagination locate a window
/// in O(CHAR_BYTE_INDEX_STRIDE + limit) instead of O(offset + limit).
const CHAR_BYTE_INDEX_STRIDE: usize = 256;
/// Per-chapter hard ceiling on cached text. A single chapter above this is
/// left un-cached to bound memory on pathological EPUBs (e.g. a manual that
/// ships one giant section). Normal EPUB chapters are well under 200k chars,
/// so this guard only bites the long tail, while still letting deep pagination
/// reuse the cache for chapters up to ~2M chars. Combined with the
/// entry-count LRU (`DEFAULT_CHAPTER_CACHE_CAPACITY`) this bounds worst-case
/// cache memory at roughly capacity × ceiling ≈ 32 × 2M chars ≈ 64-96 MB.
const MAX_CACHEABLE_CHAPTER_CHARS: usize = 2_000_000;
const DEFAULT_SLICE_LIMIT: usize = 16_000;
pub const MAX_SEARCH_CHAPTERS: usize = 200;
pub const MAX_SEARCH_HITS: usize = 20;
pub const SEARCH_TOOL_TIMEOUT_SECS: u64 = 15;
const SEARCH_EXCERPT_CONTEXT_CHARS: usize = 120;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChapterInfo {
    pub index: usize,
    pub title: String,
    /// Uncompressed size of the chapter's XHTML entry in bytes. This is a
    /// cheap proxy for chapter length (read from the ZIP central directory
    /// without decompressing); UTF-8 text is roughly 1-3 bytes per char, so
    /// models should treat it as an approximate magnitude, not a char count.
    pub byte_len: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChapterTextSlice {
    pub text: String,
    pub index: usize,
    pub offset: usize,
    pub next_offset: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BookSearchHit {
    pub index: usize,
    pub title: String,
    pub excerpt: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BookSearchResult {
    pub hits: Vec<BookSearchHit>,
    pub truncated: bool,
}

#[derive(Debug, Clone)]
struct SpineItem {
    href: String,
    media_type: String,
}

#[derive(Debug, Clone)]
struct EpubPackage {
    opf_base: String,
    spine: Vec<String>,
    manifest: HashMap<String, SpineItem>,
    nav_href: Option<String>,
    ncx_href: Option<String>,
}

/// Sparse char→byte lookup table built once when a chapter enters the cache.
#[derive(Clone, Debug)]
struct ChapterCharIndex {
    char_count: usize,
    /// Byte offset of char 0, char `CHAR_BYTE_INDEX_STRIDE`, char 2×stride, …
    byte_offsets: Vec<usize>,
}

/// A cached chapter entry plus the file metadata it was built from. The
/// metadata lets a later `get` detect that the book file was replaced or
/// re-imported at the same path and treat the cached text as stale.
#[derive(Clone)]
struct CachedChapter {
    modified: std::time::SystemTime,
    len: u64,
    text: String,
    char_index: ChapterCharIndex,
}

pub struct BookTextCache {
    inner: Mutex<LruCache<(String, usize), CachedChapter>>,
}

impl BookTextCache {
    pub fn new(capacity: usize) -> Self {
        let cap = NonZeroUsize::new(capacity.max(1)).expect("cache capacity must be non-zero");
        Self {
            inner: Mutex::new(LruCache::new(cap)),
        }
    }

    pub fn with_default_capacity() -> Self {
        Self::new(DEFAULT_CHAPTER_CACHE_CAPACITY)
    }

    /// Returns the cached chapter only if it exists for `(book_key, index)` AND
    /// the book file's current mtime/size still match the cached metadata.
    /// A replaced or re-imported file at the same path invalidates the entry.
    fn get(&self, book_key: &str, index: usize, book_path: &Path) -> Option<CachedChapter> {
        let cached = self
            .inner
            .lock()
            .ok()
            .and_then(|mut cache| cache.get(&(book_key.to_string(), index)).cloned())?;
        match std::fs::metadata(book_path) {
            Ok(meta) => {
                let modified = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
                if modified == cached.modified && meta.len() == cached.len {
                    Some(cached)
                } else {
                    // Stale: file changed since cache. Drop the entry so the
                    // next put stores fresh metadata alongside the new text.
                    if let Ok(mut cache) = self.inner.lock() {
                        cache.pop(&(book_key.to_string(), index));
                    }
                    None
                }
            }
            Err(_) => None,
        }
    }

    fn put(&self, book_key: &str, index: usize, text: String, char_index: ChapterCharIndex, book_path: &Path) {
        if char_index.char_count > MAX_CACHEABLE_CHAPTER_CHARS {
            return;
        }
        // Snapshot the current file metadata so a future get can invalidate.
        let (modified, len) = match std::fs::metadata(book_path) {
            Ok(meta) => (meta.modified().unwrap_or(std::time::UNIX_EPOCH), meta.len()),
            Err(_) => return,
        };
        if let Ok(mut cache) = self.inner.lock() {
            cache.put(
                (book_key.to_string(), index),
                CachedChapter {
                    modified,
                    len,
                    text,
                    char_index,
                },
            );
        }
    }
}

impl Default for BookTextCache {
    fn default() -> Self {
        Self::with_default_capacity()
    }
}

/// Process-wide chapter text LRU cache, registered as Tauri managed state so
/// consecutive chat requests reuse decompressed chapter text.
pub struct AppBookTextCache(pub Arc<BookTextCache>);

impl AppBookTextCache {
    pub fn new() -> Self {
        Self(Arc::new(BookTextCache::with_default_capacity()))
    }
}

impl Default for AppBookTextCache {
    fn default() -> Self {
        Self::new()
    }
}

#[allow(dead_code)]
pub fn list_chapters(book_path: &Path) -> Result<Vec<ChapterInfo>, String> {
    let book_path = book_path.to_path_buf();
    blocking_list_chapters(&book_path)
}

#[allow(dead_code)]
pub fn get_chapter_text(
    book_path: &Path,
    index: usize,
    offset: Option<usize>,
    limit: Option<usize>,
    cache: &BookTextCache,
) -> Result<ChapterTextSlice, String> {
    let book_path = book_path.to_path_buf();
    blocking_get_chapter_text(&book_path, index, offset, limit, cache)
}

pub async fn list_chapters_async(book_path: PathBuf) -> Result<Vec<ChapterInfo>, String> {
    #[cfg(test)]
    let (chapter_counters, archive_counters) = test_instrumentation::counter_arcs();
    tokio::task::spawn_blocking(move || {
        #[cfg(test)]
        test_instrumentation::install_on_current_thread(chapter_counters, archive_counters);
        blocking_list_chapters(&book_path)
    })
    .await
    .map_err(|e| format!("list_chapters task failed: {}", e))?
}

pub async fn get_chapter_text_async(
    book_path: PathBuf,
    index: usize,
    offset: Option<usize>,
    limit: Option<usize>,
    cache: Arc<BookTextCache>,
) -> Result<ChapterTextSlice, String> {
    #[cfg(test)]
    let (chapter_counters, archive_counters) = test_instrumentation::counter_arcs();
    tokio::task::spawn_blocking(move || {
        #[cfg(test)]
        test_instrumentation::install_on_current_thread(chapter_counters, archive_counters);
        blocking_get_chapter_text(&book_path, index, offset, limit, cache.as_ref())
    })
    .await
    .map_err(|e| format!("get_chapter_text task failed: {}", e))?
}

#[allow(dead_code)]
pub fn search_book(
    book_path: &Path,
    query: &str,
    limit: Option<usize>,
    cache: &BookTextCache,
) -> Result<BookSearchResult, String> {
    let book_path = book_path.to_path_buf();
    blocking_search_book(&book_path, query, limit, cache)
}

pub async fn search_book_async(
    book_path: PathBuf,
    query: String,
    limit: Option<usize>,
    cache: Arc<BookTextCache>,
) -> Result<BookSearchResult, String> {
    #[cfg(test)]
    let (chapter_counters, archive_counters) = test_instrumentation::counter_arcs();
    tokio::task::spawn_blocking(move || {
        #[cfg(test)]
        test_instrumentation::install_on_current_thread(chapter_counters, archive_counters);
        blocking_search_book(&book_path, &query, limit, cache.as_ref())
    })
    .await
    .map_err(|e| format!("search_book task failed: {}", e))?
}

fn blocking_list_chapters(book_path: &Path) -> Result<Vec<ChapterInfo>, String> {
    let mut archive = open_epub_archive(book_path)?;
    let package = load_epub_package(&mut archive)?;
    build_chapter_list(&mut archive, &package)
}

fn build_chapter_list(
    archive: &mut ZipArchive<File>,
    package: &EpubPackage,
) -> Result<Vec<ChapterInfo>, String> {
    let titles = resolve_chapter_titles(archive, package)?;

    let mut chapters = Vec::with_capacity(package.spine.len());
    for (index, idref) in package.spine.iter().enumerate() {
        let item = package
            .manifest
            .get(idref)
            .ok_or_else(|| format!("Spine itemref '{}' missing from manifest", idref))?;
        let entry_path = join_epub_path(&package.opf_base, &item.href);
        let byte_len = archive
            .by_name(&entry_path)
            .map(|entry| entry.size() as usize)
            .unwrap_or(0);

        let title = titles
            .get(index)
            .cloned()
            .unwrap_or_else(|| fallback_chapter_title(index));

        chapters.push(ChapterInfo {
            index,
            title,
            byte_len,
        });
    }

    Ok(chapters)
}

fn blocking_get_chapter_text(
    book_path: &Path,
    index: usize,
    offset: Option<usize>,
    limit: Option<usize>,
    cache: &BookTextCache,
) -> Result<ChapterTextSlice, String> {
    let offset = offset.unwrap_or(0);
    let limit = limit.unwrap_or(DEFAULT_SLICE_LIMIT);
    if limit == 0 {
        return Err("limit must be greater than zero".to_string());
    }

    let book_key = canonical_book_key(book_path)?;

    // Cache-then-slice: on a miss, extract the full normalized chapter once
    // and cache it (with a char→byte index), then slice the requested window.
    // This keeps deep pagination from re-opening the ZIP and re-parsing the
    // XHTML on every page. With the cached index, slicing is
    // O(CHAR_BYTE_INDEX_STRIDE + limit) rather than O(offset + limit). The
    // cache is shared with `search_book`.
    let (full_text, char_index) = match cache.get(&book_key, index, book_path) {
        Some(entry) => (entry.text, Some(entry.char_index)),
        None => {
            let mut archive = open_epub_archive(book_path)?;
            let package = load_epub_package(&mut archive)?;
            let entry = load_chapter_from_open_archive(
                &mut archive,
                &package,
                &book_key,
                book_path,
                index,
                cache,
            )?;
            (entry.text, Some(entry.char_index))
        }
    };

    Ok(slice_chapter_text(
        &full_text,
        char_index.as_ref(),
        index,
        offset,
        limit,
    ))
}

fn blocking_search_book(
    book_path: &Path,
    query: &str,
    limit: Option<usize>,
    cache: &BookTextCache,
) -> Result<BookSearchResult, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("query must not be empty".to_string());
    }

    let max_hits = limit
        .unwrap_or(MAX_SEARCH_HITS)
        .clamp(1, MAX_SEARCH_HITS);
    let deadline = Instant::now() + Duration::from_secs(SEARCH_TOOL_TIMEOUT_SECS);

    let book_key = canonical_book_key(book_path)?;
    let mut archive = open_epub_archive(book_path)?;
    let package = load_epub_package(&mut archive)?;
    let chapters = build_chapter_list(&mut archive, &package)?;
    let mut truncated = chapters.len() > MAX_SEARCH_CHAPTERS;
    let mut hits = Vec::new();

    for chapter in chapters.iter().take(MAX_SEARCH_CHAPTERS) {
        if Instant::now() >= deadline {
            truncated = true;
            break;
        }

        let entry = load_chapter_from_open_archive(
            &mut archive,
            &package,
            &book_key,
            book_path,
            chapter.index,
            cache,
        )?;

        if let Some((char_start, match_len)) =
            find_case_insensitive_char_range(&entry.text, query)
        {
            hits.push(BookSearchHit {
                index: chapter.index,
                title: chapter.title.clone(),
                excerpt: build_search_excerpt_from_match(&entry.text, char_start, match_len),
            });
            if hits.len() >= max_hits {
                truncated = true;
                break;
            }
        }
    }

    Ok(BookSearchResult { hits, truncated })
}

/// Reads a chapter from an already-open archive, checking the shared cache
/// first and filling it on miss. Unlike the per-chapter `open_epub_archive` +
/// `load_epub_package` path, callers that scan many chapters reuse a single
/// archive and parsed package.
fn load_chapter_from_open_archive(
    archive: &mut ZipArchive<File>,
    package: &EpubPackage,
    book_key: &str,
    book_path: &Path,
    index: usize,
    cache: &BookTextCache,
) -> Result<CachedChapter, String> {
    if let Some(entry) = cache.get(book_key, index, book_path) {
        return Ok(entry);
    }

    let idref = package
        .spine
        .get(index)
        .ok_or_else(|| format!("Chapter index {} out of range", index))?;
    let item = package
        .manifest
        .get(idref)
        .ok_or_else(|| format!("Spine itemref '{}' missing from manifest", idref))?;
    let entry_path = join_epub_path(&package.opf_base, &item.href);

    if !is_xhtml_like(&item.media_type, &item.href) {
        return Err(format!("Spine item '{}' is not XHTML content", idref));
    }

    let mut entry = archive
        .by_name(&entry_path)
        .map_err(|e| format!("Failed to read chapter entry '{}': {}", entry_path, e))?;

    let mut buffered = std::io::BufReader::new(&mut entry);
    let extracted = extract_xhtml_text(&mut buffered)?;
    let char_index = build_char_byte_index(&extracted);

    cache.put(book_key, index, extracted.clone(), char_index.clone(), book_path);

    if let Some(entry) = cache.get(book_key, index, book_path) {
        return Ok(entry);
    }

    // Chapter exceeds the cache char ceiling; still return text + index for slicing.
    let (modified, len) = match std::fs::metadata(book_path) {
        Ok(meta) => (meta.modified().unwrap_or(std::time::UNIX_EPOCH), meta.len()),
        Err(e) => return Err(format!("Failed to read book metadata: {}", e)),
    };
    Ok(CachedChapter {
        modified,
        len,
        text: extracted,
        char_index,
    })
}

fn build_char_byte_index(text: &str) -> ChapterCharIndex {
    let mut byte_offsets = vec![0];
    let mut char_count = 0usize;
    for (byte_idx, _) in text.char_indices() {
        if char_count > 0 && char_count % CHAR_BYTE_INDEX_STRIDE == 0 {
            byte_offsets.push(byte_idx);
        }
        char_count += 1;
    }
    ChapterCharIndex {
        char_count,
        byte_offsets,
    }
}

fn char_offset_to_byte(text: &str, index: &ChapterCharIndex, char_offset: usize) -> usize {
    if char_offset == 0 {
        return 0;
    }
    if char_offset >= index.char_count {
        return text.len();
    }
    let slot = char_offset / CHAR_BYTE_INDEX_STRIDE;
    let base_char = slot * CHAR_BYTE_INDEX_STRIDE;
    let base_byte = index
        .byte_offsets
        .get(slot)
        .copied()
        .unwrap_or(0);
    let skip = char_offset - base_char;
    text[base_byte..]
        .char_indices()
        .nth(skip)
        .map(|(byte_idx, _)| base_byte + byte_idx)
        .unwrap_or(text.len())
}

/// Pre-folded query scalar for streaming case-insensitive matching.
type FoldedQueryChar = Vec<char>;

fn fold_query_char(ch: char) -> FoldedQueryChar {
    ch.to_lowercase().collect()
}

fn folded_char_matches(hay: char, needle_folded: &[char]) -> bool {
    let mut hay_fold = hay.to_lowercase();
    let mut needle = needle_folded.iter().copied();
    loop {
        match (hay_fold.next(), needle.next()) {
            (Some(a), Some(b)) if a == b => {}
            (None, None) => return true,
            _ => return false,
        }
    }
}

fn matches_case_insensitive_at(text: &str, byte_start: usize, needle: &[FoldedQueryChar]) -> bool {
    let mut hay = text[byte_start..].chars();
    for folded in needle {
        let Some(ch) = hay.next() else {
            return false;
        };
        if !folded_char_matches(ch, folded) {
            return false;
        }
    }
    true
}

fn find_case_insensitive_char_range(text: &str, query: &str) -> Option<(usize, usize)> {
    let needle: Vec<FoldedQueryChar> = query.chars().map(fold_query_char).collect();
    if needle.is_empty() {
        return Some((0, 0));
    }
    let match_len = needle.len();

    let mut char_start = 0usize;
    for (byte_start, _) in text.char_indices() {
        if matches_case_insensitive_at(text, byte_start, &needle) {
            return Some((char_start, match_len));
        }
        char_start += 1;
    }
    None
}

fn build_search_excerpt_from_match(text: &str, char_start: usize, match_char_len: usize) -> String {
    let excerpt_start = char_start.saturating_sub(SEARCH_EXCERPT_CONTEXT_CHARS);
    let total_chars = text.chars().count();
    let excerpt_end = (char_start + match_char_len + SEARCH_EXCERPT_CONTEXT_CHARS).min(total_chars);

    let excerpt: String = text
        .chars()
        .skip(excerpt_start)
        .take(excerpt_end.saturating_sub(excerpt_start))
        .collect();

    let mut result = String::new();
    if excerpt_start > 0 {
        result.push('…');
    }
    result.push_str(&excerpt);
    if excerpt_end < total_chars {
        result.push('…');
    }
    result
}

fn slice_chapter_text(
    full_text: &str,
    char_index: Option<&ChapterCharIndex>,
    index: usize,
    offset: usize,
    limit: usize,
) -> ChapterTextSlice {
    let total_chars = char_index
        .map(|idx| idx.char_count)
        .unwrap_or_else(|| full_text.chars().count());
    if offset >= total_chars {
        return ChapterTextSlice {
            text: String::new(),
            index,
            offset,
            next_offset: None,
        };
    }

    let end_char = (offset + limit).min(total_chars);
    let text = if let Some(idx) = char_index {
        let start_byte = char_offset_to_byte(full_text, idx, offset);
        let end_byte = char_offset_to_byte(full_text, idx, end_char);
        full_text[start_byte..end_byte].to_string()
    } else {
        full_text.chars().skip(offset).take(limit).collect()
    };

    let consumed = offset + text.chars().count();
    let next_offset = if consumed < total_chars {
        Some(consumed)
    } else {
        None
    };

    ChapterTextSlice {
        text,
        index,
        offset,
        next_offset,
    }
}

fn open_epub_archive(book_path: &Path) -> Result<ZipArchive<File>, String> {
    test_record_archive_open();
    if !book_path.exists() {
        return Err(format!("Book file does not exist: {}", book_path.display()));
    }
    let file = File::open(book_path).map_err(|e| format!("Failed to open EPUB: {}", e))?;
    ZipArchive::new(file).map_err(|e| format!("Failed to read EPUB archive: {}", e))
}

fn canonical_book_key(book_path: &Path) -> Result<String, String> {
    // Paths from `validated_book_path` are already canonicalized; skip a second
    // filesystem round-trip when the caller handed us an absolute path.
    if book_path.is_absolute() {
        return Ok(book_path.to_string_lossy().into_owned());
    }
    std::fs::canonicalize(book_path)
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| format!("Failed to resolve book path: {}", e))
}

fn load_epub_package(archive: &mut ZipArchive<File>) -> Result<EpubPackage, String> {
    let container_xml = read_zip_text(archive, "META-INF/container.xml")?;
    let opf_path = parse_container_opf_path(&container_xml)?;
    let opf_xml = read_zip_text(archive, &opf_path)?;
    parse_opf_package(&opf_path, &opf_xml)
}

/// Upper bound for a single metadata entry read into memory
/// (container.xml / OPF / nav / NCX). Real EPUB metadata is in the tens-of-KB
/// range; this caps pathological entries so a malformed archive cannot force a
/// multi-GB allocation through the metadata path.
#[cfg(not(test))]
const MAX_METADATA_ENTRY_BYTES: u64 = 8 * 1024 * 1024;
#[cfg(test)]
const MAX_METADATA_ENTRY_BYTES: u64 = 4 * 1024;

fn read_zip_text(archive: &mut ZipArchive<File>, name: &str) -> Result<String, String> {
    let mut entry = archive
        .by_name(name)
        .map_err(|e| format!("EPUB entry not found '{}': {}", name, e))?;
    if entry.size() > MAX_METADATA_ENTRY_BYTES {
        return Err(format!(
            "EPUB entry '{}' is unreasonably large ({} bytes); refusing to read into memory",
            name,
            entry.size()
        ));
    }
    let mut raw = String::new();
    entry
        .read_to_string(&mut raw)
        .map_err(|e| format!("Failed to read EPUB entry '{}': {}", name, e))?;
    Ok(raw)
}

fn parse_container_opf_path(xml: &str) -> Result<String, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Empty(e)) | Ok(Event::Start(e)) => {
                if local_name_eq(e.name().as_ref(), b"rootfile") {
                    if let Some(path) = attr_value(&e, b"full-path") {
                        return Ok(path);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(e) => return Err(format!("Failed to parse container.xml: {}", e)),
        }
        buf.clear();
    }

    Err("EPUB container did not declare an OPF package path".to_string())
}

fn parse_opf_package(opf_path: &str, xml: &str) -> Result<EpubPackage, String> {
    let opf_base = opf_path
        .rsplit_once('/')
        .map(|(base, _)| base.to_string())
        .unwrap_or_default();

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();

    let mut manifest: HashMap<String, SpineItem> = HashMap::new();
    let mut spine: Vec<String> = Vec::new();
    let mut nav_href: Option<String> = None;
    let mut ncx_href: Option<String> = None;
    let mut in_manifest = false;
    let mut in_spine = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = e.name().as_ref().to_ascii_lowercase();
                if name == b"manifest" {
                    in_manifest = true;
                } else if name == b"spine" {
                    in_spine = true;
                } else if in_manifest && name == b"item" {
                    let id = attr_value(&e, b"id").unwrap_or_default();
                    let href = attr_value(&e, b"href").unwrap_or_default();
                    let media_type = attr_value(&e, b"media-type").unwrap_or_default();
                    let properties = attr_value(&e, b"properties").unwrap_or_default();

                    if properties.split_whitespace().any(|p| p == "nav") {
                        nav_href = Some(join_epub_path(&opf_base, &href));
                    }
                    if media_type == "application/x-dtbncx+xml" || href.ends_with(".ncx") {
                        ncx_href = Some(join_epub_path(&opf_base, &href));
                    }

                    if !id.is_empty() && !href.is_empty() {
                        manifest.insert(
                            id,
                            SpineItem {
                                href,
                                media_type,
                            },
                        );
                    }
                } else if in_spine && name == b"itemref" {
                    if let Some(idref) = attr_value(&e, b"idref") {
                        spine.push(idref);
                    }
                }
            }
            Ok(Event::Empty(e)) => {
                let name = e.name().as_ref().to_ascii_lowercase();
                if in_manifest && name == b"item" {
                    let id = attr_value(&e, b"id").unwrap_or_default();
                    let href = attr_value(&e, b"href").unwrap_or_default();
                    let media_type = attr_value(&e, b"media-type").unwrap_or_default();
                    let properties = attr_value(&e, b"properties").unwrap_or_default();

                    if properties.split_whitespace().any(|p| p == "nav") {
                        nav_href = Some(join_epub_path(&opf_base, &href));
                    }
                    if media_type == "application/x-dtbncx+xml" || href.ends_with(".ncx") {
                        ncx_href = Some(join_epub_path(&opf_base, &href));
                    }

                    if !id.is_empty() && !href.is_empty() {
                        manifest.insert(
                            id,
                            SpineItem {
                                href,
                                media_type,
                            },
                        );
                    }
                } else if in_spine && name == b"itemref" {
                    if let Some(idref) = attr_value(&e, b"idref") {
                        spine.push(idref);
                    }
                }
            }
            Ok(Event::End(e)) => {
                let name = e.name().as_ref().to_ascii_lowercase();
                if name == b"manifest" {
                    in_manifest = false;
                } else if name == b"spine" {
                    in_spine = false;
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(e) => return Err(format!("Failed to parse OPF: {}", e)),
        }
        buf.clear();
    }

    if spine.is_empty() {
        return Err("EPUB OPF did not declare any spine items".to_string());
    }

    Ok(EpubPackage {
        opf_base,
        spine,
        manifest,
        nav_href,
        ncx_href,
    })
}

fn resolve_chapter_titles(
    archive: &mut ZipArchive<File>,
    package: &EpubPackage,
) -> Result<Vec<String>, String> {
    if let Some(nav_href) = &package.nav_href {
        if let Ok(nav_xml) = read_zip_text(archive, nav_href) {
            if let Ok(entries) = parse_epub3_nav_entries(&nav_xml) {
                if !entries.is_empty() {
                    return Ok(map_toc_entries_to_spine_titles(package, &entries));
                }
            }
        }
    }

    if let Some(ncx_href) = &package.ncx_href {
        if let Ok(ncx_xml) = read_zip_text(archive, ncx_href) {
            if let Ok(entries) = parse_ncx_entries(&ncx_xml) {
                if !entries.is_empty() {
                    return Ok(map_toc_entries_to_spine_titles(package, &entries));
                }
            }
        }
    }

    Ok((0..package.spine.len())
        .map(fallback_chapter_title)
        .collect())
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TocEntry {
    href: String,
    title: String,
}

fn map_toc_entries_to_spine_titles(
    package: &EpubPackage,
    entries: &[TocEntry],
) -> Vec<String> {
    let mut titles: Vec<String> = (0..package.spine.len())
        .map(fallback_chapter_title)
        .collect();
    let mut assigned = vec![false; package.spine.len()];

    for entry in entries {
        let href_path = entry
            .href
            .split(['#', '?'])
            .next()
            .unwrap_or(entry.href.as_str());
        if href_path.is_empty() {
            continue;
        }

        let resolved_href = join_epub_path(&package.opf_base, href_path);
        let Some(manifest_id) = manifest_id_for_resolved_href(package, &resolved_href) else {
            continue;
        };
        let Some(spine_index) = package.spine.iter().position(|idref| idref == &manifest_id)
        else {
            continue;
        };
        if !assigned[spine_index] {
            titles[spine_index] = entry.title.clone();
            assigned[spine_index] = true;
        }
    }

    titles
}

fn manifest_id_for_resolved_href(package: &EpubPackage, resolved_href: &str) -> Option<String> {
    package
        .manifest
        .iter()
        .find(|(_, item)| join_epub_path(&package.opf_base, &item.href) == resolved_href)
        .map(|(id, _)| id.clone())
}

fn parse_epub3_nav_entries(xml: &str) -> Result<Vec<TocEntry>, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();

    let mut entries = Vec::new();
    let mut in_toc_nav = false;
    let mut nav_depth: u32 = 0;
    let mut in_anchor = false;
    let mut current_href = String::new();
    let mut current = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = e.name().as_ref().to_ascii_lowercase();
                if name == b"nav" {
                    let epub_type = attr_value(&e, b"type")
                        .or_else(|| attr_value(&e, b"epub:type"))
                        .unwrap_or_default();
                    if epub_type == "toc" {
                        in_toc_nav = true;
                        nav_depth = 1;
                    } else if in_toc_nav {
                        nav_depth += 1;
                    }
                } else if in_toc_nav && name == b"a" {
                    in_anchor = true;
                    current_href = attr_value(&e, b"href").unwrap_or_default();
                    current.clear();
                } else if in_toc_nav {
                    nav_depth += 1;
                }
            }
            Ok(Event::End(e)) => {
                let name = e.name().as_ref().to_ascii_lowercase();
                if name == b"a" && in_anchor {
                    let title = current.trim();
                    if !title.is_empty() && !current_href.is_empty() {
                        entries.push(TocEntry {
                            href: current_href.clone(),
                            title: title.to_string(),
                        });
                    }
                    in_anchor = false;
                    current_href.clear();
                    current.clear();
                } else if name == b"nav" && nav_depth == 1 && in_toc_nav {
                    break;
                } else if in_toc_nav {
                    nav_depth = nav_depth.saturating_sub(1);
                    if nav_depth == 0 {
                        in_toc_nav = false;
                    }
                }
            }
            Ok(Event::Text(e)) if in_anchor => {
                if let Ok(text) = e.unescape() {
                    current.push_str(text.as_ref());
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(e) => return Err(format!("Failed to parse nav document: {}", e)),
        }
        buf.clear();
    }

    Ok(entries)
}

fn parse_ncx_entries(xml: &str) -> Result<Vec<TocEntry>, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();

    let mut entries = Vec::new();
    let mut in_nav_label = false;
    let mut current_label = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                if local_name_eq(e.name().as_ref(), b"navLabel")
                    || local_name_eq(e.name().as_ref(), b"navlabel")
                {
                    in_nav_label = true;
                    current_label.clear();
                } else if local_name_eq(e.name().as_ref(), b"content") {
                    let href = attr_value(&e, b"src").unwrap_or_default();
                    let title = current_label.trim();
                    if !title.is_empty() && !href.is_empty() {
                        entries.push(TocEntry {
                            href,
                            title: title.to_string(),
                        });
                    }
                    current_label.clear();
                    in_nav_label = false;
                }
            }
            Ok(Event::End(e)) => {
                if local_name_eq(e.name().as_ref(), b"navLabel")
                    || local_name_eq(e.name().as_ref(), b"navlabel")
                {
                    in_nav_label = false;
                }
            }
            Ok(Event::Text(e)) if in_nav_label => {
                if let Ok(text) = e.unescape() {
                    current_label.push_str(text.as_ref());
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(e) => return Err(format!("Failed to parse NCX document: {}", e)),
        }
        buf.clear();
    }

    Ok(entries)
}

fn extract_xhtml_text(reader: &mut impl BufRead) -> Result<String, String> {
    test_record_chapter_extraction();

    let mut xml = Reader::from_reader(reader);

    // Incremental normalization buffer. Streaming the whitespace rules as we
    // consume Text events keeps chapter extraction linear in chapter size,
    // instead of re-normalizing the whole accumulated `raw` on every event.
    let mut output = String::new();
    let mut normalizer = NormalizationSink::new();
    let mut skip_depth = 0u32;
    let mut head_depth = 0u32;
    let mut buf = Vec::new();

    loop {
        match xml.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                handle_opening_tag(&e, &mut head_depth, &mut skip_depth, &mut normalizer, &mut output);
            }
            Ok(Event::End(e)) => {
                handle_closing_tag(&e, &mut head_depth, &mut skip_depth, &mut normalizer, &mut output);
            }
            Ok(Event::Text(e)) if head_depth == 0 && skip_depth == 0 => {
                let text = e
                    .unescape()
                    .map_err(|err| format!("Failed to decode XHTML text: {}", err))?;
                normalizer.append(text.as_ref(), &mut output);
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(e) => return Err(format!("Failed to parse XHTML: {}", e)),
        }
        buf.clear();
    }

    // `output` is already normalized inline; only a final trim remains.
    Ok(output.trim().to_string())
}

/// Shared opening-tag handling for both `Event::Start` and `Event::Empty`
/// (self-closing tags like `<br/>` arrive as `Empty`). Self-closing block tags
/// still contribute a newline so `<br/>`, `<hr/>`, and empty `<td/>` keep their
/// structural separation; `<img/>`, `<a/>` etc. are ignored.
fn handle_opening_tag(
    e: &quick_xml::events::BytesStart<'_>,
    head_depth: &mut u32,
    skip_depth: &mut u32,
    normalizer: &mut NormalizationSink,
    output: &mut String,
) {
    let name = e.name().as_ref().to_ascii_lowercase();
    if name == b"head" {
        *head_depth += 1;
    } else if *head_depth == 0 {
        if name == b"script" || name == b"style" {
            *skip_depth += 1;
        } else if *skip_depth == 0 && is_block_tag(&name) {
            normalizer.append("\n", output);
        } else if *skip_depth == 0 && is_cell_separator_tag(&name) {
            normalizer.append(" ", output);
        }
    }
}

fn handle_closing_tag(
    e: &quick_xml::events::BytesEnd<'_>,
    head_depth: &mut u32,
    skip_depth: &mut u32,
    normalizer: &mut NormalizationSink,
    output: &mut String,
) {
    let name = e.name().as_ref().to_ascii_lowercase();
    if name == b"head" {
        *head_depth = head_depth.saturating_sub(1);
    } else if *head_depth == 0 {
        if name == b"script" || name == b"style" {
            *skip_depth = skip_depth.saturating_sub(1);
        } else if *skip_depth == 0 && is_block_tag(&name) {
            normalizer.append("\n", output);
        }
    }
}

/// Incrementally normalizes extracted text. Folds runs of spaces/tabs into a
/// single space and collapses 3+ newlines to 2.
///
/// Leading whitespace is dropped during append (callers typically `.trim()`
/// once at the end).
struct NormalizationSink {
    leading: bool,
    prev_was_space: bool,
    consecutive_newlines: u32,
}

impl NormalizationSink {
    fn new() -> Self {
        Self {
            leading: true,
            prev_was_space: false,
            consecutive_newlines: 0,
        }
    }

    fn append(&mut self, chunk: &str, out: &mut String) {
        for ch in chunk.replace("\r\n", "\n").chars() {
            let is_space = ch == ' ' || ch == '\t';
            let is_newline = ch == '\n';
            if self.leading && (is_space || is_newline) {
                continue;
            }

            if is_space {
                if !self.prev_was_space {
                    out.push(' ');
                    self.prev_was_space = true;
                    self.leading = false;
                }
                continue;
            }

            self.prev_was_space = false;
            self.leading = false;

            if is_newline {
                self.consecutive_newlines += 1;
                if self.consecutive_newlines <= 2 {
                    out.push('\n');
                }
                continue;
            }

            self.consecutive_newlines = 0;
            out.push(ch);
        }
    }
}

fn is_block_tag(name: &[u8]) -> bool {
    matches!(
        name,
        b"p" | b"div" | b"section" | b"article" | b"blockquote" | b"li" | b"h1" | b"h2"
            | b"h3" | b"h4" | b"h5" | b"h6" | b"tr" | b"br" | b"hr"
    )
}

/// Table cells (`td`/`th`) on the same row would otherwise concatenate into
/// one token stream ("AB" with no separator). Treat them as inline separators:
/// emit a single space so column boundaries survive without forcing newlines.
fn is_cell_separator_tag(name: &[u8]) -> bool {
    matches!(name, b"td" | b"th")
}

fn is_xhtml_like(media_type: &str, href: &str) -> bool {
    media_type.contains("xhtml")
        || media_type.contains("html")
        || href.ends_with(".xhtml")
        || href.ends_with(".html")
        || href.ends_with(".htm")
}

fn fallback_chapter_title(index: usize) -> String {
    format!("Chapter {}", index + 1)
}

fn join_epub_path(base: &str, href: &str) -> String {
    let mut parts: Vec<&str> = if base.is_empty() {
        Vec::new()
    } else {
        base.split('/').collect()
    };

    for part in href.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            segment => parts.push(segment),
        }
    }

    parts.join("/")
}

fn local_name_eq(name: &[u8], expected: &[u8]) -> bool {
    name.rsplit(|byte| *byte == b':').next() == Some(expected)
}

fn attr_value(event: &quick_xml::events::BytesStart<'_>, key: &[u8]) -> Option<String> {
    event
        .attributes()
        .flatten()
        .find(|attr| attr.key.as_ref() == key)
        .and_then(|attr| String::from_utf8(attr.value.into_owned()).ok())
}

/// Per-test instrumentation counters. Each test thread owns its own pair of
/// `Arc<AtomicUsize>` via thread-local storage so parallel `cargo test` runs
/// do not cross-contaminate extraction / archive-open counts. Async paths
/// clone the Arcs into `spawn_blocking` worker threads before recording.
#[cfg(test)]
mod test_instrumentation {
    use std::cell::RefCell;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    thread_local! {
        static CHAPTER_EXTRACTIONS: RefCell<Arc<AtomicUsize>> =
            RefCell::new(Arc::new(AtomicUsize::new(0)));
        static ARCHIVE_OPENS: RefCell<Arc<AtomicUsize>> =
            RefCell::new(Arc::new(AtomicUsize::new(0)));
    }

    pub fn reset() {
        chapter_arc().store(0, Ordering::SeqCst);
        archive_arc().store(0, Ordering::SeqCst);
    }

    pub fn chapter_count() -> usize {
        chapter_arc().load(Ordering::SeqCst)
    }

    pub fn archive_count() -> usize {
        archive_arc().load(Ordering::SeqCst)
    }

    pub fn record_chapter_extraction() {
        chapter_arc().fetch_add(1, Ordering::SeqCst);
    }

    pub fn record_archive_open() {
        archive_arc().fetch_add(1, Ordering::SeqCst);
    }

    pub fn counter_arcs() -> (Arc<AtomicUsize>, Arc<AtomicUsize>) {
        (chapter_arc(), archive_arc())
    }

    pub fn install_on_current_thread(chapter: Arc<AtomicUsize>, archive: Arc<AtomicUsize>) {
        CHAPTER_EXTRACTIONS.with(|c| *c.borrow_mut() = chapter);
        ARCHIVE_OPENS.with(|c| *c.borrow_mut() = archive);
    }

    fn chapter_arc() -> Arc<AtomicUsize> {
        CHAPTER_EXTRACTIONS.with(|c| c.borrow().clone())
    }

    fn archive_arc() -> Arc<AtomicUsize> {
        ARCHIVE_OPENS.with(|c| c.borrow().clone())
    }
}

#[cfg(test)]
pub(crate) fn test_reset_counters() {
    test_instrumentation::reset();
}

#[cfg(test)]
pub(crate) fn test_chapter_extractions() -> usize {
    test_instrumentation::chapter_count()
}

#[cfg(test)]
pub(crate) fn test_archive_opens() -> usize {
    test_instrumentation::archive_count()
}

fn test_record_chapter_extraction() {
    #[cfg(test)]
    test_instrumentation::record_chapter_extraction();
}

fn test_record_archive_open() {
    #[cfg(test)]
    test_instrumentation::record_archive_open();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use std::sync::Arc;
    use std::time::Instant;
    use serial_test::serial;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn reset_test_counters() {
        test_instrumentation::reset();
    }

    fn chapter_extractions() -> usize {
        test_instrumentation::chapter_count()
    }

    fn archive_opens() -> usize {
        test_instrumentation::archive_count()
    }

    fn normalize_with_sink(text: &str) -> String {
        let mut sink = NormalizationSink::new();
        let mut out = String::new();
        sink.append(text, &mut out);
        out.trim().to_string()
    }

    fn write_test_epub(path: &Path, chapters: &[(&str, &str)], include_nav: bool) {
        let file = File::create(path).expect("create epub");
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default();

        zip.start_file("mimetype", options)
            .expect("mimetype");
        zip.write_all(b"application/epub+zip")
            .expect("write mimetype");
        zip.start_file("META-INF/container.xml", options)
            .expect("container");
        zip.write_all(
                br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#,
            )
            .expect("write container");

        let mut manifest = String::from(
            r#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata>
    <dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Test Book</dc:title>
  </metadata>
  <manifest>
"#,
        );

        if include_nav {
            manifest.push_str(
                r#"    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
"#,
            );
        }

        for (index, (_, _)) in chapters.iter().enumerate() {
            manifest.push_str(&format!(
                r#"    <item id="ch{idx}" href="chapter{idx}.xhtml" media-type="application/xhtml+xml"/>
"#,
                idx = index + 1
            ));
        }

        manifest.push_str("  </manifest>\n  <spine>\n");
        for index in 0..chapters.len() {
            manifest.push_str(&format!(
                r#"    <itemref idref="ch{idx}"/>
"#,
                idx = index + 1
            ));
        }
        manifest.push_str("  </spine>\n</package>\n");

        zip.start_file("OEBPS/content.opf", options)
            .expect("opf");
        zip.write_all(manifest.as_bytes())
            .expect("write opf");

        if include_nav {
            let mut nav = String::from(
                r#"<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc"><ol>
"#,
            );
            for (index, (title, _)) in chapters.iter().enumerate() {
                nav.push_str(&format!(
                    "<li><a href=\"chapter{idx}.xhtml\">{title}</a></li>\n",
                    idx = index + 1,
                    title = title
                ));
            }
            nav.push_str("    </ol></nav>\n  </body>\n</html>\n");
            zip.start_file("OEBPS/nav.xhtml", options)
                .expect("nav");
            zip.write_all(nav.as_bytes())
                .expect("write nav");
        }

        for (index, (_, body)) in chapters.iter().enumerate() {
            let chapter = format!(
                r#"<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter {idx}</title></head>
  <body>{body}</body>
</html>
"#,
                idx = index + 1,
                body = body
            );
            zip.start_file(format!("OEBPS/chapter{idx}.xhtml", idx = index + 1), options)
                .expect("chapter");
            zip.write_all(chapter.as_bytes())
                .expect("write chapter");
        }

        zip.finish().expect("finish epub");
    }

    fn temp_epub(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "creader_book_text_{}_{}_{}.epub",
            name,
            std::process::id(),
            nanos
        ))
    }

    #[test]
    fn list_chapters_returns_nav_titles_and_spine_order() {
        let path = temp_epub("multi");
        write_test_epub(
            &path,
            &[
                ("Alpha", "<p>First chapter body.</p>"),
                ("Beta", "<p>Second chapter body.</p>"),
            ],
            true,
        );

        let chapters = list_chapters(&path).expect("list chapters");
        assert_eq!(chapters.len(), 2);
        assert_eq!(chapters[0].index, 0);
        assert_eq!(chapters[0].title, "Alpha");
        assert_eq!(chapters[1].index, 1);
        assert_eq!(chapters[1].title, "Beta");
        assert!(chapters[0].byte_len > 0);
        assert!(chapters[1].byte_len > 0);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn list_chapters_falls_back_when_nav_missing() {
        let path = temp_epub("no-nav");
        write_test_epub(
            &path,
            &[
                ("Ignored", "<p>One</p>"),
                ("Also Ignored", "<p>Two</p>"),
            ],
            false,
        );

        let chapters = list_chapters(&path).expect("list chapters");
        assert_eq!(chapters[0].title, "Chapter 1");
        assert_eq!(chapters[1].title, "Chapter 2");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    #[serial]
    fn get_chapter_text_strips_tags_and_normalizes_whitespace() {
        let path = temp_epub("strip");
        write_test_epub(
            &path,
            &[(
                "Strip",
                "<p>Hello <strong>world</strong>.</p><script>alert(1)</script><style>.x{}</style><p>Line two.</p>",
            )],
            true,
        );

        let slice = get_chapter_text(&path, 0, None, None, &BookTextCache::default())
            .expect("get chapter");
        assert!(!slice.text.contains('<'));
        assert!(!slice.text.contains("alert"));
        assert!(!slice.text.contains(".x{}"));
        assert!(slice.text.contains("Hello world."));
        assert!(slice.text.contains("Line two."));
        assert_eq!(slice.offset, 0);
        assert!(slice.next_offset.is_none());

        let _ = std::fs::remove_file(path);
    }

    #[test]
    #[serial]
    fn get_chapter_text_slices_with_next_offset() {
        let path = temp_epub("slice");
        let repeated = "甲乙丙丁戊己庚辛壬癸".repeat(120);
        write_test_epub(
            &path,
            &[("Long", &format!("<p>{repeated}</p>"))],
            false,
        );

        let first = get_chapter_text(&path, 0, Some(0), Some(500), &BookTextCache::default())
            .expect("first slice");
        assert_eq!(first.text.chars().count(), 500);
        assert_eq!(first.offset, 0);
        assert!(first.next_offset.is_some());

        let second = get_chapter_text(
            &path,
            0,
            first.next_offset,
            Some(500),
            &BookTextCache::default(),
        )
        .expect("second slice");
        assert_eq!(second.offset, first.next_offset.unwrap());
        assert_eq!(second.text.chars().count(), 500);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    #[serial]
    fn get_chapter_text_reads_only_requested_spine_entry() {
        let path = temp_epub("single-entry");
        write_test_epub(
            &path,
            &[
                ("One", "<p>First unique body.</p>"),
                ("Two", "<p>Second unique body.</p>"),
            ],
            true,
        );

        reset_test_counters();
        let before = chapter_extractions();
        let slice = get_chapter_text(&path, 1, None, None, &BookTextCache::default())
            .expect("second chapter");
        assert_eq!(slice.text, "Second unique body.");
        assert_eq!(chapter_extractions() - before, 1);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    #[serial]
    fn get_chapter_text_uses_lru_cache_on_repeat_reads() {
        let path = temp_epub("cache");
        write_test_epub(
            &path,
            &[("Cached", "<p>Cache me.</p>")],
            false,
        );

        let cache = BookTextCache::with_default_capacity();
        reset_test_counters();
        let before = chapter_extractions();

        let first = get_chapter_text(&path, 0, None, None, &cache).expect("first read");
        assert_eq!(first.text, "Cache me.");
        assert_eq!(chapter_extractions() - before, 1);

        let second = get_chapter_text(&path, 0, None, None, &cache).expect("second read");
        assert_eq!(second.text, "Cache me.");
        assert_eq!(chapter_extractions() - before, 1);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    #[serial]
    fn get_chapter_text_invalidates_cache_when_book_file_is_replaced() {
        // #127: the process-wide cache keyed only on (path, index) returned
        // stale text when a book was replaced or re-imported at the same path.
        // Now each entry carries the file's mtime+size, so a replaced file
        // forces a re-extraction.
        let path = temp_epub("cache-invalidate");
        write_test_epub(&path, &[("Chapter", "<p>original body</p>")], false);

        let cache = BookTextCache::with_default_capacity();
        reset_test_counters();
        let before = chapter_extractions();

        let first = get_chapter_text(&path, 0, None, None, &cache).expect("first read");
        assert_eq!(first.text, "original body");
        assert_eq!(chapter_extractions() - before, 1);

        // Second read is served from cache (no new extraction).
        let cached = get_chapter_text(&path, 0, None, None, &cache).expect("cached read");
        assert_eq!(cached.text, "original body");
        assert_eq!(chapter_extractions() - before, 1);

        // Replace the file at the same path with different content (different
        // size so the staleness check trips even if mtime granularity misses).
        write_test_epub(&path, &[("Chapter", "<p>replaced NEW body that is longer</p>")], false);

        reset_test_counters();
        let before_replace_read = chapter_extractions();
        let after_replace =
            get_chapter_text(&path, 0, None, None, &cache).expect("read after replace");
        assert_eq!(after_replace.text, "replaced NEW body that is longer");
        // Stale cache entry forces exactly one fresh extraction.
        assert_eq!(chapter_extractions() - before_replace_read, 1);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    #[serial]
    fn get_chapter_text_caches_large_chapter_for_deep_pagination() {
        // Regression for #100: a chapter above the legacy 512k-char ceiling
        // (but under the new 2M-char hard guard) must still enter the cache on
        // the first read, so that subsequent pages do not re-open the ZIP or
        // re-parse the XHTML. Before #100 each page was O(n) over the whole
        // chapter; now only the first page pays full extraction.
        let path = temp_epub("large-cache");
        let mut body = String::new();
        // ~700k chars of content: above the old ceiling, below the new one.
        for _ in 0..70_000 {
            body.push_str("<p>abcdefghij</p>"); // 10 chars per <p>
        }
        write_test_epub(&path, &[("Big", body.as_str())], false);

        let cache = BookTextCache::with_default_capacity();
        reset_test_counters();
        let before_extractions = chapter_extractions();
        let before_opens = archive_opens();

        // First page: cold cache. Extracts the whole chapter once and caches it.
        let first =
            get_chapter_text(&path, 0, Some(0), Some(1000), &cache).expect("first page");
        assert_eq!(first.text.chars().count(), 1000);
        assert_eq!(first.offset, 0);
        let first_next = first.next_offset.expect("first page has next");
        assert_eq!(first_next, 1000);

        let first_extractions = chapter_extractions() - before_extractions;
        let first_opens = archive_opens() - before_opens;
        assert_eq!(
            first_extractions, 1,
            "first page must extract the chapter exactly once"
        );
        assert_eq!(
            first_opens, 1,
            "first page must open the archive exactly once"
        );

        // Second page (deep offset): warm cache. No re-extraction, no re-open.
        let second = get_chapter_text(&path, 0, Some(first_next), Some(1000), &cache)
            .expect("second page");
        assert_eq!(second.text.chars().count(), 1000);
        assert_eq!(second.offset, first_next);

        let second_extractions = chapter_extractions() - before_extractions;
        let second_opens = archive_opens() - before_opens;
        assert_eq!(
            second_extractions, 1,
            "second page must not re-extract; cache hit expected"
        );
        assert_eq!(
            second_opens, 1,
            "second page must not re-open the archive; cache hit expected"
        );

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn normalization_sink_matches_frontend_rules() {
        let raw = "Hello\tworld\r\n\r\n\r\nLine two";
        assert_eq!(normalize_with_sink(raw), "Hello world\n\nLine two");
    }

    #[test]
    fn extract_xhtml_text_streams_from_reader() {
        let html = br#"<html><body><p>Stream <em>text</em></p><script>no</script></body></html>"#;
        let mut reader = Cursor::new(html.as_slice());
        let text = extract_xhtml_text(&mut reader).expect("extract");
        assert_eq!(text, "Stream text");
    }

    #[test]
    fn extract_xhtml_text_preserves_br_newlines() {
        // Self-closing <br/> arrives as Event::Empty; before the fix it was
        // dropped, collapsing "line1<br/>line2" into "line1line2".
        let html = b"<p>line1<br/>line2</p>";
        let mut reader = Cursor::new(html.as_slice());
        let text = extract_xhtml_text(&mut reader).expect("extract");
        assert_eq!(text, "line1\nline2");
    }

    #[test]
    fn extract_xhtml_text_separates_table_cells() {
        // Same-row cells used to concatenate into "AB"; now separated by a space.
        let html = b"<table><tr><td>A</td><td>B</td></tr></table>";
        let mut reader = Cursor::new(html.as_slice());
        let text = extract_xhtml_text(&mut reader).expect("extract");
        assert_eq!(text, "A B");
    }

    #[test]
    fn extract_xhtml_text_treats_hr_as_block_break() {
        // <hr/> is a block tag, so it contributes a newline boundary. Combined
        // with the surrounding <p> tags' newlines this yields a blank-line
        // separator (collapsed from 3+ to 2 by the normalizer).
        let html = b"<p>before</p><hr/><p>after</p>";
        let mut reader = Cursor::new(html.as_slice());
        let text = extract_xhtml_text(&mut reader).expect("extract");
        assert_eq!(text, "before\n\nafter");
    }

    #[test]
    #[serial]
    fn list_chapters_only_touches_metadata_entries() {
        let path = temp_epub("metadata-only");
        write_test_epub(
            &path,
            &[
                ("One", "<p>Chapter one.</p>"),
                ("Two", "<p>Chapter two.</p>"),
            ],
            true,
        );

        reset_test_counters();
        let before = chapter_extractions();
        let chapters = list_chapters(&path).expect("list");
        assert_eq!(chapters.len(), 2);
        assert_eq!(chapter_extractions() - before, 0);
        assert!(chapters[0].byte_len > 0);
        assert!(chapters[1].byte_len > 0);

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    #[serial]
    async fn async_helpers_run_on_spawn_blocking() {
        let path = temp_epub("async");
        write_test_epub(
            &path,
            &[("Async", "<p>Blocking path.</p>")],
            false,
        );

        let chapters = list_chapters_async(path.clone())
            .await
            .expect("async list");
        assert_eq!(chapters[0].title, "Chapter 1");

        let cache = Arc::new(BookTextCache::default());
        let slice = get_chapter_text_async(path.clone(), 0, None, None, cache)
            .await
            .expect("async get");
        assert_eq!(slice.text, "Blocking path.");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    #[serial]
    fn get_chapter_text_deep_pagination_counts_chars_incrementally() {
        // Regression for the O(n^2) normalize path: a long chapter paged from a
        // non-zero offset must still return exactly `limit` chars and a correct
        // `next_offset`, without re-normalizing the whole chapter per event.
        let path = temp_epub("deep-page");
        // One paragraph per <p> so the chapter has many small Text events,
        // which is the shape that exposed the repeated full-normalize cost.
        let mut body = String::new();
        for _ in 0..4000 {
            body.push_str("<p>甲乙丙丁戊己庚辛壬癸</p>");
        }
        write_test_epub(&path, &[("Long", body.as_str())], false);

        let cache = BookTextCache::default();
        let mid_offset = 20_000;
        let first =
            get_chapter_text(&path, 0, Some(mid_offset), Some(1000), &cache).expect("mid slice");
        assert_eq!(first.offset, mid_offset);
        assert_eq!(first.text.chars().count(), 1000);
        assert!(first.next_offset.is_some());
        assert_eq!(first.next_offset, Some(mid_offset + 1000));

        let _ = std::fs::remove_file(path);
    }

    fn write_epub_with_oversized_nav(path: &Path) {
        // Build a minimal EPUB whose nav document exceeds the test-only
        // MAX_METADATA_ENTRY_BYTES (4 KB) so we can assert the metadata read
        // refuses to load it.
        let file = File::create(path).expect("create epub");
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default();

        zip.start_file("mimetype", options).expect("mimetype");
        zip.write_all(b"application/epub+zip").expect("mimetype");
        zip.start_file("META-INF/container.xml", options)
            .expect("container");
        zip.write_all(
            br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#,
        )
        .expect("container");

        zip.start_file("OEBPS/content.opf", options).expect("opf");
        zip.write_all(
            br#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Big</dc:title></metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>"#,
        )
        .expect("opf");

        zip.start_file("OEBPS/nav.xhtml", options).expect("nav");
        // Pad well past the 4 KB test cap.
        let mut nav = String::from(
            r#"<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body><nav epub:type="toc"><ol><li><a href="chapter1.xhtml">Big</a></li></ol></nav>
"#,
        );
        nav.push_str(&"x".repeat(8192));
        nav.push_str("</body></html>");
        zip.write_all(nav.as_bytes()).expect("nav");

        zip.start_file("OEBPS/chapter1.xhtml", options)
            .expect("chapter");
        zip.write_all(b"<?xml version=\"1.0\"?><html><body><p>Body.</p></body></html>")
            .expect("chapter");

        zip.finish().expect("finish");
    }

    #[test]
    #[serial]
    fn list_chapters_degrades_when_nav_exceeds_size_cap() {
        let path = temp_epub("oversized-nav");
        write_epub_with_oversized_nav(&path);

        // The oversized nav is rejected by read_zip_text, so title resolution
        // falls back to the spine-derived "Chapter N" titles instead of
        // failing the whole listing.
        let chapters = list_chapters(&path).expect("list degrades");
        assert_eq!(chapters.len(), 1);
        assert_eq!(chapters[0].title, "Chapter 1");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    #[serial]
    fn search_book_finds_keyword_and_returns_excerpt() {
        let path = temp_epub("search-hit");
        write_test_epub(
            &path,
            &[
                ("Intro", "<p>Nothing relevant here.</p>"),
                ("Middle", "<p>The quantum observer effect appears in this chapter.</p>"),
                ("End", "<p>Closing remarks only.</p>"),
            ],
            true,
        );

        let result = search_book(&path, "quantum observer", None, &BookTextCache::default())
            .expect("search");
        assert_eq!(result.hits.len(), 1);
        assert_eq!(result.hits[0].index, 1);
        assert_eq!(result.hits[0].title, "Middle");
        assert!(result.hits[0].excerpt.contains("quantum observer"));
        assert!(!result.truncated);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    #[serial]
    fn search_book_matches_case_insensitive() {
        let path = temp_epub("search-case");
        write_test_epub(
            &path,
            &[("Chapter", "<p>The Needle in the haystack.</p>")],
            false,
        );

        let result = search_book(&path, "needle", None, &BookTextCache::default())
            .expect("search");
        assert_eq!(result.hits.len(), 1);
        assert_eq!(result.hits[0].index, 0);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    #[serial]
    fn search_book_excerpt_preserves_original_case() {
        let path = temp_epub("search-excerpt-case");
        write_test_epub(
            &path,
            &[("Chapter", "<p>The Needle in the haystack.</p>")],
            false,
        );

        let result = search_book(&path, "needle", None, &BookTextCache::default())
            .expect("search");
        assert_eq!(result.hits.len(), 1);
        assert!(result.hits[0].excerpt.contains("Needle"));
        assert!(!result.hits[0].excerpt.contains("needle"));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn search_book_rejects_empty_query() {
        let path = temp_epub("search-empty");
        write_test_epub(&path, &[("One", "<p>Body</p>")], false);

        let err = search_book(&path, "   ", None, &BookTextCache::default())
            .expect_err("empty query");
        assert!(err.contains("empty"));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    #[serial]
    fn search_book_truncates_when_hit_limit_reached() {
        let path = temp_epub("search-limit");
        write_test_epub(
            &path,
            &[
                ("One", "<p>needle in chapter one</p>"),
                ("Two", "<p>needle in chapter two</p>"),
                ("Three", "<p>needle in chapter three</p>"),
            ],
            true,
        );

        let result = search_book(&path, "needle", Some(2), &BookTextCache::default())
            .expect("search");
        assert_eq!(result.hits.len(), 2);
        assert!(result.truncated);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    #[serial]
    fn search_book_opens_archive_once_per_scan_not_per_chapter() {
        // Regression guard for the archive-open hoist: scanning a multi-chapter
        // book with a cold cache must open the ZIP exactly once for list + scan,
        // regardless of chapter count. If a future refactor moves the open back
        // inside the per-chapter loader, this assertion fires (would report N+1).
        let path = temp_epub("search-open-count");
        write_test_epub(
            &path,
            &[
                ("One", "<p>alpha token one</p>"),
                ("Two", "<p>beta token two</p>"),
                ("Three", "<p>gamma token three</p>"),
                ("Four", "<p>delta token four</p>"),
            ],
            true,
        );

        let cache = BookTextCache::with_default_capacity();
        reset_test_counters();
        let before = archive_opens();

        let result = search_book(&path, "token", None, &cache).expect("search");
        assert_eq!(result.hits.len(), 4);

        let opens = archive_opens() - before;
        assert_eq!(
            opens, 1,
            "scan must open archive once (shared list + scan), not once per chapter; opened {} times",
            opens
        );

        let _ = std::fs::remove_file(path);
    }

    #[test]
    #[serial]
    fn search_book_uses_chapter_cache_on_repeat_scan() {
        let path = temp_epub("search-cache");
        write_test_epub(
            &path,
            &[("Cached", "<p>unique-token-for-cache-test</p>")],
            false,
        );

        let cache = BookTextCache::with_default_capacity();
        reset_test_counters();
        let before = chapter_extractions();

        let first = search_book(&path, "unique-token", None, &cache).expect("first search");
        assert_eq!(first.hits.len(), 1);
        assert_eq!(chapter_extractions() - before, 1);

        let second = search_book(&path, "unique-token", None, &cache).expect("second search");
        assert_eq!(second.hits.len(), 1);
        assert_eq!(chapter_extractions() - before, 1);

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    #[serial]
    async fn search_book_async_runs_on_spawn_blocking() {
        let path = temp_epub("search-async");
        write_test_epub(
            &path,
            &[("Async", "<p>async-search-marker</p>")],
            false,
        );

        let cache = Arc::new(BookTextCache::default());
        let result = search_book_async(path.clone(), "async-search".to_string(), None, cache)
            .await
            .expect("async search");
        assert_eq!(result.hits.len(), 1);
        assert_eq!(result.hits[0].title, "Chapter 1");

        let _ = std::fs::remove_file(path);
    }

    /// Build an EPUB with explicit spine order, optional nav document, and
    /// per-chapter bodies keyed by manifest id (`ch1`, `ch2`, …).
    fn write_custom_spine_epub(
        path: &Path,
        spine_ids: &[&str],
        chapter_bodies: &HashMap<&str, (&str, &str)>,
        nav_xml: Option<&str>,
    ) {
        let file = File::create(path).expect("create epub");
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default();

        zip.start_file("mimetype", options).expect("mimetype");
        zip.write_all(b"application/epub+zip").expect("mimetype");
        zip.start_file("META-INF/container.xml", options)
            .expect("container");
        zip.write_all(
            br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#,
        )
        .expect("container");

        let mut manifest = String::from(
            r#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata>
    <dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Custom Spine Book</dc:title>
  </metadata>
  <manifest>
"#,
        );

        if nav_xml.is_some() {
            manifest.push_str(
                r#"    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
"#,
            );
        }

        for id in spine_ids {
            let href = format!("{id}.xhtml");
            manifest.push_str(&format!(
                r#"    <item id="{id}" href="{href}" media-type="application/xhtml+xml"/>
"#
            ));
        }

        manifest.push_str("  </manifest>\n  <spine>\n");
        for id in spine_ids {
            manifest.push_str(&format!(r#"    <itemref idref="{id}"/>
"#));
        }
        manifest.push_str("  </spine>\n</package>\n");

        zip.start_file("OEBPS/content.opf", options).expect("opf");
        zip.write_all(manifest.as_bytes()).expect("opf");

        if let Some(nav) = nav_xml {
            zip.start_file("OEBPS/nav.xhtml", options).expect("nav");
            zip.write_all(nav.as_bytes()).expect("nav");
        }

        for id in spine_ids {
            let (title, body) = chapter_bodies
                .get(id)
                .copied()
                .unwrap_or(("Untitled", "<p>Body.</p>"));
            let chapter = format!(
                r#"<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>{title}</title></head>
  <body>{body}</body>
</html>
"#
            );
            zip.start_file(format!("OEBPS/{id}.xhtml"), options)
                .expect("chapter");
            zip.write_all(chapter.as_bytes()).expect("chapter");
        }

        zip.finish().expect("finish epub");
    }

    #[test]
    fn find_case_insensitive_char_range_finds_match() {
        let text = "The Needle in the haystack.";
        let (start, len) = find_case_insensitive_char_range(text, "needle")
            .expect("match");
        assert_eq!(start, 4);
        assert_eq!(len, 6);
    }

    #[test]
    fn build_char_byte_index_maps_large_offsets() {
        let text: String = "a".repeat(1000);
        let index = build_char_byte_index(&text);
        assert_eq!(index.char_count, 1000);
        assert_eq!(char_offset_to_byte(&text, &index, 0), 0);
        assert_eq!(char_offset_to_byte(&text, &index, 512), 512);
        assert_eq!(char_offset_to_byte(&text, &index, 999), 999);
        assert_eq!(char_offset_to_byte(&text, &index, 1000), 1000);
    }

    #[test]
    fn slice_chapter_text_uses_index_for_deep_offset() {
        let text: String = "x".repeat(50_000);
        let index = build_char_byte_index(&text);
        let slice = slice_chapter_text(&text, Some(&index), 0, 40_000, 500);
        assert_eq!(slice.offset, 40_000);
        assert_eq!(slice.text.len(), 500);
        assert_eq!(slice.text.chars().count(), 500);
        assert_eq!(slice.next_offset, Some(40_500));
    }

    #[test]
    fn slice_chapter_text_deep_offset_timing_is_sublinear() {
        // Regression for #123: slicing at a large offset must not re-walk from
        // char 0, so late-page cost stays in the same ballpark as early pages.
        let text: String = "甲乙丙丁".repeat(25_000); // 100_000 chars
        let index = build_char_byte_index(&text);

        let early_start = Instant::now();
        let early = slice_chapter_text(&text, Some(&index), 0, 0, 1000);
        let early_elapsed = early_start.elapsed();

        let late_start = Instant::now();
        let late = slice_chapter_text(&text, Some(&index), 0, 90_000, 1000);
        let late_elapsed = late_start.elapsed();

        assert_eq!(early.text.chars().count(), 1000);
        assert_eq!(late.text.chars().count(), 1000);
        assert_eq!(late.offset, 90_000);
        assert!(
            late_elapsed <= early_elapsed * 8,
            "deep slice ({:?}) should not be much slower than early slice ({:?})",
            late_elapsed,
            early_elapsed
        );
    }

    #[test]
    fn map_toc_entries_assigns_titles_by_href_not_position() {
        let package = EpubPackage {
            opf_base: "OEBPS".to_string(),
            spine: vec!["preface".to_string(), "ch1".to_string(), "ch2".to_string()],
            manifest: HashMap::from([
                (
                    "preface".to_string(),
                    SpineItem {
                        href: "preface.xhtml".to_string(),
                        media_type: "application/xhtml+xml".to_string(),
                    },
                ),
                (
                    "ch1".to_string(),
                    SpineItem {
                        href: "chapter1.xhtml".to_string(),
                        media_type: "application/xhtml+xml".to_string(),
                    },
                ),
                (
                    "ch2".to_string(),
                    SpineItem {
                        href: "chapter2.xhtml".to_string(),
                        media_type: "application/xhtml+xml".to_string(),
                    },
                ),
            ]),
            nav_href: None,
            ncx_href: None,
        };

        let entries = vec![
            TocEntry {
                href: "chapter1.xhtml".to_string(),
                title: "Real Chapter One".to_string(),
            },
            TocEntry {
                href: "chapter2.xhtml".to_string(),
                title: "Real Chapter Two".to_string(),
            },
        ];

        let titles = map_toc_entries_to_spine_titles(&package, &entries);
        assert_eq!(titles.len(), 3);
        assert_eq!(titles[0], "Chapter 1");
        assert_eq!(titles[1], "Real Chapter One");
        assert_eq!(titles[2], "Real Chapter Two");
    }

    #[test]
    fn map_toc_entries_strips_fragment_from_href() {
        let package = EpubPackage {
            opf_base: "OEBPS".to_string(),
            spine: vec!["ch1".to_string()],
            manifest: HashMap::from([(
                "ch1".to_string(),
                SpineItem {
                    href: "chapter1.xhtml".to_string(),
                    media_type: "application/xhtml+xml".to_string(),
                },
            )]),
            nav_href: None,
            ncx_href: None,
        };

        let entries = vec![TocEntry {
            href: "chapter1.xhtml#section-2".to_string(),
            title: "Anchored Chapter".to_string(),
        }];

        let titles = map_toc_entries_to_spine_titles(&package, &entries);
        assert_eq!(titles[0], "Anchored Chapter");
    }

    #[test]
    fn map_toc_entries_ignores_extra_toc_items_beyond_spine() {
        let package = EpubPackage {
            opf_base: "OEBPS".to_string(),
            spine: vec!["ch1".to_string()],
            manifest: HashMap::from([
                (
                    "ch1".to_string(),
                    SpineItem {
                        href: "chapter1.xhtml".to_string(),
                        media_type: "application/xhtml+xml".to_string(),
                    },
                ),
                (
                    "extra".to_string(),
                    SpineItem {
                        href: "bonus.xhtml".to_string(),
                        media_type: "application/xhtml+xml".to_string(),
                    },
                ),
            ]),
            nav_href: None,
            ncx_href: None,
        };

        let entries = vec![
            TocEntry {
                href: "chapter1.xhtml".to_string(),
                title: "Only Spine Chapter".to_string(),
            },
            TocEntry {
                href: "bonus.xhtml".to_string(),
                title: "Not In Spine".to_string(),
            },
        ];

        let titles = map_toc_entries_to_spine_titles(&package, &entries);
        assert_eq!(titles.len(), 1);
        assert_eq!(titles[0], "Only Spine Chapter");
    }

    #[test]
    fn list_chapters_maps_nested_nav_by_href() {
        let path = temp_epub("nested-nav");
        let nav = r#"<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc"><ol>
      <li>
        <a href="ch1.xhtml">Chapter Alpha</a>
        <ol>
          <li><a href="ch1.xhtml#part-a">Part A</a></li>
          <li><a href="ch1.xhtml#part-b">Part B</a></li>
        </ol>
      </li>
      <li><a href="ch2.xhtml">Chapter Beta</a></li>
    </ol></nav>
  </body>
</html>
"#;
        let mut bodies = HashMap::new();
        bodies.insert("ch1", ("Alpha", "<p>Alpha body marker.</p>"));
        bodies.insert("ch2", ("Beta", "<p>Beta body marker.</p>"));
        write_custom_spine_epub(&path, &["ch1", "ch2"], &bodies, Some(nav));

        let chapters = list_chapters(&path).expect("list chapters");
        assert_eq!(chapters.len(), 2);
        assert_eq!(chapters[0].title, "Chapter Alpha");
        assert_eq!(chapters[1].title, "Chapter Beta");

        let alpha_text = get_chapter_text(&path, 0, None, None, &BookTextCache::default())
            .expect("alpha text");
        assert!(alpha_text.text.contains("Alpha body marker"));

        let beta_text = get_chapter_text(&path, 1, None, None, &BookTextCache::default())
            .expect("beta text");
        assert!(beta_text.text.contains("Beta body marker"));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn list_chapters_falls_back_for_spine_items_missing_from_toc() {
        let path = temp_epub("preface-outside-toc");
        let nav = r#"<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc"><ol>
      <li><a href="ch2.xhtml">Main Story</a></li>
    </ol></nav>
  </body>
</html>
"#;
        let mut bodies = HashMap::new();
        bodies.insert("preface", ("Preface", "<p>Preface-only body.</p>"));
        bodies.insert("ch2", ("Main", "<p>Main story body.</p>"));
        write_custom_spine_epub(&path, &["preface", "ch2"], &bodies, Some(nav));

        let chapters = list_chapters(&path).expect("list chapters");
        assert_eq!(chapters.len(), 2);
        assert_eq!(chapters[0].title, "Chapter 1");
        assert_eq!(chapters[1].title, "Main Story");

        let preface_text = get_chapter_text(&path, 0, None, None, &BookTextCache::default())
            .expect("preface text");
        assert!(preface_text.text.contains("Preface-only body"));

        let _ = std::fs::remove_file(path);
    }
}
