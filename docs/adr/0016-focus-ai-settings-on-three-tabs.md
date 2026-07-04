# Focus AI Settings on Three Tabs

Supersedes: [0013 Reframe Settings as an AI Reading Console](0013-reframe-settings-as-ai-reading-console.md)

CReader's AI settings surface should be a quiet modal settings dialog, not an operational console. The modal title is **AI 设置** and the top-level navigation is a horizontal Astryx `TabList` with three tabs: `AI`, `阅读记忆`, and `快捷提示词`.

The `AI` tab combines OpenAI-compatible provider management and conversation behavior settings because both answer how the reading conversation runs. Provider connection tests remain explicit per-provider actions. Opening settings may read local provider metadata, but must not call chat, stream, connection-test, or provider health commands.

The old overview/readiness model is removed. The only blocking setup state for reading conversation is the absence of an active provider with a stored key. That state is represented by a small attention dot on the `AI` tab. There is no positive ready marker and adjacent capabilities such as Reading Memory and Quick Prompts do not mark the settings surface as degraded.

Reading Memory remains a user-selected OKF-compatible Markdown repository. Disconnecting it clears only the configured path and never deletes local Markdown files. Auto-ingest preference is preserved.

Quick Prompts remain AI panel shortcut buttons. Their settings tab keeps list editing, creation, hiding, ordering, restoring defaults, and the rule that the first six prompts render directly in the AI panel while overflow goes into the more menu.
