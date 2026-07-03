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

  it('renders Settings tabs as centered pill targets instead of bottom indicators', () => {
    expect(settingsPanelCss).toContain('.settings-dialog .astryx-tab-list');
    expect(settingsPanelCss).toContain('.settings-dialog .astryx-tab > span[aria-hidden="true"]:first-child');
    expect(settingsPanelCss).toContain('top: 50% !important;');
    expect(settingsPanelCss).toContain('transform: translateY(-50%);');
    expect(settingsPanelCss).toContain('.settings-dialog .astryx-tab > span:not([aria-hidden])');
    expect(settingsPanelCss).toContain('display: inline-grid;');
    expect(settingsPanelCss).toContain('height: 32px;');
    expect(settingsPanelCss).toContain('place-items: center;');
    expect(settingsPanelCss).toContain('z-index: 1;');
    expect(settingsPanelCss).toContain('min-height: 32px;');
    expect(settingsPanelCss).toContain('.settings-dialog .astryx-tab > span:not([aria-hidden]) > span');
    expect(settingsPanelCss).toContain('line-height: 1;');
    expect(settingsPanelCss).toContain('.settings-dialog .astryx-tab > span:not([aria-hidden]) > span:not([aria-hidden])');
    expect(settingsPanelCss).toContain('transform: translateY(-1px);');
  });
});
