import { describe, expect, it } from 'vitest';
import type { AIProviderConfig } from '../types';
import type { QuickActionConfig } from './ai/quickActions';
import { defaultQuickActions } from './ai/quickActions';
import {
  AI_TEXT_SIZE_MAX,
  AI_TEXT_SIZE_MIN,
  addQuickAction,
  applyProviderTemplate,
  clampAITextSize,
  commitQuickActionDraft,
  createCustomQuickAction,
  hideQuickAction,
  resetQuickActions,
  restoreQuickAction,
  validateProviderDraft,
} from './settingsPanelLogic';

function createDraft(overrides: Partial<AIProviderConfig> = {}): AIProviderConfig {
  return { id: 'prov_1', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', ...overrides };
}

function createAction(overrides: Partial<QuickActionConfig> = {}): QuickActionConfig {
  return { id: 'explain', label: '解释', prompt: '解释选中的内容。', icon: 'explain', ...overrides };
}

describe('settingsPanelLogic', () => {
  describe('clampAITextSize', () => {
    it('clamps below the minimum to the minimum', () => {
      expect(clampAITextSize(10)).toBe(AI_TEXT_SIZE_MIN);
    });

    it('clamps above the maximum to the maximum', () => {
      expect(clampAITextSize(30)).toBe(AI_TEXT_SIZE_MAX);
    });

    it('passes through in-range values unchanged', () => {
      expect(clampAITextSize(16)).toBe(16);
    });
  });

  describe('validateProviderDraft', () => {
    it('returns null for a complete draft', () => {
      expect(validateProviderDraft(createDraft())).toBeNull();
    });

    it('returns an error when name is blank', () => {
      expect(validateProviderDraft(createDraft({ name: '   ' }))).not.toBeNull();
    });

    it('returns an error when baseUrl is empty', () => {
      expect(validateProviderDraft(createDraft({ baseUrl: '' }))).not.toBeNull();
    });

    it('returns an error when model is empty', () => {
      expect(validateProviderDraft(createDraft({ model: '' }))).not.toBeNull();
    });
  });

  describe('applyProviderTemplate', () => {
    const template = { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' };

    it('returns null when the draft is null', () => {
      expect(applyProviderTemplate(null, template)).toBeNull();
    });

    it('fills the template name when the draft name is blank', () => {
      const result = applyProviderTemplate(createDraft({ name: '  ' }), template);
      expect(result?.name).toBe('OpenAI');
      expect(result?.baseUrl).toBe(template.baseUrl);
      expect(result?.model).toBe(template.model);
    });

    it('keeps a user-entered name and only fills url + model', () => {
      const result = applyProviderTemplate(createDraft({ name: 'My Provider' }), template);
      expect(result?.name).toBe('My Provider');
      expect(result?.baseUrl).toBe(template.baseUrl);
      expect(result?.model).toBe(template.model);
    });

    it('does not mutate the original draft', () => {
      const draft = createDraft({ name: '' });
      applyProviderTemplate(draft, template);
      expect(draft.name).toBe('');
    });
  });

  describe('commitQuickActionDraft', () => {
    it('returns null when no action is selected', () => {
      expect(commitQuickActionDraft(defaultQuickActions, null, { label: 'x', prompt: 'y' })).toBeNull();
    });

    it('returns null when the draft label or prompt is blank', () => {
      expect(commitQuickActionDraft(defaultQuickActions, 'explain', { label: '', prompt: 'y' })).toBeNull();
      expect(commitQuickActionDraft(defaultQuickActions, 'explain', { label: 'x', prompt: '  ' })).toBeNull();
    });

    it('returns a new list with the edited action updated', () => {
      const result = commitQuickActionDraft(defaultQuickActions, 'explain', {
        label: ' New Label ',
        prompt: ' new prompt ',
      });
      expect(result).not.toBeNull();
      const edited = result!.find((a) => a.id === 'explain');
      expect(edited?.label).toBe('New Label');
      expect(edited?.prompt).toBe('new prompt');
    });

    it('leaves other actions untouched', () => {
      const result = commitQuickActionDraft(defaultQuickActions, 'explain', {
        label: 'New',
        prompt: 'prompt',
      });
      const untouched = result!.find((a) => a.id === 'translate');
      expect(untouched).toEqual(defaultQuickActions.find((a) => a.id === 'translate'));
    });
  });

  describe('hideQuickAction', () => {
    it('removes the action and falls back to the first remaining action when it was selected', () => {
      const list = [createAction({ id: 'a' }), createAction({ id: 'b' }), createAction({ id: 'c' })];
      const { actions, nextEditingId } = hideQuickAction(list, 'a', 'a');
      expect(actions.map((a) => a.id)).toEqual(['b', 'c']);
      expect(nextEditingId).toBe('b');
    });

    it('keeps the current editing id when a different action is hidden', () => {
      const list = [createAction({ id: 'a' }), createAction({ id: 'b' })];
      const { actions, nextEditingId } = hideQuickAction(list, 'b', 'a');
      expect(actions.map((a) => a.id)).toEqual(['a']);
      expect(nextEditingId).toBe('a');
    });

    it('returns null editing id when the list becomes empty', () => {
      const list = [createAction({ id: 'a' })];
      const { actions, nextEditingId } = hideQuickAction(list, 'a', 'a');
      expect(actions).toEqual([]);
      expect(nextEditingId).toBeNull();
    });
  });

  describe('createCustomQuickAction', () => {
    it('builds an action with a deterministic timestamp-based id and defaults', () => {
      const action = createCustomQuickAction(1000);
      expect(action.id).toBe('custom-1000');
      expect(action.label).toBe('新提示词');
      expect(action.prompt).toBe('请根据当前上下文回答：');
      expect(action.icon).toBe('explain');
    });
  });

  describe('addQuickAction / restoreQuickAction', () => {
    it('appends the action and selects it for editing', () => {
      const existing = [createAction({ id: 'a' })];
      const fresh = createAction({ id: 'b' });
      const { actions, editingId } = addQuickAction(existing, fresh);
      expect(actions.map((a) => a.id)).toEqual(['a', 'b']);
      expect(editingId).toBe('b');
    });

    it('restoreQuickAction appends and selects without mutating the input', () => {
      const existing = [createAction({ id: 'a' })];
      const restored = createAction({ id: 'b' });
      const { actions, editingId } = restoreQuickAction(existing, restored);
      expect(actions.map((a) => a.id)).toEqual(['a', 'b']);
      expect(editingId).toBe('b');
      expect(existing.map((a) => a.id)).toEqual(['a']);
    });
  });

  describe('resetQuickActions', () => {
    it('returns the default list with the first action selected', () => {
      const { actions, editingId } = resetQuickActions();
      expect(actions).toEqual(defaultQuickActions);
      expect(editingId).toBe(defaultQuickActions[0]?.id ?? null);
    });
  });
});
