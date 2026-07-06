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
const MAX_CACHEABLE_CHAPTER_CHARS: usize = 512_000;
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

pub struct BookTextCache {
    inner: Mutex<LruCache<(String, usize), String>>,
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

    fn get(&self, book_key: &str, index: usize) -> Option<String> {
        self.inner
            .lock()
            .ok()
            .and_then(|mut cache| cache.get(&(book_key.to_string(), index)).cloned())
    }

    fn put(&self, book_key: &str, index: usize, text: String) {
        if text.chars().count() > MAX_CACHEABLE_CHAPTER_CHARS {
            return;
        }
        if let Ok(mut cache) = self.inner.lock() {
            cache.put((book_key.to_string(), index), text);
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
    tokio::task::spawn_blocking(move || blocking_list_chapters(&book_path))
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
    tokio::task::spawn_blocking(move || {
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
    tokio::task::spawn_blocking(move || {
        blocking_search_book(&book_path, &query, limit, cache.as_ref())
    })
    .await
    .map_err(|e| format!("search_book task failed: {}", e))?
}

fn blocking_list_chapters(book_path: &Path) -> Result<Vec<ChapterInfo>, String> {
    let mut archive = open_epub_archive(book_path)?;
    let package = load_epub_package(&mut archive)?;
    let titles = resolve_chapter_titles(&mut archive, &package)?;

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
    if let Some(full_text) = cache.get(&book_key, index) {
        return Ok(slice_chapter_text(&full_text, index, offset, limit));
    }

    let mut archive = open_epub_archive(book_path)?;
    let package = load_epub_package(&mut archive)?;
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
    let (extracted, reached_eof) = extract_xhtml_text(&mut buffered, offset, Some(limit))?;

    if reached_eof && offset == 0 && extracted.chars().count() <= MAX_CACHEABLE_CHAPTER_CHARS {
        cache.put(&book_key, index, extracted.clone());
    }

    let next_offset = if reached_eof {
        None
    } else {
        Some(offset + extracted.chars().count())
    };

    Ok(ChapterTextSlice {
        text: extracted,
        index,
        offset,
        next_offset,
    })
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

    let chapters = blocking_list_chapters(book_path)?;
    let mut truncated = chapters.len() > MAX_SEARCH_CHAPTERS;
    let mut hits = Vec::new();

    // Open the archive and parse the OPF package once for the whole scan.
    // Without this hoist, a miss on every chapter would re-open the ZIP and
    // re-parse container.xml + OPF once per chapter (up to 200x), burning the
    // 15s deadline on constant metadata I/O instead of text scanning.
    let book_key = canonical_book_key(book_path)?;
    let mut archive = open_epub_archive(book_path)?;
    let package = load_epub_package(&mut archive)?;

    for chapter in chapters.iter().take(MAX_SEARCH_CHAPTERS) {
        if Instant::now() >= deadline {
            truncated = true;
            break;
        }

        let full_text = load_chapter_text_from_open_archive(
            &mut archive,
            &package,
            &book_key,
            chapter.index,
            cache,
        )?;

        if full_text.contains(query) {
            hits.push(BookSearchHit {
                index: chapter.index,
                title: chapter.title.clone(),
                excerpt: build_search_excerpt(&full_text, query),
            });
            if hits.len() >= max_hits {
                truncated = true;
                break;
            }
        }
    }

    Ok(BookSearchResult { hits, truncated })
}

/// Reads a chapter's full plain text from an already-open archive, checking
/// the shared cache first and filling it on miss. Unlike the per-chapter
/// `open_epub_archive` + `load_epub_package` path, callers that scan many
/// chapters reuse a single archive and parsed package.
fn load_chapter_text_from_open_archive(
    archive: &mut ZipArchive<File>,
    package: &EpubPackage,
    book_key: &str,
    index: usize,
    cache: &BookTextCache,
) -> Result<String, String> {
    if let Some(full_text) = cache.get(book_key, index) {
        return Ok(full_text);
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
    let (extracted, _) = extract_xhtml_text(&mut buffered, 0, None)?;

    if extracted.chars().count() <= MAX_CACHEABLE_CHAPTER_CHARS {
        cache.put(book_key, index, extracted.clone());
    }

    Ok(extracted)
}

fn build_search_excerpt(text: &str, query: &str) -> String {
    let Some(byte_start) = text.find(query) else {
        return String::new();
    };

    let char_start = text[..byte_start].chars().count();
    let excerpt_start = char_start.saturating_sub(SEARCH_EXCERPT_CONTEXT_CHARS);
    let match_char_len = query.chars().count();
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

fn slice_chapter_text(full_text: &str, index: usize, offset: usize, limit: usize) -> ChapterTextSlice {
    let total_chars = full_text.chars().count();
    if offset >= total_chars {
        return ChapterTextSlice {
            text: String::new(),
            index,
            offset,
            next_offset: None,
        };
    }

    let text: String = full_text.chars().skip(offset).take(limit).collect();
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
            if let Ok(titles) = parse_epub3_nav_titles(&nav_xml) {
                if !titles.is_empty() {
                    return Ok(pad_titles(package.spine.len(), titles));
                }
            }
        }
    }

    if let Some(ncx_href) = &package.ncx_href {
        if let Ok(ncx_xml) = read_zip_text(archive, ncx_href) {
            if let Ok(titles) = parse_ncx_titles(&ncx_xml) {
                if !titles.is_empty() {
                    return Ok(pad_titles(package.spine.len(), titles));
                }
            }
        }
    }

    Ok((0..package.spine.len())
        .map(fallback_chapter_title)
        .collect())
}

fn pad_titles(spine_len: usize, mut titles: Vec<String>) -> Vec<String> {
    if titles.len() < spine_len {
        for index in titles.len()..spine_len {
            titles.push(fallback_chapter_title(index));
        }
    } else if titles.len() > spine_len {
        titles.truncate(spine_len);
    }
    titles
}

fn parse_epub3_nav_titles(xml: &str) -> Result<Vec<String>, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();

    let mut titles = Vec::new();
    let mut in_toc_nav = false;
    let mut nav_depth: u32 = 0;
    let mut in_anchor = false;
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
                    current.clear();
                } else if in_toc_nav {
                    nav_depth += 1;
                }
            }
            Ok(Event::End(e)) => {
                let name = e.name().as_ref().to_ascii_lowercase();
                if name == b"a" && in_anchor {
                    let title = current.trim();
                    if !title.is_empty() {
                        titles.push(title.to_string());
                    }
                    in_anchor = false;
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

    Ok(titles)
}

fn parse_ncx_titles(xml: &str) -> Result<Vec<String>, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();

    let mut titles = Vec::new();
    let mut in_nav_label = false;
    let mut current = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                if local_name_eq(e.name().as_ref(), b"navLabel")
                    || local_name_eq(e.name().as_ref(), b"navlabel")
                {
                    in_nav_label = true;
                    current.clear();
                }
            }
            Ok(Event::End(e)) => {
                if local_name_eq(e.name().as_ref(), b"navLabel")
                    || local_name_eq(e.name().as_ref(), b"navlabel")
                {
                    let title = current.trim();
                    if !title.is_empty() {
                        titles.push(title.to_string());
                    }
                    in_nav_label = false;
                    current.clear();
                }
            }
            Ok(Event::Text(e)) if in_nav_label => {
                if let Ok(text) = e.unescape() {
                    current.push_str(text.as_ref());
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(e) => return Err(format!("Failed to parse NCX document: {}", e)),
        }
        buf.clear();
    }

    Ok(titles)
}

fn extract_xhtml_text(
    reader: &mut impl BufRead,
    skip: usize,
    take: Option<usize>,
) -> Result<(String, bool), String> {
    test_record_chapter_extraction();

    let mut xml = Reader::from_reader(reader);

    // Incremental normalization buffer. Streaming the whitespace rules as we
    // consume Text events keeps deep pagination (`offset` in the hundreds of
    // thousands) linear in chapter size, instead of re-normalizing the whole
    // accumulated `raw` on every event.
    let mut output = String::new();
    let mut normalizer = NormalizationSink::new();
    let mut skip_depth = 0u32;
    let mut head_depth = 0u32;
    let mut buf = Vec::new();
    let target_end = take.map(|limit| skip.saturating_add(limit));
    let mut reached_target = false;

    loop {
        match xml.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = e.name().as_ref().to_ascii_lowercase();
                if name == b"head" {
                    head_depth += 1;
                } else if head_depth == 0 {
                    if name == b"script" || name == b"style" {
                        skip_depth += 1;
                    } else if skip_depth == 0 && is_block_tag(&name) {
                        normalizer.append("\n", &mut output);
                    }
                }
            }
            Ok(Event::End(e)) => {
                let name = e.name().as_ref().to_ascii_lowercase();
                if name == b"head" {
                    head_depth = head_depth.saturating_sub(1);
                } else if head_depth == 0 {
                    if name == b"script" || name == b"style" {
                        skip_depth = skip_depth.saturating_sub(1);
                    } else if skip_depth == 0 && is_block_tag(&name) {
                        normalizer.append("\n", &mut output);
                    }
                }
            }
            Ok(Event::Text(e)) if head_depth == 0 && skip_depth == 0 => {
                let text = e
                    .unescape()
                    .map_err(|err| format!("Failed to decode XHTML text: {}", err))?;
                normalizer.append(text.as_ref(), &mut output);

                if let Some(end) = target_end {
                    if normalizer.char_count() >= end {
                        reached_target = true;
                        break;
                    }
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(e) => return Err(format!("Failed to parse XHTML: {}", e)),
        }
        buf.clear();
    }

    // `output` is already normalized inline; only a final trim remains.
    let normalized = output.trim().to_string();
    let reached_eof = !reached_target;
    let text: String = normalized.chars().skip(skip).take(take.unwrap_or(usize::MAX)).collect();

    Ok((text, reached_eof))
}

/// Incrementally normalizes extracted text. Folds runs of spaces/tabs into a
/// single space, collapses 3+ newlines to 2, and tracks the normalized char
/// count so callers can stop reading once they have enough.
///
/// Leading whitespace is dropped during append (callers typically `.trim()` once
/// at the end), so `char_count` matches the trimmed output the caller will
/// slice from — otherwise deep-pagination offsets would drift by the number
/// of leading whitespace bytes.
struct NormalizationSink {
    char_count: usize,
    leading: bool,
    prev_was_space: bool,
    consecutive_newlines: u32,
}

impl NormalizationSink {
    fn new() -> Self {
        Self {
            char_count: 0,
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
                    self.char_count += 1;
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
                    self.char_count += 1;
                }
                continue;
            }

