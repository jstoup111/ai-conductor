# Complexity: Adopt Fable for recovery/failure-response steps (rebase, remediate, debugging)

Tier: S

## Rationale

Declarative model-policy flip with no new mechanisms — smaller than the merged sibling
front-of-funnel spec (#188 / PR #196):

- 2 model-string edits + 1 effort edit in one constants file
  (`src/conductor/src/engine/resolved-config.ts`: `rebase` opus→fable + effort high→max,
  `remediate` opus→fable, effort unchanged). `debugging` is not an engine step — it is
  skill-pin only.
- 3 SKILL.md frontmatter pins (rebase/remediate/debugging: `model: opus` → `model: fable`).
- 3 HARNESS.md model-table rows updated (rationale rows), plus one interim-fallback note
  documenting the manual `--model` override until #186's availability ladder lands
  (#186 is still OPEN as of 2026-07-02).
- CHANGELOG + docs upkeep.

`'max'` is already a valid `EffortLevel` (`src/conductor/src/types/config.ts`) — no type
change. No new integrations, auth, state machines, or schema changes. Validation is the
existing `test/test_harness_integrity.sh` suite plus the conductor unit suite. Story count
small (2–3). Availability degradation logic remains out of scope (deferred to #186).

Operator confirmed Tier S on 2026-07-02 (skips architecture-diagram, architecture-review,
conflict-check; technical track also skips /prd).
