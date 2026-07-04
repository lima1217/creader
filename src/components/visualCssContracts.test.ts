import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentsDir = join(process.cwd(), 'src/components');
const aiPanelCss = readFileSync(join(componentsDir, 'AIPanel.css'), 'utf8');
const settingsPanelCss = readFileSync(join(componentsDir, 'SettingsPanel.css'), 'utf8');

describe('visual CSS contracts', () => {
  it('centers the first line inside the AI composer shell', () => {
    expect(aiPanelCss).toContain('.ai-composer-input [aria-hidden="true"],');
    expect(aiPanelCss).toContain('min-height: 38px;');
    expect(aiPanelCss).toContain('padding: 8px 10px;');
    expect(aiPanelCss).toContain('line-height: 22px;');
  });

  it('renders SettingsPanel as a focused three-tab AI settings dialog', () => {
    expect(settingsPanelCss).toContain('width: min(calc(var(--spacing-9) * 20), calc(100vw - var(--spacing-8))) !important;');
    expect(settingsPanelCss).toContain('.settings-tabs-row');
    expect(settingsPanelCss).toContain('.settings-tabs-row .astryx-tab-list');
    expect(settingsPanelCss).toContain('.settings-tab-attention');
    expect(settingsPanelCss).toContain('.settings-subsection-separated');
    expect(settingsPanelCss).toContain('border-top: var(--border-width) solid var(--border-soft);');
  });

  it('keeps SettingsPanel cleanup free of console-era styles and custom provider buttons', () => {
    expect(settingsPanelCss).not.toMatch(/console-/);
    expect(settingsPanelCss).not.toContain('--settings-sidenav-width');
    expect(settingsPanelCss).not.toContain('astryx-side-nav');
    expect(settingsPanelCss).not.toContain('settings-icon-btn');
    expect(settingsPanelCss).not.toContain('--space-');
    expect(settingsPanelCss).not.toMatch(/\b\d+px\b/);
    expect(settingsPanelCss).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(settingsPanelCss).toContain('var(--spacing-');
    expect(settingsPanelCss).toContain('var(--radius-');
  });

  it('uses a single AI-tab attention dot instead of readiness color surfaces', () => {
    expect(settingsPanelCss).toContain('.settings-tab-attention');
    expect(settingsPanelCss).toContain('background: var(--error);');
    expect(settingsPanelCss).not.toContain('data-readiness');
    expect(settingsPanelCss).not.toContain('.console-hero');
    expect(settingsPanelCss).not.toContain('.console-status-row');
  });

  it('groups conversation behavior controls and styles quick prompt edit fields', () => {
    expect(settingsPanelCss).toContain('.settings-conversation-behavior');
    expect(settingsPanelCss).toContain('.settings-text-size-field');
    expect(settingsPanelCss).toContain('.settings-quick-form .astryx-text-input');
    expect(settingsPanelCss).toContain('.settings-quick-form .astryx-text-area');
    expect(settingsPanelCss).toContain('.settings-dialog-header-close');
  });

  it('falls back to a single-column layout on small viewports', () => {
    expect(settingsPanelCss).toContain('@media (max-width: 45rem)');
    expect(settingsPanelCss).toContain('flex-direction: column;');
    expect(settingsPanelCss).toContain('grid-template-columns: 1fr;');
  });
});
