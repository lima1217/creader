# Save Reading Memory

Use this skill when deciding whether an assistant turn should become a durable Reading Memory note and when rendering the note content.

## Ingestion Decision

Save only when the turn is durable, source-grounded, and useful outside the chat.

Save when:

- the user explicitly asks to save, remember, record, or add to Reading Memory;
- the answer creates a reusable source-grounded insight;
- the turn captures a concept, claim, question, or book note worth revisiting.

Skip when:

- the turn is an ordinary summary, translation, or explanation;
- the user is asking about the assistant, settings, or workflow;
- the assistant is coaching the reader without a durable book note;
- the new answer repeats earlier content;
- source context is missing or too weak.

## Note Requirements

Each saved note should preserve:

- book title and author when available;
- chapter or section;
- reading progress;
- CFI range when available;
- selected text or user question;
- assistant answer;
- ingestion reason and confidence.

## Path Boundary

Current-book notes belong in the sanitized book sub-package under `books/<book-slug>/...`. Rust owns repository path validation, target directory restriction, file writes, and ingestion logging. Behavior files and evals must not grant the AI arbitrary file paths.

## Good Outcome

The Reading Memory repository grows only with durable, source-grounded notes, while ordinary chat remains in chat.
