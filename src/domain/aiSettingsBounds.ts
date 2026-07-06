/** AI panel text size (px). */
export const AI_TEXT_SIZE_MIN = 13;
export const AI_TEXT_SIZE_MAX = 20;

/** Recent chat messages included in each AI request. */
export const AI_CONTEXT_WINDOW_MIN = 1;
export const AI_CONTEXT_WINDOW_MAX = 100;

/** Tool-call loop limit; bounds align with src-tauri/src/ai.rs. */
export const AI_TOOL_ROUNDS_MIN = 2;
export const AI_TOOL_ROUNDS_MAX = 24;

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function clampAITextSize(size: number): number {
  return clampInteger(size, AI_TEXT_SIZE_MIN, AI_TEXT_SIZE_MAX);
}

export function clampAIContextWindow(rounds: number): number {
  return clampInteger(rounds, AI_CONTEXT_WINDOW_MIN, AI_CONTEXT_WINDOW_MAX);
}

export function clampAIToolRounds(rounds: number): number {
  return clampInteger(rounds, AI_TOOL_ROUNDS_MIN, AI_TOOL_ROUNDS_MAX);
}
