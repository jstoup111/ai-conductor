# Complexity: block-edits-to-docs-spec-artifacts-during-build-an

Tier: M

## Rationale

- No data models, external integrations, auth surfaces, or multi-state machines —
  rules out L.
- More than a single-file change — rules out S. The feature touches five distinct
  surfaces: (1) engine marker lifecycle (phase-keyed `.pipeline/phase-active`
  write/clear + stale-marker handling in conductor step dispatch), (2) a new
  PreToolUse hook script asset (`docs-guard.sh`) in session-hook-assets, (3)
  worktree-prepare settings wiring for the new hook, (4) bootstrap/template wiring
  for primary checkouts plus the CHANGELOG migration block (hook-wiring is a
  release-gated breaking surface), (5) the typed step→allowed-prefix allowlist
  table + tests (hook behavior, marker lifecycle, allowlist resolution).
- Estimated story count ~6-8 with happy/negative paths — mid-band M.
- Signals used: conduct complexity rubric (models, integrations, auth, state
  machines, story count).
