# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

This is a single-context repo:

- `CONTEXT.md` at the repo root, when present, contains the shared project glossary and domain language.
- `docs/adr/`, when present, contains architectural decision records for the whole app.

There is no `CONTEXT-MAP.md` unless the repo is later split into multiple independent contexts.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root.
- **`docs/adr/`** ADRs that touch the area you're about to work in.
- **`AGENTS.md`** for current repo boundaries, hotspots, verification commands, AI Panel rules, Reading Memory rules, and Astryx UI rules.

If any of these files don't exist, proceed silently. Don't flag their absence or suggest creating them upfront. The domain-modeling flow can create them lazily when terms or decisions actually get resolved.

## File structure

```text
/
|-- AGENTS.md
|-- CONTEXT.md
|-- docs/
|   |-- agents/
|   |-- adr/
|   |   |-- 0001-example-decision.md
|-- src/
|-- src-tauri/
```

## Use the glossary's vocabulary

When your output names a domain concept in an issue title, refactor proposal, hypothesis, or test name, use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use, or there's a real gap to note for domain modeling.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding it.
