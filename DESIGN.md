---
name: CReader
description: A quiet local EPUB reader with contextual AI and source-grounded Reading Memory.
colors:
  light-paper: "#FBF7EF"
  light-panel: "#F7F1E7"
  light-elevated: "#FFFDF8"
  light-control: "#302B240B"
  light-ink: "#1F2933"
  light-secondary: "#53606B"
  light-tertiary: "#7D746A"
  light-muted: "#A3988A"
  light-border: "#302B2421"
  light-border-soft: "#302B240B"
  editorial-blue: "#264466"
  editorial-blue-hover: "#1E354F"
  dark-paper: "#0B0D0F"
  dark-panel: "#101418"
  dark-elevated: "#171C22"
  dark-ink: "#EEF2F6"
  sepia-paper: "#F4ECD8"
  sepia-panel: "#EFE5D0"
  sepia-ink: "#3D3531"
  sepia-accent: "#7A512A"
  success: "#3E7D5B"
  warning: "#9C6D1E"
  error: "#B84A3F"
typography:
  display:
    fontFamily: "ui-serif, New York, Georgia, Times New Roman, serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0"
  mono:
    fontFamily: "SF Mono, Cascadia Mono, Segoe UI Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.3
rounded:
  sm: "4px"
  md: "6px"
  control: "7px"
  lg: "8px"
  surface: "9px"
  xl: "10px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.editorial-blue}"
    textColor: "{colors.light-elevated}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "38px"
    typography: "{typography.label}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.light-secondary}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "38px"
    typography: "{typography.label}"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.light-secondary}"
    rounded: "{rounded.sm}"
    size: "34px"
    typography: "{typography.label}"
  panel:
    backgroundColor: "{colors.light-panel}"
    textColor: "{colors.light-ink}"
    rounded: "{rounded.surface}"
    padding: "16px"
  input:
    backgroundColor: "{colors.light-control}"
    textColor: "{colors.light-ink}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
    height: "34px"
---

# Design System: CReader

## 1. Overview

**Creative North Star: "The Attentive Reading Desk"**

CReader should feel like a quiet desktop reading desk: paper, book spine, margin note, and a nearby assistant that waits until it is useful. The product is personal, local, and literate. It should stay calm during long reading sessions and give the user confidence that books, excerpts, and Reading Memory remain under their control.

The system rejects SaaS dashboard density, busy note-taking app chrome, chatbot-first AI layouts, Kindle mimicry, and Obsidian-style graph or vault aesthetics. It uses familiar desktop UI patterns, but keeps them soft enough that the book remains the main object.

**Key Characteristics:**
- Restrained paper surfaces with one editorial blue accent.
- Small radii, compact controls, and system UI typography.
- Proximity, grouping, and tonal shifts before dividers.
- Motion as a state response, not decoration.
- AI features that inherit reading context without becoming the product frame.

## 2. Colors

The palette is restrained paper plus editorial blue: warm enough for reading, sober enough for tools, and never saturated across large inactive surfaces.

