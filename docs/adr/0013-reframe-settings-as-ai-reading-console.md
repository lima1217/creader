# Reframe Settings as an AI Reading Console

Superseded by: [0016 Focus AI Settings on Three Tabs](0016-focus-ai-settings-on-three-tabs.md)

CReader's settings surface is not a traditional preferences form; it is the runtime control surface for AI-assisted reading. The settings module will be redesigned as an **AI Reading Console** that opens first to an actionable overview of AI readiness, Reading Memory state, conversation behavior, and quick-prompt availability.

The console uses five top-level areas: Overview, AI Service, Conversation Behavior, Reading Memory, and Quick Prompts. This deliberately separates provider/model/key configuration from conversation behavior such as context window size, hidden summarization, and AI panel text size.

The console should be a wider modal control surface, roughly 840px on desktop, with navigation and current-state cues on the side and editable content on the main panel. It remains a modal rather than a standalone page because changing AI reading runtime state is a temporary detour from the book, not a destination that should replace the reading workspace.

The overview is actionable: each degraded or missing setup state links to the place that can fix it. Readiness is based on local configuration only and has three levels: ready, degraded, and missing setup. Opening the console must not automatically call an AI provider; connection testing is an explicit AI Service action.

AI Service editing uses an isolated add/edit state instead of expanding forms inline inside the provider list. Connection test results are session-only UI feedback and are not persisted as provider health.

Reading Memory settings prioritize write strategy and repository state over raw path editing. Users can disconnect a repository by clearing the configured path; this never deletes local Markdown files.

Quick Prompts are managed as AI panel shortcut buttons. The first implementation supports enable/hide, restore defaults, edit, create, and ordering via move up/down controls rather than drag-and-drop.
