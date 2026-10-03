# Track: Per-feature step applicability (#1789)

Track: product

Scope boundary: Minimal per-feature mechanism plus a repo config toggle (default off). DECIDE writes a per-feature applicability marker naming inapplicable steps, each with a reason; the land gate validates it; the engine honors it only when read from the merged base-branch tree and only for steps that opt in to per-feature inapplicability; the skip is recorded with a distinct cause/event carrying reason and the marker's merge-commit author. Excluded: operator TTY ratification verb, change-class profiles/lanes (#1790), changes to tier/track/config-disable behavior for repos with the toggle off.

Operator-facing pipeline-shaping capability with five stated outcomes from #1789 — worth a PRD.
