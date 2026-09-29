# Complexity: Grade diffs for event-spine bypasses in build_review

Tier: S

## Rationale

| Signal | Assessment |
| --- | --- |
| New models / schemas | None — the existing `custom_rubrics` declaration and custom finding contract carry it |
| External integrations | None |
| Auth / permissions | None — custom review already runs in each provider's read-only mode |
| State machines | None |
| New modules | None; engine source is untouched |
| Production behavior change | This repository's own `.ai-conductor/config.yml` gains one custom rubric declaration; the repo-local `event-spine` skill gains a diff-grading section |
| Consumer impact | None — the declaration and the skill are repo-local (`.agents/skills/`), and nothing ships in `skills/` |

The change is configuration plus repo-local skill prose on an already-landed seam
(`adr-2026-09-10-portable-build-review-policy`). No architectural decision is open: the approach
(project-declared custom rubric, not a built-in) was settled in explore.

Small tier: `/architecture-diagram`, `/architecture-review`, `/conflict-check`, and
`/coherence-check` are skipped.
