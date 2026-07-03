# Save Reading Memory

Use this branch when deciding whether an assistant turn should become a durable Reading Memory note. Leading word: **durable**.

## Steps

1. Check for source evidence: book title plus selected text, chapter context, or a source-grounded user question.
2. Check for a save trigger: explicit save request, reusable passage insight, concept, claim, question, or chapter note.
3. Check skip rules: ordinary summary, translation, explanation, meta prompt, coaching exchange, short follow-up, repeated explanation, or weak source context.
4. If saving, choose the narrowest target type: `book`, `concept`, `question`, or `claim`.
5. Preserve source metadata and the ingestion reason.

Done means the decision can be explained by one save trigger or one skip rule.

## Note Requirements

Each saved note must preserve:

- book title;
- author when available;
- chapter or section;
- reading progress;
- CFI range when available;
- selected text or user question;
- assistant answer;
- ingestion reason and confidence.

## Path Boundary

Current-book notes belong in the sanitized book sub-package under `books/<book-slug>/...`. Rust owns repository path validation, target directory restriction, file writes, and ingestion logging. Behavior files and evals must not grant the AI arbitrary file paths.

## Completion Criteria

- `should_ingest=true` only for durable, source-grounded turns.
- Ordinary chat remains in chat.
- Saved notes have enough source metadata to audit the original reading context.
