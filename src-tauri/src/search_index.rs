use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::hash::{Hash, Hasher};
use std::io::{Read, Seek};
use std::path::{Path, PathBuf};
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::{
    Field, IndexRecordOption, Schema, TantivyDocument, TextFieldIndexing, TextOptions, STORED,
    Value, STRING,
};
use tantivy::{doc, Index, IndexWriter};
use zip::ZipArchive;

const INDEX_VERSION: u32 = 1;
const JIEBA_TOKENIZER: &str = "jieba";
const MAX_RESULTS: usize = 50;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchLocator {
    pub kind: String,
    pub href: String,
    pub spine_index: usize,
    pub cfi: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSection {
    pub title: String,
    pub locator: SearchLocator,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubExtraction {
    pub title: String,
    pub author: String,
    pub sections: Vec<SearchSection>,
    pub parser: String,
    pub parser_decision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileFingerprint {
    pub len: u64,
    pub modified_ms: u128,
    pub content_hash: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SearchIndexState {
    Missing,
    Pending,
    Ready,
    Failed,
    Stale,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchIndexStatus {
    pub state: SearchIndexState,
    pub error: Option<String>,
    pub fingerprint: Option<FileFingerprint>,
    pub indexed_at_ms: Option<u128>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub locator: SearchLocator,
    pub section_title: String,
    pub excerpt: String,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchIndexMetadata {
    version: u32,
    state: SearchIndexState,
    error: Option<String>,
    fingerprint: Option<FileFingerprint>,
    indexed_at_ms: Option<u128>,
}

struct SearchSchema {
    schema: Schema,
    section_title: Field,
    href: Field,
    spine_index: Field,
    cfi: Field,
    text: Field,
}

pub fn extract_epub_for_search(path: &Path) -> Result<EpubExtraction, String> {
    let file = File::open(path).map_err(|e| format!("Failed to open EPUB: {}", e))?;
    let mut zip = ZipArchive::new(file).map_err(|e| format!("Failed to read EPUB archive: {}", e))?;
    extract_epub_from_zip(&mut zip)
}

pub fn get_index_status(root: &Path, book_id: &str, file_path: &Path) -> SearchIndexStatus {
    let index_dir = index_dir(root, book_id);
    let metadata = read_metadata(&index_dir);
    let fingerprint = file_fingerprint(file_path).ok();

    let Some(metadata) = metadata else {
        return SearchIndexStatus {
            state: SearchIndexState::Missing,
            error: None,
            fingerprint,
            indexed_at_ms: None,
        };
    };

    if metadata.state == SearchIndexState::Ready && metadata.fingerprint != fingerprint {
        return SearchIndexStatus {
            state: SearchIndexState::Stale,
            error: Some("EPUB file changed after the Search Index was built.".to_string()),
            fingerprint,
            indexed_at_ms: metadata.indexed_at_ms,
        };
    }

    SearchIndexStatus {
        state: metadata.state,
        error: metadata.error,
        fingerprint: metadata.fingerprint,
        indexed_at_ms: metadata.indexed_at_ms,
    }
}

pub fn rebuild_index(root: &Path, book_id: &str, file_path: &Path) -> Result<SearchIndexStatus, String> {
    let index_dir = index_dir(root, book_id);
    fs::create_dir_all(&index_dir)
        .map_err(|e| format!("Failed to create Search Index directory: {}", e))?;
    write_metadata(&index_dir, pending_metadata())?;

    let result = (|| {
        let fingerprint = file_fingerprint(file_path)?;
        let extraction = extract_epub_for_search(file_path)?;
        if extraction.sections.is_empty() {
            return Err("No readable EPUB sections were found.".to_string());
        }

        let tantivy_dir = tantivy_dir(&index_dir);
        if tantivy_dir.exists() {
            fs::remove_dir_all(&tantivy_dir)
                .map_err(|e| format!("Failed to clear old Search Index: {}", e))?;
        }
        fs::create_dir_all(&tantivy_dir)
            .map_err(|e| format!("Failed to create Tantivy index directory: {}", e))?;

        let fields = build_schema();
        let index = Index::create_in_dir(&tantivy_dir, fields.schema.clone())
            .map_err(|e| format!("Failed to create Tantivy index: {}", e))?;
        register_tokenizers(&index);

        let mut writer: IndexWriter = index
            .writer(50_000_000)
            .map_err(|e| format!("Failed to open Search Index writer: {}", e))?;
        for section in extraction.sections {
            writer
                .add_document(doc!(
                    fields.section_title => section.title,
                    fields.href => section.locator.href,
                    fields.spine_index => section.locator.spine_index as u64,
                    fields.cfi => section.locator.cfi.unwrap_or_default(),
                    fields.text => section.text,
                ))
                .map_err(|e| format!("Failed to add section to Search Index: {}", e))?;
        }
        writer
            .commit()
            .map_err(|e| format!("Failed to commit Search Index: {}", e))?;

        let metadata = SearchIndexMetadata {
            version: INDEX_VERSION,
            state: SearchIndexState::Ready,
            error: None,
            fingerprint: Some(fingerprint),
            indexed_at_ms: Some(now_ms()),
        };
        write_metadata(&index_dir, metadata.clone())?;
        Ok(status_from_metadata(metadata))
    })();

    if let Err(error) = result {
        let metadata = SearchIndexMetadata {
            version: INDEX_VERSION,
            state: SearchIndexState::Failed,
            error: Some(error.clone()),
            fingerprint: file_fingerprint(file_path).ok(),
            indexed_at_ms: None,
        };
        let _ = write_metadata(&index_dir, metadata);
        return Err(error);
    }

    result
}

pub fn search_index(
    root: &Path,
    book_id: &str,
    file_path: &Path,
    query: &str,
) -> Result<Vec<SearchResult>, String> {
    let status = get_index_status(root, book_id, file_path);
    if status.state != SearchIndexState::Ready {
        return Err(format!("Search Index is {:?}.", status.state).to_lowercase());
    }
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let fields = build_schema();
    let index = Index::open_in_dir(tantivy_dir(&index_dir(root, book_id)))
        .map_err(|e| format!("Failed to open Search Index: {}", e))?;
    register_tokenizers(&index);
    let reader = index
        .reader()
        .map_err(|e| format!("Failed to open Search Index reader: {}", e))?;
    let searcher = reader.searcher();
    let parser = QueryParser::for_index(&index, vec![fields.text, fields.section_title]);
    let parsed = parser
        .parse_query(query)
        .map_err(|e| format!("Failed to parse search query: {}", e))?;
    let top_docs = searcher
        .search(&parsed, &TopDocs::with_limit(MAX_RESULTS).order_by_score())
        .map_err(|e| format!("Failed to search index: {}", e))?;

    let mut results = Vec::new();
    for (score, addr) in top_docs {
        let doc: TantivyDocument = searcher
            .doc(addr)
            .map_err(|e| format!("Failed to read search hit: {}", e))?;
        let title = text_value(&doc, fields.section_title);
        let href = text_value(&doc, fields.href);
        let cfi = text_value(&doc, fields.cfi);
        let text = text_value(&doc, fields.text);
        let spine_index = u64_value(&doc, fields.spine_index) as usize;
        results.push(SearchResult {
            locator: SearchLocator {
                kind: if cfi.is_empty() { "chapter" } else { "cfi" }.to_string(),
                href,
                spine_index,
                cfi: if cfi.is_empty() { None } else { Some(cfi) },
            },
            section_title: title,
            excerpt: excerpt_for_query(&text, query),
            score,
        });
    }
    Ok(results)
}

fn extract_epub_from_zip<R: Read + Seek>(zip: &mut ZipArchive<R>) -> Result<EpubExtraction, String> {
    let container = read_zip_string(zip, "META-INF/container.xml")
        .map_err(|e| format!("Failed to read EPUB container.xml: {}", e))?;
    let container_doc = roxmltree::Document::parse(&container)
        .map_err(|e| format!("Failed to parse EPUB container.xml: {}", e))?;
    let opf_path = container_doc
        .descendants()
        .find(|n| n.has_tag_name("rootfile"))
        .and_then(|n| n.attribute("full-path"))
        .ok_or("EPUB container.xml did not declare an OPF package path")?
        .to_string();
    let opf = read_zip_string(zip, &opf_path)
        .map_err(|e| format!("Failed to read OPF package '{}': {}", opf_path, e))?;
    let opf_doc = roxmltree::Document::parse(&opf)
        .map_err(|e| format!("Failed to parse OPF package '{}': {}", opf_path, e))?;
    let opf_base = Path::new(&opf_path).parent().unwrap_or(Path::new(""));

    let title = text_for_tag(&opf_doc, "title").unwrap_or_else(|| "Unknown".to_string());
    let author = text_for_tag(&opf_doc, "creator").unwrap_or_else(|| "Unknown".to_string());
    let manifest = manifest_items(&opf_doc);
    let nav_titles = nav_titles(zip, opf_base, &manifest).unwrap_or_default();

    let mut sections = Vec::new();
    for (spine_index, itemref) in opf_doc
        .descendants()
        .filter(|n| n.has_tag_name("itemref"))
        .enumerate()
    {
        let Some(idref) = itemref.attribute("idref") else {
            continue;
        };
        let Some(href) = manifest.get(idref) else {
            continue;
        };
        let normalized = join_epub_path(opf_base, href);
        let raw = match read_zip_string(zip, &normalized) {
            Ok(raw) => raw,
            Err(e) => {
                return Err(format!(
                    "Failed to read spine section '{}' at '{}': {}",
                    idref, normalized, e
                ));
            }
        };
        let text = html_to_text(&raw);
        if text.is_empty() {
            continue;
        }
        let title = nav_titles
            .get(href)
            .or_else(|| nav_titles.get(&normalized))
            .cloned()
            .unwrap_or_else(|| idref.to_string());
        sections.push(SearchSection {
            title,
            locator: SearchLocator {
                kind: "chapter".to_string(),
                href: normalized,
                spine_index,
                cfi: None,
            },
            text,
        });
    }

    Ok(EpubExtraction {
        title,
        author,
        sections,
        parser: "zip+xml".to_string(),
        parser_decision: "rbook not accepted yet: this slice needs stable metadata, spine, locator, and plain-text extraction without adding a broad EPUB abstraction; keep rbook as a later candidate.".to_string(),
    })
}

fn manifest_items(doc: &roxmltree::Document<'_>) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for item in doc.descendants().filter(|n| n.has_tag_name("item")) {
        if let (Some(id), Some(href)) = (item.attribute("id"), item.attribute("href")) {
            out.insert(id.to_string(), href.to_string());
        }
    }
    out
}

fn nav_titles<R: Read + Seek>(
    zip: &mut ZipArchive<R>,
    opf_base: &Path,
    manifest: &HashMap<String, String>,
) -> Result<HashMap<String, String>, String> {
    let toc_href = manifest
        .iter()
        .find(|(id, href)| *id == "ncx" || href.ends_with(".ncx"))
        .map(|(_, href)| href.clone());
    let Some(toc_href) = toc_href else {
        return Ok(HashMap::new());
    };
    let toc_path = join_epub_path(opf_base, &toc_href);
    let toc = read_zip_string(zip, &toc_path)?;
    let doc = roxmltree::Document::parse(&toc).map_err(|e| format!("Failed to parse TOC: {}", e))?;
    let mut out = HashMap::new();
    for nav_point in doc.descendants().filter(|n| n.has_tag_name("navPoint")) {
        let title = nav_point
            .descendants()
            .find(|n| n.has_tag_name("text"))
            .and_then(|n| n.text())
            .map(normalize_ws);
        let src = nav_point
            .descendants()
            .find(|n| n.has_tag_name("content"))
            .and_then(|n| n.attribute("src"))
            .map(|src| src.split('#').next().unwrap_or(src).to_string());
        if let (Some(title), Some(src)) = (title, src) {
            out.insert(src.clone(), title.clone());
            out.insert(join_epub_path(opf_base, &src), title);
        }
    }
    Ok(out)
}

fn text_for_tag(doc: &roxmltree::Document<'_>, tag: &str) -> Option<String> {
    doc.descendants()
        .find(|n| n.has_tag_name(tag))
        .and_then(|n| n.text())
        .map(normalize_ws)
        .filter(|s| !s.is_empty())
}

fn read_zip_string<R: Read + Seek>(zip: &mut ZipArchive<R>, path: &str) -> Result<String, String> {
    let mut file = zip.by_name(path).map_err(|e| e.to_string())?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)
        .map_err(|e| e.to_string())?;
    Ok(contents)
}

fn join_epub_path(base: &Path, href: &str) -> String {
    let href = href.split('#').next().unwrap_or(href);
    let path = base.join(href);
    path.components()
        .filter_map(|component| match component {
            std::path::Component::Normal(part) => part.to_str(),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn html_to_text(raw: &str) -> String {
    let without_scripts = Regex::new(r"(?is)<script[^>]*>.*?</script>")
        .unwrap()
        .replace_all(raw, " ");
    let without_scripts = Regex::new(r"(?is)<style[^>]*>.*?</style>")
        .unwrap()
        .replace_all(&without_scripts, " ");
    let with_spaces = Regex::new(r"(?i)<\s*(p|div|br|li|h[1-6])[^>]*>")
        .unwrap()
        .replace_all(&without_scripts, " ");
    let tags_removed = Regex::new(r"(?is)<[^>]+>")
        .unwrap()
        .replace_all(&with_spaces, " ");
    normalize_ws(&html_unescape(&tags_removed))
}

fn html_unescape(input: &str) -> String {
    input
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn normalize_ws(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn file_fingerprint(path: &Path) -> Result<FileFingerprint, String> {
    let metadata = fs::metadata(path).map_err(|e| format!("Failed to stat EPUB: {}", e))?;
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let mut file = File::open(path).map_err(|e| format!("Failed to open EPUB for hash: {}", e))?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    let mut buf = [0u8; 8192];
    loop {
        let read = file
            .read(&mut buf)
            .map_err(|e| format!("Failed to read EPUB for hash: {}", e))?;
        if read == 0 {
            break;
        }
        buf[..read].hash(&mut hasher);
    }
    Ok(FileFingerprint {
        len: metadata.len(),
        modified_ms,
        content_hash: hasher.finish(),
    })
}

fn index_dir(root: &Path, book_id: &str) -> PathBuf {
    root.join("search-indexes").join(safe_book_id(book_id))
}

fn tantivy_dir(index_dir: &Path) -> PathBuf {
    index_dir.join("tantivy")
}

fn metadata_path(index_dir: &Path) -> PathBuf {
    index_dir.join("metadata.json")
}

fn safe_book_id(book_id: &str) -> String {
    let cleaned: String = book_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if cleaned.is_empty() {
        "book".to_string()
    } else {
        cleaned
    }
}

fn read_metadata(index_dir: &Path) -> Option<SearchIndexMetadata> {
    let raw = fs::read_to_string(metadata_path(index_dir)).ok()?;
    let metadata: SearchIndexMetadata = serde_json::from_str(&raw).ok()?;
    if metadata.version == INDEX_VERSION {
        Some(metadata)
    } else {
        None
    }
}

fn write_metadata(index_dir: &Path, metadata: SearchIndexMetadata) -> Result<(), String> {
    fs::create_dir_all(index_dir)
        .map_err(|e| format!("Failed to create Search Index metadata directory: {}", e))?;
    let raw = serde_json::to_string_pretty(&metadata)
        .map_err(|e| format!("Failed to encode Search Index metadata: {}", e))?;
    fs::write(metadata_path(index_dir), raw)
        .map_err(|e| format!("Failed to write Search Index metadata: {}", e))
}

fn pending_metadata() -> SearchIndexMetadata {
    SearchIndexMetadata {
        version: INDEX_VERSION,
        state: SearchIndexState::Pending,
        error: None,
        fingerprint: None,
        indexed_at_ms: None,
    }
}

fn status_from_metadata(metadata: SearchIndexMetadata) -> SearchIndexStatus {
    SearchIndexStatus {
        state: metadata.state,
        error: metadata.error,
        fingerprint: metadata.fingerprint,
        indexed_at_ms: metadata.indexed_at_ms,
    }
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn build_schema() -> SearchSchema {
    let mut builder = Schema::builder();
    let text_indexing = TextFieldIndexing::default()
        .set_tokenizer(JIEBA_TOKENIZER)
        .set_index_option(IndexRecordOption::WithFreqsAndPositions);
    let text_options = TextOptions::default()
        .set_indexing_options(text_indexing)
        .set_stored();
    let section_title = builder.add_text_field("section_title", text_options.clone());
    let href = builder.add_text_field("href", STRING | STORED);
    let spine_index = builder.add_u64_field("spine_index", STORED);
    let cfi = builder.add_text_field("cfi", STRING | STORED);
    let text = builder.add_text_field("text", text_options);
    SearchSchema {
        schema: builder.build(),
        section_title,
        href,
        spine_index,
        cfi,
        text,
    }
}

fn register_tokenizers(index: &Index) {
    index
        .tokenizers()
        .register(JIEBA_TOKENIZER, tantivy_jieba::JiebaTokenizer::new());
}

fn text_value(doc: &TantivyDocument, field: Field) -> String {
    doc.get_first(field)
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string()
}

fn u64_value(doc: &TantivyDocument, field: Field) -> u64 {
    doc.get_first(field).and_then(|v| v.as_u64()).unwrap_or(0)
}

fn excerpt_for_query(text: &str, query: &str) -> String {
    let haystack = text.to_lowercase();
    let needle = query.to_lowercase();
    let idx = haystack.find(&needle).unwrap_or(0);
    let start = text
        .char_indices()
        .map(|(i, _)| i)
        .take_while(|i| *i <= idx)
        .last()
        .unwrap_or(0);
    let radius = 80;
    let left = start.saturating_sub(radius);
    let right = (start + query.len() + radius).min(text.len());
    let mut left = left;
    while left > 0 && !text.is_char_boundary(left) {
        left -= 1;
    }
    let mut right = right;
    while right < text.len() && !text.is_char_boundary(right) {
        right += 1;
    }
    let mut excerpt = text[left..right].trim().to_string();
    if left > 0 {
        excerpt = format!("...{}", excerpt);
    }
    if right < text.len() {
        excerpt.push_str("...");
    }
    excerpt
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use tempfile::tempdir;
    use zip::write::SimpleFileOptions;

    fn make_epub(path: &Path, ch1: &str, ch2: &str) {
        let file = File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        zip.start_file("META-INF/container.xml", options).unwrap();
        zip.write_all(br#"<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>"#).unwrap();
        zip.start_file("OEBPS/content.opf", options).unwrap();
        zip.write_all(br#"<?xml version="1.0"?><package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Fixture Book</dc:title><dc:creator>Fixture Author</dc:creator></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="ch1"/><itemref idref="ch2"/></spine></package>"#).unwrap();
        zip.start_file("OEBPS/toc.ncx", options).unwrap();
        zip.write_all(br#"<ncx><navMap><navPoint><navLabel><text>Opening</text></navLabel><content src="ch1.xhtml"/></navPoint><navPoint><navLabel><text>Mandarin</text></navLabel><content src="ch2.xhtml"/></navPoint></navMap></ncx>"#).unwrap();
        zip.start_file("OEBPS/ch1.xhtml", options).unwrap();
        zip.write_all(format!("<html><body><h1>Opening</h1><p>{}</p></body></html>", ch1).as_bytes()).unwrap();
        zip.start_file("OEBPS/ch2.xhtml", options).unwrap();
        zip.write_all(format!("<html><body><h1>Mandarin</h1><p>{}</p></body></html>", ch2).as_bytes()).unwrap();
        zip.finish().unwrap();
    }

    #[test]
    fn extracts_metadata_spine_titles_locators_and_plain_text() {
        let mut bytes = Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut bytes);
            let options = SimpleFileOptions::default();
            zip.start_file("META-INF/container.xml", options).unwrap();
            zip.write_all(br#"<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>"#).unwrap();
            zip.start_file("OPS/book.opf", options).unwrap();
            zip.write_all(br#"<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Title</dc:title><dc:creator>Author</dc:creator></metadata><manifest><item id="chapter" href="chapter.xhtml"/></manifest><spine><itemref idref="chapter"/></spine></package>"#).unwrap();
            zip.start_file("OPS/chapter.xhtml", options).unwrap();
            zip.write_all(b"<html><body><h1>Hi</h1><p>plain needle text</p></body></html>").unwrap();
            zip.finish().unwrap();
        }
        bytes.set_position(0);
        let mut archive = ZipArchive::new(bytes).unwrap();
        let extracted = extract_epub_from_zip(&mut archive).unwrap();
        assert_eq!(extracted.title, "Title");
        assert_eq!(extracted.author, "Author");
        assert_eq!(extracted.sections[0].locator.href, "OPS/chapter.xhtml");
        assert_eq!(extracted.sections[0].locator.spine_index, 0);
        assert!(extracted.sections[0].text.contains("plain needle text"));
        assert!(extracted.parser_decision.contains("rbook not accepted yet"));
    }

    #[test]
    fn failed_extraction_records_failed_status_without_panicking() {
        let dir = tempdir().unwrap();
        let epub = dir.path().join("broken.epub");
        fs::write(&epub, b"not a zip").unwrap();
        let error = rebuild_index(dir.path(), "book-1", &epub).unwrap_err();
        assert!(error.contains("EPUB archive"));
        let status = get_index_status(dir.path(), "book-1", &epub);
        assert_eq!(status.state, SearchIndexState::Failed);
        assert!(status.error.unwrap().contains("EPUB archive"));
    }

    #[test]
    fn searches_english_and_chinese_with_same_locator_contract() {
        let dir = tempdir().unwrap();
        let epub = dir.path().join("book.epub");
        make_epub(
            &epub,
            "The hidden needle appears in the opening.",
            "机器学习让搜索结果更有用。",
        );
        let status = rebuild_index(dir.path(), "book-1", &epub).unwrap();
        assert_eq!(status.state, SearchIndexState::Ready);

        let english = search_index(dir.path(), "book-1", &epub, "needle").unwrap();
        assert_eq!(english[0].section_title, "Opening");
        assert_eq!(english[0].locator.href, "OEBPS/ch1.xhtml");
        assert_eq!(english[0].locator.kind, "chapter");

        let chinese = search_index(dir.path(), "book-1", &epub, "机器学习").unwrap();
        assert_eq!(chinese[0].section_title, "Mandarin");
        assert!(chinese[0].excerpt.contains("机器学习"));
    }

    #[test]
    fn detects_stale_index_and_rebuilds_to_ready() {
        let dir = tempdir().unwrap();
        let epub = dir.path().join("book.epub");
        make_epub(&epub, "first needle", "中文 搜索");
        rebuild_index(dir.path(), "book-1", &epub).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        make_epub(&epub, "changed needle", "中文 搜索");
        assert_eq!(
            get_index_status(dir.path(), "book-1", &epub).state,
            SearchIndexState::Stale
        );
        let status = rebuild_index(dir.path(), "book-1", &epub).unwrap();
        assert_eq!(status.state, SearchIndexState::Ready);
    }
}
