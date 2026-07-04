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

  it('renders the AI Reading Console as a wide shell with Astryx side navigation', () => {
    // The console shell replaces the legacy tab strip. Lock the wide layout,
    // the side-nav column wrapping an Astryx SideNav, and the overview status
    // rows so a future refactor cannot regress to a hand-rolled nav or the
    // narrow tabbed settings form.
    expect(settingsPanelCss).toContain('width: min(840px, calc(100vw - 32px)) !important;');
    expect(settingsPanelCss).toContain('.console-content');
    expect(settingsPanelCss).toContain('display: flex;');
    expect(settingsPanelCss).toContain('.console-sidenav');
    expect(settingsPanelCss).toContain('width: var(--settings-sidenav-width);');
    expect(settingsPanelCss).toContain('.console-sidenav .astryx-side-nav');
    expect(settingsPanelCss).toContain('.console-sidenav .astryx-side-nav-item');
    expect(settingsPanelCss).toContain('.console-sidenav .astryx-side-nav-item[aria-current="page"]');
    expect(settingsPanelCss).toContain('.console-status-row');
    expect(settingsPanelCss).toContain('.console-readiness-dot');
  });

  it('keeps SettingsPanel cleanup free of legacy tabs and custom provider buttons', () => {
    expect(settingsPanelCss).not.toMatch(/settings-tabs-row|settings-tab|settings-form/);
    expect(settingsPanelCss).not.toContain('settings-icon-btn');
    expect(settingsPanelCss).not.toContain('--space-');
    expect(settingsPanelCss).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(settingsPanelCss).toContain('var(--spacing-');
    expect(settingsPanelCss).toContain('var(--radius-');
  });

  it('maps readiness to color through one data-readiness attribute per surface', () => {
    // One readiness→color mapping per surface (chip, hero, status row),
    // driven by data-readiness so the three states stay in sync.
    expect(settingsPanelCss).toContain('.console-readiness-chip[data-readiness="ready"]');
    expect(settingsPanelCss).toContain('.console-readiness-chip[data-readiness="degraded"]');
    expect(settingsPanelCss).toContain('.console-readiness-chip[data-readiness="missing"]');
    expect(settingsPanelCss).toContain('.console-hero[data-readiness="ready"]');
    expect(settingsPanelCss).toContain('.console-status-row[data-readiness="ready"]');
    expect(settingsPanelCss).toContain('.console-status-row[data-readiness="missing"]');
  });

  it('falls back to a single-column layout on small viewports', () => {
    expect(settingsPanelCss).toContain('@media (max-width: 720px)');
    expect(settingsPanelCss).toContain('flex-direction: column;');
    // The SideNav section becomes a wrapping row so nav labels do not overlap.
    expect(settingsPanelCss).toContain('.console-sidenav .astryx-side-nav-section');
    expect(settingsPanelCss).toContain('flex-direction: row;');
  });
});