            self.consecutive_newlines = 0;
            out.push(ch);
            self.char_count += 1;
        }
    }

    fn char_count(&self) -> usize {
        self.char_count
    }
}

fn is_block_tag(name: &[u8]) -> bool {
    matches!(
        name,
        b"p" | b"div" | b"section" | b"article" | b"blockquote" | b"li" | b"h1" | b"h2"
            | b"h3" | b"h4" | b"h5" | b"h6" | b"tr" | b"br"
    )
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

#[cfg(test)]
pub(crate) static CHAPTER_EXTRACTIONS: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

#[cfg(test)]
pub(crate) static ARCHIVE_OPENS: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

fn test_record_chapter_extraction() {
    #[cfg(test)]
    CHAPTER_EXTRACTIONS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
}

fn test_record_archive_open() {
    #[cfg(test)]
    ARCHIVE_OPENS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use std::sync::atomic::Ordering;
    use std::sync::Arc;
    use serial_test::serial;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn reset_test_counters() {
        super::CHAPTER_EXTRACTIONS.store(0, Ordering::SeqCst);
        super::ARCHIVE_OPENS.store(0, Ordering::SeqCst);
    }

    fn chapter_extractions() -> usize {
        super::CHAPTER_EXTRACTIONS.load(Ordering::SeqCst)
    }

    fn archive_opens() -> usize {
        super::ARCHIVE_OPENS.load(Ordering::SeqCst)
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
    fn normalization_sink_matches_frontend_rules() {
        let raw = "Hello\tworld\r\n\r\n\r\nLine two";
        assert_eq!(normalize_with_sink(raw), "Hello world\n\nLine two");
    }

    #[test]
    fn extract_xhtml_text_streams_from_reader() {
        let html = br#"<html><body><p>Stream <em>text</em></p><script>no</script></body></html>"#;
        let mut reader = Cursor::new(html.as_slice());
        let (text, reached_eof) = extract_xhtml_text(&mut reader, 0, None).expect("extract");
        assert_eq!(text, "Stream text");
        assert!(reached_eof);
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
        // book with a cold cache must open the ZIP exactly twice -- once for
        // blocking_list_chapters and once for the scan body -- regardless of
        // chapter count. If a future refactor moves the open back inside the
        // per-chapter loader, this assertion fires (would report N+1).
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
            opens, 2,
            "scan must open archive twice (list + scan), not once per chapter; opened {} times",
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
}
