# Coherence Mapping: provider-neutral preventive controls for protected DECIDE artifacts (#1254)

**Plan stem:** `codex-lacks-preventive-hook-parity-protected-artif`
**Tier:** M
**Track:** technical — the `fr` row class is omitted by design (no PRD, no `FR-N` identifiers)
**Source outcomes:** `jstoup111/ai-conductor#1254`
**Date:** 2026-08-07

Every `covered` verdict below was confirmed by reading the counterpart artifact file; the
story-to-task layer was parsed mechanically from the plan's `**Story:**` lines rather than asserted.
Summary: 9 outcome rows (7 covered, 2 gaps), 6 story rows (all covered), 19 task rows (all covered).
The two gaps — `outcome-6` and `outcome-8` — are consequences of deliberate, operator-approved
descoping and are waived in `.docs/coherence-waivers/codex-lacks-preventive-hook-parity-protected-artif.md`.

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-5 | covered | A plan task either declares Files (scanned against the protected predicate) or is rejected as ambiguous; the #1254 Task 16 case is rejected by task-5. |
| outcome | outcome-2 | story-1, story-3 | covered | The pre-commit gate refuses the commit so a protected mutation is never committed, on every provider and every write method (task-8, task-12, task-13, task-15). The terminal seal still rejects bypassed paths. The uncommitted class remains the seal's own and is tracked in #1352. |
| outcome | outcome-3 | story-6 | covered | task-18 redirects a build/acceptance_specs gap whose protected target appears only in gap.rationale; task-19 proves an incidental mention does not over-trigger. |
| outcome | outcome-4 | story-3 | covered | task-9 scopes the gate to BUILD/SHIP so DECIDE-phase ADR authoring stays writable; task-10 honors namesOwnFeature and the phase-marker allowlist; task-11 proves an allowlisted path cannot launder a mixed commit. |
| outcome | outcome-5 | story-2, story-5 | covered | task-14 makes the refusal diagnostic a tested contract naming artifact, owning phase, and amendment route; story-5 removes the cycle cost entirely by rejecting the authorization at land. |
| outcome | outcome-6 | | gap | outcome-6. No story or task counterpart: the control-classification inventory is human-facing documentation and the plan skill's documentation boundary forbids documentation plan tasks. Owner is this repository's maintain-documentation custom step; source table already authored in the architecture document. |
| outcome | outcome-7 | story-1, story-2, story-4 | covered | Equivalent observable prevention holds structurally rather than per-provider: the load-bearing control is provider-neutral so both providers receive the identical refusal (task-8, task-15). Diagnostics: task-14. Missing or disabled integration cannot pass: task-16 makes wiring fail closed. |
| outcome | outcome-8 | | gap | outcome-8. The five required paths are covered for the provider-neutral control (task-8 healthy, task-16 missing/disabled, task-11 and task-14 malformed, task-12 bypassed), but this spec ships no provider-specific lifecycle behavior to test because the Codex PreToolUse layer was descoped to #1353. |
| outcome | outcome-9 | story-3, story-4 | covered | No task touches codex-provider.ts or provider-home.ts, so Codex self-host isolation is unchanged. Claude behavior preserved: docs-guard.sh untouched, and task-16 splits fail-open by control class so attribution hooks keep existing behavior. |
| story | story-1 | task-8, task-12, task-13, task-15 | covered | Gate blocks a committed protected mutation, method-blind, on any provider. |
| story | story-2 | task-14 | covered | Refusal diagnostic asserted by test, not merely an exit code. |
| story | story-3 | task-9, task-10, task-11 | covered | Sanctioned in-phase writes pass; gate is phase-scoped to BUILD and SHIP. |
| story | story-4 | task-16, task-17 | covered | Wiring fails closed for the preventive control; module convention comment corrected. |
| story | story-5 | task-1, task-2, task-3, task-4, task-5, task-6, task-7 | covered | Ambiguity rule, shared predicate including .docs/decisions, glob indeterminacy, and the pinned corpus blast radius. |
| story | story-6 | task-18, task-19 | covered | Remediation rationale scan plus its over-trigger negative path. |
| task | task-1 | story-5 | covered | Unify the protected-path predicate to cover .docs/decisions. |
| task | task-2 | story-5 | covered | Glob over a protected directory classified indeterminate. |
| task | task-3 | story-5 | covered | Expose per-task Files-line presence from the parser. |
| task | task-4 | story-5 | covered | Detect a foreign protected path in an undeclared task body. |
| task | task-5 | story-5 | covered | Reject the ambiguous task; the #1254 Task 16 acceptance case. |
| task | task-6 | story-5 | covered | Negative path: a declared task may cite a protected artifact as context. |
| task | task-7 | story-5 | covered | Corpus regression pinning the blast radius at seven ambiguous tasks. |
| task | task-8 | story-1 | covered | PRE_COMMIT_HOOK blocks a staged foreign protected artifact. |
| task | task-9 | story-3 | covered | Gate applies only during BUILD and SHIP. |
| task | task-10 | story-3 | covered | Own-feature and allowlisted paths commit normally. |
| task | task-11 | story-3 | covered | Negative path: an allowlisted path does not launder a mixed commit. |
| task | task-12 | story-1 | covered | CONDUCT_ENGINE_COMMIT bypass, matching the existing convention. |
| task | task-13 | story-1 | covered | Chain to a repository-own pre-commit hook. |
| task | task-14 | story-2 | covered | Fail closed on an unclassifiable path; emit the structured diagnostic. |
| task | task-15 | story-1 | covered | Install the asset into prepared worktrees at mode 0755. |
| task | task-16 | story-4 | covered | Fail closed when the preventive hook cannot be installed. |
| task | task-17 | story-4 | covered | Correct the conditional fail-open convention comment. |
| task | task-18 | story-6 | covered | Redirect a gap whose protected target is only in the rationale. |
| task | task-19 | story-6 | covered | Negative path: incidental rationale mentions do not redirect. |

## Notes on the two gaps

`outcome-6` and `outcome-8` are recorded as gaps rather than argued into coverage because neither has
a real counterpart id in the story/task tree, and a fabricated citation is never coverage. Both are
traceable to filed follow-ups — #1353 for the provider-specific layer, and this repository's
`maintain-documentation` custom step for the inventory. Outcomes 1 through 5, 7, and 9 are covered
with confirmed counterparts, and every story and task maps cleanly in both directions.
