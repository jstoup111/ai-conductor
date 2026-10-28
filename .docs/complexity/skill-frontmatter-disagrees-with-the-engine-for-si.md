# Complexity: skill frontmatter disagrees with the engine (#1018)

Tier: S

## Rationale

- **Models:** none — no new dispatch, prompt, or model routing.
- **State machine:** none — no step added, removed, reordered, or re-tiered; `STEP_DEFINITIONS`
  enforcement values are the source of truth and stay unchanged.
- **Integrations / auth / schema:** none — skill frontmatter and prose corrections plus removal of
  two dangling `skillName` values in `steps.ts`.
- **Removals:** no directory deletion.
- **Story count:** estimated 4–5 (enforcement alignment, manual-test dependency, prose corrections,
  dangling skillNames, drift check).

Small: single-concern metadata/prose drift fix in one repo with one new contract test; the only
design choice (multi-step skills declare the strictest level) is recorded in stories.
