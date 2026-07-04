import type { AIProviderStatus } from '../types';

/**
 * AI Reading Console readiness and overview logic.
 *
 * Pure: given a snapshot of local configuration state, derive the per-area and
 * overall readiness for the Console Overview. The console must NOT call any AI
 * provider; readiness reflects local configuration only.
 *
 * See `CONTEXT.md` terms `AI Reading Console`, `Console Overview`,
 * `Console Readiness`, `AI Service Settings`, `Conversation Behavior Settings`,
 * and ADR 0013.
 */

export type ConsoleReadiness = 'ready' | 'degraded' | 'missing';

export type ConsoleAreaId =
  | 'overview'
  | 'ai-service'
  | 'conversation'
  | 'reading-memory'
  | 'quick-prompts';

export type ConsoleReadinessInput = {
  providers: AIProviderStatus[];
  readingMemoryPath?: string;
  readingMemoryAutoIngest: boolean;
  aiContextWindow: 5 | 20 | 40;
  aiAutoSummarize: boolean;
  quickPromptCount: number;
};

export type AreaStatus = {
  area: Exclude<ConsoleAreaId, 'overview'>;
  readiness: ConsoleReadiness;
  /** Short headline shown on the Overview status row. */
  title: string;
  /** One-line supporting detail (current value or what is missing). */
  detail: string;
  /** CTA label that navigates the reader to this console area. */
  actionLabel: string;
};

export type SideNavBadge = {
  area: Exclude<ConsoleAreaId, 'overview'>;
  variant: 'warning' | 'error';
};

export type ConsoleArea = {
  id: ConsoleAreaId;
  label: string;
};

/**
 * The five top-level console areas, overview first. Order is the side-nav
 * order and the Overview status-row order is derived from the readiness
 * computation (see `computeAreaStatuses`).
 */
export const CONSOLE_AREAS: readonly ConsoleArea[] = [
  { id: 'overview', label: '概览' },
  { id: 'ai-service', label: 'AI 服务' },
  { id: 'conversation', label: '对话行为' },
  { id: 'reading-memory', label: '阅读记忆' },
  { id: 'quick-prompts', label: '快捷提示词' },
] as const;

/**
 * Resolve the provider candidate to display in the console header/Overview:
 * the active provider, else the first configured provider (a setup hint),
 * else null. Pure.
 */
export function resolveProviderCandidate(
  providers: AIProviderStatus[],
): AIProviderStatus | null {
  return providers.find((p) => p.active) ?? providers[0] ?? null;
}

function aiServiceStatus(input: ConsoleReadinessInput): AreaStatus {
  const active = input.providers.find((p) => p.active) ?? null;
  const candidate = active ?? input.providers[0] ?? null;

  // No provider configured at all → the conversation cannot run.
  if (!candidate) {
    return {
      area: 'ai-service',
      readiness: 'missing',
      title: '尚未配置 AI 服务',
      detail: '添加一个 OpenAI 兼容服务后即可使用 AI 对话。',
      actionLabel: '添加 AI 服务',
    };
  }

  // An active provider with a key is the only "ready" state.
  if (active && active.hasKey) {
    return {
      area: 'ai-service',
      readiness: 'ready',
      title: `${active.name} 已就绪`,
      detail: `${active.model} · Key 已设置`,
      actionLabel: '管理 AI 服务',
    };
  }

  // Providers exist, but the runtime cannot serve chat yet: either no provider
  // is active, or the active one has no key. Degrade rather than mark missing
  // so the Overview still routes the reader to enable/fix it.
  if (!active) {
    return {
      area: 'ai-service',
      readiness: 'degraded',
      title: '未启用 AI 服务',
      detail: candidate.hasKey
        ? `${candidate.name} 已配置 Key，但尚未启用。`
        : `${candidate.name} 缺少 Key，启用前请先设置。`,
      actionLabel: '启用 AI 服务',
    };
  }

  // active provider present but missing key
  return {
    area: 'ai-service',
    readiness: 'missing',
    title: `${active.name} 缺少 Key`,
    detail: `${active.model} 已启用，但未设置 API Key。`,
    actionLabel: '设置 API Key',
  };
}

function conversationStatus(input: ConsoleReadinessInput): AreaStatus {
  // Conversation Behavior is purely local preferences. It is always ready;
  // the Overview row reports the current context window + summarization so
  // the reader can adjust if they want different runtime behavior.
  const summary = input.aiAutoSummarize ? '已开启自动压缩' : '已关闭自动压缩';
  return {
    area: 'conversation',
    readiness: 'ready',
    title: '对话行为已配置',
    detail: `上下文 ${input.aiContextWindow} 条 · ${summary}`,
    actionLabel: '调整对话行为',
  };
}

