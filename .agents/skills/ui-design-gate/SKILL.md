---
name: ui-design-gate
description: Produce 2-3 distinct UI options for a chinese-exam-survival-game change and record the owner's selection in the issue before any UI code is written. Use for any change to layout, visual design, copy hierarchy, or interaction.
---

# UI design gate

1. Read the existing vanilla TypeScript views, pixel-art styling, and Traditional Chinese copy. Consult SPEC.md and docs/pixel-frontend.md for tablet and classroom constraints.
2. Produce 2-3 meaningfully different options with `frontend-design` when available, or existing pixel-art conventions. Prefer previews that run (a static HTML file or a Vite screen on a temporary branch) over images. Keep unselected previews out of `main`.
3. Compare them: visual hierarchy, mobile behavior, accessibility, complexity, impact on game state, subscriptions, and teacher/student flows.
4. Ask the owner to select or request revisions. No implementation before selection. Do not recommend a winner as if decided.
5. Record the selected option, preview links or screenshots, and the reasons in the issue's "UI design selection" section, and add a matching acceptance criterion.

If the change is purely non-visual, skip the gate and write one line in the issue saying why.
