# Focus AI Settings on Three Tabs

Supersedes: [0013 Reframe Settings as an AI Reading Console](0013-reframe-settings-as-ai-reading-console.md)

CReader's AI settings surface should be a quiet modal settings dialog, not an operational console. The top-level navigation is a horizontal Astryx `TabList` with three tabs: `AI 设置`, `阅读记忆`, and `快捷提示词`. The dialog does not repeat an `AI 设置` title above the tab row; the close control stays visible at the top.

The `AI 设置` tab combines OpenAI-compatible provider management and conversation behavior settings because both answer how the reading conversation runs. Provider connection tests remain explicit per-provider actions. Opening settings may read local provider metadata, but must not call chat, stream, connection-test, or provider health commands.

The old overview/readiness model is removed. The only blocking setup state for reading conversation is the absence of an active provider with a stored key. That state is represented by a small attention dot on the `AI 设置` tab. There is no positive ready marker and adjacent capabilities such as Reading Memory and Quick Prompts do not mark the settings surface as degraded.

Reading Memory remains a user-selected OKF-compatible Markdown repository. Connected repositories can be opened or replaced from settings; there is no disconnect action in the UI. Auto-ingest preference is preserved.

Quick Prompts remain AI panel shortcut buttons. Their settings tab keeps list editing, creation, hiding, ordering, restoring defaults, and the rule that the first six prompts render directly in the AI panel while overflow goes into the more menu.
