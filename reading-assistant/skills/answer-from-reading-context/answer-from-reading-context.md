# Answer From Reading Context

Use this branch when there is no active selection or the user asks about the current chapter context. Leading word: **scoped answer**.

## Steps

1. Treat the frozen Reading Context Snapshot as the evidence for the turn.
2. Select the chapter details that answer the current user question.
3. Answer at chapter scope unless whole-book evidence is present in the input.
4. Use recent chat and Conversation Memory only to preserve continuity.
5. Name missing evidence before any broader inference.

Done means the answer does not pretend to know material outside the provided context.

## Request Contract

The frontend request builder sends prompt, selected or focused context, chapter context, hidden conversation summary, and recent history. It must not send provider or model fields. The backend resolves the active AI Provider from local app configuration.

## Completion Criteria

- The answer is scoped to the current reading location.
- Hidden summaries and recent chat are continuity, not source evidence.
- Any whole-book or author-intent claim is either supported by provided context or explicitly withheld.
