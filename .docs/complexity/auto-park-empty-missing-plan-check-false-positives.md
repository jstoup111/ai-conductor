# Complexity: auto-park empty/missing-plan check false-positives on a completed build with a present plan

Tier: S

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None |
| External integrations | None |
| Auth / permission surface | None |
| State machines | None |
| Story count | 2 (happy: a completed build whose plan uses `### Task N — Title` headings is NOT auto-parked as empty-plan; negative: a genuinely empty/missing plan still auto-parks) |
| Files touched | 1 code (`autoheal.ts`, one regex) + 2 test files + `CHANGELOG.md` |
| New runtime code | None — one alternation added to an existing regex terminator |
| Decisions / conflicts | None — no design choice; the fix aligns one parser's grammar with the authoring convention two sibling parsers (`parsePlanTasks`, `evidence-cli`) and the gate's own line-676 presence regex already accept |

## Rationale

The root cause is empirically reproduced and isolated to a **single line**:
`parsePlanTaskPaths`'s task-header regex (`autoheal.ts:1077`)
`/^#{1,6}\s+Task\s+([A-Za-z0-9._,\s-]+?)(?::|$)/` requires the captured id to end at a colon or
end-of-line. A heading like `### Task 1 — Add resolveMainRepoRoot …` (em-dash `—`, no colon) fails
the match — the em-dash is not in the id character class and there is no reachable `:` or `$` — so
the plan yields zero ids. The build predicate then returns `no tasks in plan`, which the daemon's
`emptyPlan` derivation treats as "empty/missing plan" and auto-parks (`conductor.ts:2115-2131`),
even though the build completed N/N with real commits carrying clean `Task: N` trailers.

The fix widens the terminator to also accept a whitespace-preceded em-dash/en-dash title separator
(`(?::|\s[—–]|$)`), matching the `### Task N — Title` convention. It is strictly widening: every
previously-parsed heading (colon form, bare `### Task N`, ranges `1-3`, comma-lists `1, 2`,
`rem-adr-001`) still parses identically; genuinely task-less plans still parse to zero ids, so the
`empty/missing plan` park path is preserved for its real trigger. No schema, CLI, hook, or config
change; one module, terminator-only. → **Tier S.**
