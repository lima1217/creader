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
use zip::read::ZipArchive;

const DEFAULT_CHAPTER_CACHE_CAPACITY: usize = 32;
const MAX_CACHEABLE_CHAPTER_CHARS: usize = 512_000;
const DEFAULT_SLICE_LIMIT: usize = 16_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChapterInfo {
    pub index: usize,
    pub title: String,
    pub char_len: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChapterTextSlice {
    pub text: String,
    pub index: usize,
    pub offset: usize,
    pub next_offset: Option<usize>,
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

pub fn list_chapters(book_path: &Path) -> Result<Vec<ChapterInfo>, String> {
    let book_path = book_path.to_path_buf();
    blocking_list_chapters(&book_path)
}

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
        let char_len = archive
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
            char_len,
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

fn read_zip_text(archive: &mut ZipArchive<File>, name: &str) -> Result<String, String> {
    let mut entry = archive
        .by_name(name)
        .map_err(|e| format!("EPUB entry not found '{}': {}", name, e))?;
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

    let mut raw = String::new();
    let mut skip_depth = 0u32;
    let mut head_depth = 0u32;
    let mut buf = Vec::new();
    let target_end = take.map(|limit| skip.saturating_add(limit));

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
                        push_block_break(&mut raw);
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
                        push_block_break(&mut raw);
                    }
                }
            }
            Ok(Event::Text(e)) if head_depth == 0 && skip_depth == 0 => {
                let text = e
                    .unescape()
                    .map_err(|err| format!("Failed to decode XHTML text: {}", err))?;
                raw.push_str(text.as_ref());

                if let Some(end) = target_end {
                    if normalize_text(&raw).chars().count() >= end {
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

    let normalized = normalize_text(&raw);
    let reached_eof = target_end.is_none_or(|end| normalized.chars().count() < end);
    let text: String = normalized.chars().skip(skip).take(take.unwrap_or(usize::MAX)).collect();

    Ok((text, reached_eof))
}

fn normalize_text(text: &str) -> String {
    let mut normalized = String::with_capacity(text.len());
    let mut prev_was_space = false;
    let mut consecutive_newlines = 0u32;

    for ch in text.replace("\r\n", "\n").chars() {
        if ch == ' ' || ch == '\t' {
            if !prev_was_space {
                normalized.push(' ');
                prev_was_space = true;
            }
            continue;
        }

        prev_was_space = false;

        if ch == '\n' {
            consecutive_newlines += 1;
            if consecutive_newlines <= 2 {
                normalized.push('\n');
            }
            continue;
        }

        consecutive_newlines = 0;
        normalized.push(ch);
    }

    normalized.trim().to_string()
}

fn push_block_break(output: &mut String) {
    if output.is_empty() {
        return;
    }
    if !output.ends_with('\n') {
        output.push('\n');
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

fn test_record_chapter_extraction() {
    #[cfg(test)]
    CHAPTER_EXTRACTIONS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
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
    }

    fn chapter_extractions() -> usize {
        super::CHAPTER_EXTRACTIONS.load(Ordering::SeqCst)
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
        assert!(chapters[0].char_len > 0);
        assert!(chapters[1].char_len > 0);

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
    fn normalize_text_matches_frontend_rules() {
        let raw = "Hello\tworld\r\n\r\n\r\nLine two";
        assert_eq!(normalize_text(raw), "Hello world\n\nLine two");
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
        assert!(chapters[0].char_len > 0);
        assert!(chapters[1].char_len > 0);

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
}
