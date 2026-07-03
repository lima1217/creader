# Answer From Reading Context

Use this skill when there is no active selection or when the user's question is about the visible chapter context.

## Behavior

1. Treat the frozen Reading Context Snapshot as the evidence for the turn.
2. Use the current user question to choose the relevant parts of the chapter context.
3. Prefer a scoped answer over a whole-book answer when whole-book evidence is unavailable.
4. Name uncertainty when the chapter context is too thin.
5. Keep recent chat and Conversation Memory as continuity only.

## Request Contract

The frontend request builder should send prompt, selected or focused context, chapter context, hidden conversation summary, and recent history. It must not send provider or model fields. The backend resolves the active AI Provider from local app configuration.

## Good Outcome

The answer is helpful for the reader's current location without pretending to know the full book.
