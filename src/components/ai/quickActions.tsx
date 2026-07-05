import { loadStored, saveStored, STORAGE_KEYS } from '../../services/LocalStore';

export type QuickActionConfig = {
  id: string;
  label: string;
  prompt: string;
};

export const QUICK_ACTIONS_CHANGED_EVENT = 'creader:quick-actions-changed';

export const defaultQuickActions: QuickActionConfig[] = [
  {
    id: 'explain',
    label: '解释',
    prompt: `解释选中的内容。先用自然语言说清核心意思，再说明它如何成立，并给一个贴切例子。指出必要前提和适用边界；没有依据的部分明确标为推断。`,
  },
  {
    id: 'deconstruct',
    label: '拆解',
    prompt: `拆解选中的内容：提取核心命题，检查前提、证据与推理，指出适用边界、遗漏背景和有力反例。只分析实际存在的维度，最后给出综合判断。`,
  },
  {
    id: 'inference',
    label: '推演',
    prompt: `从选中的内容继续推演。先提取核心命题；若确有不同走向，分别写明前提、推理和结论，再指出决定分歧的关键信息。最后给出当前证据下最可信的综合判断。`,
  },
  {
    id: 'translate',
    label: '翻译',
    prompt: `把选中的内容完整翻译成简体中文，保持原意、语气、段落结构和术语一致。默认只输出译文；只有歧义会影响理解时，才在末尾添加一条简短译注。`,
  }
];

function isQuickActionConfig(value: unknown): value is QuickActionConfig {
  if (!value || typeof value !== 'object') return false;
  const action = value as Partial<QuickActionConfig>;
  return (
    typeof action.id === 'string' &&
    typeof action.label === 'string' &&
    typeof action.prompt === 'string'
  );
}

export function normalizeQuickActions(value: unknown): QuickActionConfig[] {
  if (!Array.isArray(value)) return defaultQuickActions;

  return value
    .filter(isQuickActionConfig)
    .map(action => ({
      id: action.id,
      label: action.label.trim(),
      prompt: action.prompt.trim(),
    }))
    .filter(action => action.id && action.label && action.prompt);
}

export function loadQuickActionConfigs(): QuickActionConfig[] {
  const stored = loadStored<unknown>(STORAGE_KEYS.quickActions, defaultQuickActions);
  return normalizeQuickActions(stored);
}

export function saveQuickActionConfigs(actions: QuickActionConfig[]): void {
  saveStored(STORAGE_KEYS.quickActions, normalizeQuickActions(actions));
  window.dispatchEvent(new CustomEvent(QUICK_ACTIONS_CHANGED_EVENT));
}

export function getMissingDefaultQuickActions(actions: QuickActionConfig[]): QuickActionConfig[] {
  const actionIds = new Set(actions.map(action => action.id));
  return defaultQuickActions.filter(action => !actionIds.has(action.id));
}
