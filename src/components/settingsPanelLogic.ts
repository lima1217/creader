import type { AIProviderConfig } from '../types';
import {
  defaultQuickActions,
  getMissingDefaultQuickActions,
} from './ai/quickActions';
import type { QuickActionConfig } from './ai/quickActions';

// AI text-size clamp bounds (matches the historical inline clamp in SettingsPanel).
export const AI_TEXT_SIZE_MIN = 13;
export const AI_TEXT_SIZE_MAX = 20;

/**
 * Clamp an AI text-size value to the allowed range. Pure: input -> output.
 */
export function clampAITextSize(size: number): number {
  return Math.min(AI_TEXT_SIZE_MAX, Math.max(AI_TEXT_SIZE_MIN, size));
}

/**
 * Validate a provider draft before saving. Returns an error message string
 * when the draft is incomplete, or `null` when it is valid. Pure.
 */
export function validateProviderDraft(draft: AIProviderConfig): string | null {
  if (!draft.name.trim() || !draft.baseUrl.trim() || !draft.model.trim()) {
    return '名称、地址和模型都需要填写。';
  }
  return null;
}

/**
 * Apply a quick-fill template to a provider draft. Keeps a user-entered name
 * if present, otherwise fills the template name; always fills baseUrl + model.
 * Returns a new draft object (pure). Returns the draft unchanged when null.
 */
export function applyProviderTemplate(
  draft: AIProviderConfig | null,
  template: { name: string; baseUrl: string; model: string },
): AIProviderConfig | null {
  if (!draft) return draft;
  return {
    ...draft,
    name: draft.name.trim() || template.name,
    baseUrl: template.baseUrl,
    model: template.model,
  };
}

/**
 * Save the in-progress quick-action draft back into the list. Pure: returns a
 * new array, or `null` when the draft is empty (caller decides whether to
 * persist).
 */
export function commitQuickActionDraft(
  actions: QuickActionConfig[],
  editingActionId: string | null,
  draft: { label: string; prompt: string },
): QuickActionConfig[] | null {
  if (!editingActionId) return null;
  const label = draft.label.trim();
  const prompt = draft.prompt.trim();
  if (!label || !prompt) return null;
  return actions.map((action) =>
    action.id === editingActionId ? { ...action, label, prompt } : action,
  );
}

/**
 * Hide a quick action by id. Returns the filtered list and the next editing id
 * (falls back to the first remaining action). Pure.
 */
export function hideQuickAction(
  actions: QuickActionConfig[],
  actionId: string,
  currentEditingId: string | null,
): { actions: QuickActionConfig[]; nextEditingId: string | null } {
  const nextActions = actions.filter((action) => action.id !== actionId);
  const nextEditingId =
    currentEditingId === actionId ? nextActions[0]?.id ?? null : currentEditingId;
  return { actions: nextActions, nextEditingId };
}

/**
 * Create a fresh custom quick action with default label/prompt. Pure factory.
 */
export function createCustomQuickAction(now: number = Date.now()): QuickActionConfig {
  return {
    id: `custom-${now}`,
    label: '新提示词',
    prompt: '请根据当前上下文回答：',
    icon: 'explain',
  };
}

/**
 * Append an action to the list and select it for editing. Pure.
 */
export function addQuickAction(
  actions: QuickActionConfig[],
  action: QuickActionConfig,
): { actions: QuickActionConfig[]; editingId: string } {
  return { actions: [...actions, action], editingId: action.id };
}

/**
 * Restore a previously hidden default action by appending it and selecting it.
 * Pure.
 */
export function restoreQuickAction(
  actions: QuickActionConfig[],
  action: QuickActionConfig,
): { actions: QuickActionConfig[]; editingId: string } {
  return { actions: [...actions, action], editingId: action.id };
}

/**
 * Reset the quick-action list back to defaults. Pure (re-exported shape so the
 * panel can treat all quick-action mutations uniformly).
 */
export function resetQuickActions(): { actions: QuickActionConfig[]; editingId: string | null } {
  return { actions: defaultQuickActions, editingId: defaultQuickActions[0]?.id ?? null };
}

export {
  defaultQuickActions,
  getMissingDefaultQuickActions,
};
