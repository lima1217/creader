import { describe, expect, it } from 'vitest';
import {
  AI_CONTEXT_WINDOW_MAX,
  AI_CONTEXT_WINDOW_MIN,
  AI_TEXT_SIZE_MAX,
  AI_TEXT_SIZE_MIN,
  AI_TOOL_ROUNDS_MAX,
  AI_TOOL_ROUNDS_MIN,
  clampAIContextWindow,
  clampAITextSize,
  clampAIToolRounds,
} from './aiSettingsBounds';

describe('aiSettingsBounds', () => {
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

  describe('clampAIContextWindow', () => {
    it('clamps below the minimum to the minimum', () => {
      expect(clampAIContextWindow(0)).toBe(AI_CONTEXT_WINDOW_MIN);
    });

    it('clamps above the maximum to the maximum', () => {
      expect(clampAIContextWindow(200)).toBe(AI_CONTEXT_WINDOW_MAX);
    });

    it('passes through in-range values unchanged', () => {
      expect(clampAIContextWindow(37)).toBe(37);
    });
  });

  describe('clampAIToolRounds', () => {
    it('clamps below the minimum to the minimum', () => {
      expect(clampAIToolRounds(1)).toBe(AI_TOOL_ROUNDS_MIN);
    });

    it('clamps above the maximum to the maximum', () => {
      expect(clampAIToolRounds(99)).toBe(AI_TOOL_ROUNDS_MAX);
    });

    it('passes through in-range values unchanged', () => {
      expect(clampAIToolRounds(10)).toBe(10);
    });

    // Contract with src-tauri/src/ai.rs: MIN_MAX_TOOL_ROUNDS, HARD_MAX_TOOL_ROUNDS.
    it('matches Rust tool-round bounds', () => {
      expect(AI_TOOL_ROUNDS_MIN).toBe(2);
      expect(AI_TOOL_ROUNDS_MAX).toBe(24);
    });
  });
});