function readingMemoryStatus(input: ConsoleReadinessInput): AreaStatus {
  if (!input.readingMemoryPath) {
    return {
      area: 'reading-memory',
      readiness: 'missing',
      title: '未选择阅读记忆仓库',
      detail: '选择本地 Markdown 仓库后，AI 才能写入值得保留的笔记。',
      actionLabel: '选择仓库',
    };
  }

  if (!input.readingMemoryAutoIngest) {
    return {
      area: 'reading-memory',
      readiness: 'degraded',
      title: '已连接，未自动沉淀',
      detail: '仓库已就绪，但自动沉淀已关闭，AI 不会主动写入。',
      actionLabel: '开启自动沉淀',
    };
  }

  return {
    area: 'reading-memory',
    readiness: 'ready',
    title: '阅读记忆已就绪',
    detail: '自动沉淀已开启',
    actionLabel: '管理阅读记忆',
  };
}

function quickPromptsStatus(input: ConsoleReadinessInput): AreaStatus {
  if (input.quickPromptCount <= 0) {
    return {
      area: 'quick-prompts',
      readiness: 'degraded',
      title: '没有可用的快捷提示词',
      detail: 'AI 面板底部按钮为空，恢复默认或新增提示词以加快常用操作。',
      actionLabel: '恢复默认提示词',
    };
  }

  return {
    area: 'quick-prompts',
    readiness: 'ready',
    title: '快捷提示词已就绪',
    detail: `共 ${input.quickPromptCount} 个按钮可用`,
    actionLabel: '管理提示词',
  };
}

/**
 * Compute the per-area status rows shown on the Console Overview. Order is the
 * canonical status-row order: AI Service, Conversation Behavior, Reading
 * Memory, Quick Prompts.
 */
export function computeAreaStatuses(input: ConsoleReadinessInput): AreaStatus[] {
  return [
    aiServiceStatus(input),
    conversationStatus(input),
    readingMemoryStatus(input),
    quickPromptsStatus(input),
  ];
}

const READINESS_RANK: Record<ConsoleReadiness, number> = {
  ready: 0,
  degraded: 1,
  missing: 2,
};

/**
 * Compute the overall Console Readiness from the per-area statuses.
 *
 * The reading conversation can only run when AI Service is configured with an
 * active, keyed provider, so an AI Service `missing` state is the only thing
 * that makes the whole console `missing` (the conversation cannot run at all).
 * A `missing` state in any other area (e.g. Reading Memory repository not
 * chosen, Quick Prompts empty) only downgrades the console to `degraded`: the
 * conversation can still run, but an adjacent capability is unavailable.
 */
export function computeOverallReadiness(statuses: AreaStatus[]): ConsoleReadiness {
  if (statuses.length === 0) return 'ready';
  const aiService = statuses.find((s) => s.area === 'ai-service');
  if (aiService?.readiness === 'missing') return 'missing';
  const worst = statuses.reduce<ConsoleReadiness>((acc, s) => {
    // Only AI Service can drive the overall console to `missing`; a missing
    // adjacent capability is treated as `degraded` at the console level.
    const effective: ConsoleReadiness =
      s.area !== 'ai-service' && s.readiness === 'missing' ? 'degraded' : s.readiness;
    return READINESS_RANK[effective] > READINESS_RANK[acc] ? effective : acc;
  }, statuses[0].readiness);
  return worst;
}

/**
 * Compute the side-nav attention badges. Only abnormal *action-required*
 * states get a badge: AI Service missing provider/key, Reading Memory missing
 * repository, Quick Prompts empty. Degraded states that are intentional
 * preferences (e.g. auto-ingest off) do NOT get a side-nav badge — they are
 * surfaced on the Overview instead.
 */
export function computeSideNavBadges(statuses: AreaStatus[]): SideNavBadge[] {
  const badges: SideNavBadge[] = [];
  for (const status of statuses) {
    // Side-nav badges surface only action-required abnormal states:
    //   AI Service missing key/provider, Reading Memory missing repository,
    //   Quick Prompts empty (degraded). Degraded Reading Memory (auto-ingest
    //   off) is an intentional preference and is surfaced only on Overview.
    const isQuickPromptsEmpty = status.area === 'quick-prompts' && status.readiness === 'degraded';
    if (status.readiness !== 'missing' && !isQuickPromptsEmpty) continue;
    badges.push({
      area: status.area,
      variant: status.readiness === 'missing' ? 'error' : 'warning',
    });
  }
  return badges;
}