### Primary
- **Editorial Blue** (#264466): The primary action, selected state, focus ring, active toolbar button, and source-trace accent. Use sparingly, usually under 10% of a screen.
- **Editorial Blue Hover** (#1E354F): Hover and pressed state for primary actions in the light theme.

### Secondary
- **Knowledge Green** (#3E7D5B): Success, available provider state, and completed ingestion feedback.
- **Margin Amber** (#9C6D1E): Warning, unavailable-but-recoverable states, and sepia-adjacent notices.
- **Correction Red** (#B84A3F): Destructive actions and error states.

### Neutral
- **Light Paper** (#FBF7EF): Main reading and app background in light theme.
- **Light Panel** (#F7F1E7): Sidebars, toolbars, and persistent panels.
- **Light Elevated** (#FFFDF8): Menus, dialogs, and floating panels.
- **Light Ink** (#1F2933): Primary text.
- **Light Secondary** (#53606B): Body-adjacent labels and secondary UI text.
- **Light Tertiary** (#7D746A): Hints and subdued metadata.
- **Light Muted** (#A3988A): Disabled or very low-priority text.
- **Dark Paper** (#0B0D0F): Night reading background.
- **Sepia Paper** (#F4ECD8): Eye-care reading background.

### Named Rules

**The One Accent Rule.** Blue marks action, selection, focus, and source. Do not use it as decoration.

**The Proximity Before Lines Rule.** Prefer spacing, alignment, background tone, and local hover proximity over borders. Keep hard separators for structural shell edges only.

## 3. Typography

**Display Font:** ui-serif, New York, Georgia, Times New Roman, serif  
**Body Font:** -apple-system, BlinkMacSystemFont, Segoe UI Variable, Segoe UI, system-ui, sans-serif  
**Label/Mono Font:** SF Mono, Cascadia Mono, Segoe UI Mono, ui-monospace, monospace

**Character:** The interface is mostly system sans for native desktop clarity. Serif appears as a light literary signal in reader-facing titles and brand-like moments, not in dense controls.

### Hierarchy
- **Display** (600, 1.875rem, 1.3): Rare top-level empty states or reader-facing headings.
- **Headline** (600, 1.5rem, 1.3): Dialog and panel headings.
- **Title** (600, 1rem, 1.3): Toolbar book titles, section titles, and compact panel titles.
- **Body** (400, 1rem, 1.6): Reading-adjacent explanations and prose. Cap long prose around 65 to 75 characters.
- **Label** (600, 0.75rem to 0.875rem, 1.25): Buttons, tabs, metadata, and compact settings labels. Uppercase is allowed only for short technical labels.
- **Mono** (600, 0.75rem, 1.3): Progress percentages, code paths, debug snippets, and stable numeric controls.

### Named Rules

**The Reading Surface Rule.** Type inside the book and AI answer should be tuned for sustained reading; type inside toolbars and settings should stay compact and predictable.

## 4. Elevation

CReader uses a hybrid of tonal layering and small shadows. Persistent surfaces are mostly flat and separated through background tone. Shadows are reserved for floating menus, dialogs, drag overlays, and popovers that need to detach from the reading plane.

### Shadow Vocabulary
- **Subtle Surface** (`0 1px 2px rgba(48, 43, 36, 0.07)`): Small tactile feedback or book-cover framing.
- **Menu** (`0 4px 10px rgba(48, 43, 36, 0.09)`): Light dropdowns and compact floating controls.
- **Popover** (`0 14px 34px rgba(48, 43, 36, 0.14)`): Settings panel, theme menu, chapter popovers.
- **Modal** (`0 18px 42px rgba(48, 43, 36, 0.16)`): Blocking dialogs only.

### Named Rules

**The Flat At Rest Rule.** Shell panels, toolbar groups, book rows, and settings sections should not use decorative shadows. If a surface is always visible, give it tone and spacing, not lift.

## 5. Components

### Buttons
- **Shape:** Compact desktop control radius (4px to 7px).
- **Primary:** Editorial Blue background, light text, 38px minimum height, 8px by 16px padding.
- **Hover / Focus:** Hover darkens the blue or shifts the control tone. Focus uses a blue ring with low alpha.
- **Secondary / Ghost:** Secondary buttons use control or tertiary backgrounds. Ghost buttons begin transparent and earn background on hover or proximity.

### Chips
- **Style:** Small rounded pills or squared pills, 4px to 6px radius, tonal backgrounds.
- **State:** Selected chips use blue text and a soft blue background. Counts and progress use mono or tabular numeric treatment.

### Cards / Containers
- **Corner Style:** 6px to 10px, never large rounded cards.
- **Background:** Persistent areas use Light Panel or soft control fills; floating panels use Light Elevated.
- **Shadow Strategy:** Only menus, dialogs, and true overlays use shadows.
- **Border:** Use 1px soft borders sparingly. Avoid colored side stripes and repeated horizontal dividers.
- **Internal Padding:** Compact controls use 8px to 12px. Panels use 16px to 24px.

### Inputs / Fields
- **Style:** Soft control background, 1px border, 5px to 6px radius, 34px default height for settings.
- **Focus:** Border shifts to Editorial Blue with a soft blue focus ring.
- **Error / Disabled:** Error uses Correction Red. Disabled controls lower opacity and preserve layout.

### Navigation
- **Style:** The app shell uses a left library sidebar, a compact top toolbar, a central reader, and a right AI panel. Active states should be tonal first and blue second.
- **Hover / Active:** Nearby controls may respond through subtle proximity-based scale, opacity, or color. The effect must degrade to ordinary hover and focus for keyboard and reduced-motion users.
- **Mobile / Narrow:** Collapse or hide panels structurally. Do not rely on fluid typography to solve cramped toolbars.

### AI Panel

The AI panel is a reading-context companion. It should show message stream, quick prompts, and input without permanent provider or model configuration. Context quotes and accumulated selections should feel like source annotations, not alert cards.

### Reading Memory Settings

Reading Memory controls belong in Settings under the existing top-level tab model. Path rows, quick prompt editing, and provider configuration should stay compact, source-grounded, and explicit about local ownership.

## 6. Do's and Don'ts

### Do:
- **Do** keep the book or current reading context visually dominant.
- **Do** use Editorial Blue (#264466) for selection, focus, active commands, and primary action only.
- **Do** reduce unnecessary linework by replacing separators with proximity, spacing, and tonal grouping.
- **Do** make pointer proximity feel continuous with small scale, opacity, and tone changes.
- **Do** support reduced motion and keyboard focus for every proximity effect.
- **Do** use shadows only for floating surfaces that visually leave the reading plane.

### Don't:
- **Don't** make CReader look like a SaaS dashboard.
- **Don't** make CReader look like a busy note-taking app.
- **Don't** make CReader feel like a chatbot-first AI app.
- **Don't** mimic Kindle or Obsidian visual language.
- **Don't** use colored `border-left` or `border-right` stripes greater than 1px as emphasis.
- **Don't** add persistent AI configuration controls back into the AI panel.
- **Don't** introduce large card radii, decorative glass, gradient text, or repeated card grids.
- **Don't** make motion required to understand state.
