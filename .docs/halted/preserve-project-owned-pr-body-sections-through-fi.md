# Halt record

Status: halted
Slug: preserve-project-owned-pr-body-sections-through-fi
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-preserve-project-owned-pr-body-sections-through-fi
Head SHA: 7fce824219d2d6ddd4c3435de4c94d2c2c8fc219
Halted at: 2026-09-28T17:39:17.359Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 1 negative: Given a template with two regions that both name `compliance-attest`, when the project config loads, then loading fails with an error naming `compliance-attest` as owning more than one region.
Task ids: 2
Done when checks: `loadConfig` in `src/conductor/src/engine/config.ts`, given `.github/pull_request_template.md` with a region naming a declared custom step ordered before `finish`, succeeds and reports that step as the region's owner in the loaded config, and given two regions naming two such steps succeeds with each step owning exactly its own region, as asserted by the region-owner config tests in `src/conductor/test/engine/config.test.ts` | `loadConfig` succeeds with zero region owners for a template with no markers and for a repository whose only marked template is at the repository root rather than `.github/pull_request_template.md`, as asserted by the unmarked-template and root-template config tests | `loadConfig` fails with an error naming the marker key and the broken rule for a region naming built-in step `finish` (built-in steps cannot own a region), an undeclared key `release-disposiiton` (undeclared step), and a declared step whose `after:` orders it after `finish` (a region owner must run before `finish`), as asserted by the three owner-rule config tests | `loadConfig` fails with an error naming the offending step key for the duplicate-key, unclosed, and nested (naming both keys) templates, and naming the step key and the engine-owned text it contains for the engine-owned-text template, as asserted by the four template-shape config tests
Missing assertion: The cited duplicate-key check requires an error naming the offending step key, but does not explicitly require that the error state the key owns more than one region.

Criterion: Story 8 negative: Given a repository with no region markers, when the production `ready_pr` publication transition runs, then it issues exactly the GitHub operations it issues today.
Task ids: 9
Done when checks: `createFinishPresentationRepair` in `src/conductor/src/engine/conductor.ts` re-inserts every captured region after `rehabilitateHaltPr` and `bodyFloor`, so the body after a body-floor or halt-PR rehabilitation rewrite contains each region with bytes identical to its capture, as asserted by the floor and rehabilitation re-insertion tests in `src/conductor/test/engine/conductor-finish-repair.test.ts` | the `ready_pr` presentation repair as composed by the production CLI and daemon composition roots re-reads the body and compares every region to its capture before `ensureShipReady`, marking the pull request ready when all match, and for a region edited after the last rewrite records one restore edit, then a matching re-read, then the ready-for-review call in that order, as asserted by the production-composition tests in `src/conductor/test/engine/finish-publication-production-wiring.test.ts` | when the restore edit is refused, or the re-read after a restore still differs from the capture, the pull request stays draft, no ready-for-review call is issued, and the run halts with a reason naming the region's step and, for the second case, a verification mismatch, as asserted by the refused-restore and persistent-mismatch tests | with no captured regions, the `ready_pr` presentation repair issues exactly the GitHub operation sequence it issued before this change and no region verification read, as asserted by the no-region operation-sequence test
Missing assertion: The cited no-op check requires the operation sequence only when there are no captured regions; it does not explicitly require that behavior for a repository with no region markers.
```
