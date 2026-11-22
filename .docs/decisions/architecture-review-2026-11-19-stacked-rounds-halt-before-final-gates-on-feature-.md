# Architecture Review: Child validation at whole-feature entry

**Date:** 2026-11-19
**Inputs reviewed:** #3682; the operator-approved technical track, approach A, scope boundary, and architecture diagram for `stacked-rounds-halt-before-final-gates-on-feature-`.
**Mode:** Lightweight, Medium tier
**Verdict:** APPROVED

## Feasibility

The correction fits the existing TypeScript engine and filesystem/Git-backed state model. No new dependency, service, CLI flag, configuration, persisted schema, migration, or provider-specific capability is needed. It restores the existing read-overlay contract at a transition that currently drops it.

| Technical intent | Feasible treatment |
|---|---|
| Start whole-feature gates after valid child completion | Resolve the authoritative leaf context after routed reconciliation and rebind the existing child-region overlay before selecting or checking whole-feature entry. |
| Run genuinely missing validation | If the authoritative region still needs validation, select its earliest unmet gate through the existing region path. Do not dispatch a validator against root child-region fields. |
| Avoid redispatch into completed BUILD | Resume selection, verdict lookup, artifact checks, and the prerequisite clamp must consume the same child identity and region evidence. Missing root fields must not rewind completed child work. |
| Preserve negative gating | Existing routed-work fences, child status and verdict validity, and completion predicates remain binding. A route close or a previous host's success cannot substitute for leaf validation. |

Worktree isolation is unchanged: all reads and writes stay within the feature's existing stores and Git namespace. No shared service or port is added. Resolve through existing topology/cursor APIs rather than adding repeated scans of every child artifact.

## Alignment and implementation boundary

The governing APPROVED decision is `adr-2026-10-07-per-child-build-region`, decision 4: selector, resume and `checkGate` read flat state plus the active child's region keys; the mutation port routes writes by ownership. Decision 1 makes the leaf active after intermediate closure. `adr-2026-10-12-routed-whole-feature-repair` gives routed hosts and revalidation precedence over that ordinary cursor. These decisions already cover the structural design; no new ADR or supersession is warranted.

1. Keep `restoreWholeFeatureState`'s necessary refresh of feature-owned fields and its compare-and-swap baseline, but complete the transition by resolving and adopting the authoritative leaf region when routing has settled. Do not retain the former routed host. Reuse `activateChildRegionState`, `readConductStateOverlay`, and the routed state port; private factoring is allowed, a second state architecture is not.
2. Use the same transition preparation at live routed exit and at restart after preflight. A historical closed route alone must not override currently outstanding routed work or an unresolved cursor. Reuse the existing routing and cursor authorities, including their unavailable/refusal outcomes.
3. Before advancing into whole-feature gates, apply existing region satisfaction and completion rules to the resolved context. If the leaf suite or review is genuinely pending or invalidated, return to that gate in the current run. BUILD is selected only if its own authoritative completion requires it. Do not insert the existing recoverable-prerequisite HALT as an intermediate scheduling step for this case.
4. The prerequisite clamp, verdict-based selection, and tree-attesting completion checks must see child-region evidence consistently. Existing precedence remains: stale state is unsatisfied; a negative verdict cannot be replaced by root success; routed evidence must meet its existing round requirements; unchanged child evidence is not arbitrarily expired merely because another round occurred.
5. Whole-feature statuses and verdicts remain flat. The routed state port already routes non-region fields to root; whole-feature verdict writes must continue to omit a child identity. Child context used for region prerequisites must not leak into whole-feature output paths, budgets, or review inputs. Preserve feature-wide `last_step` writes and existing cursor conflict handling.
6. Intermediate closure and the existing outstanding-work/revalidation fences establish whether the stack may reach its leaf gates. Do not replace these authorities with an aggregate synthetic success bit, an unconditional scan requiring every unaffected child to revalidate, or a marker that says a round once closed.
7. The flat, non-stacked path remains unchanged. No fabricated root `test_suite: done`, copied verdict, blanket prerequisite bypass, mandatory duplicate suite, or broad rewrite of generic resume behavior is permitted.

The approved diagram remains accurate: its evidence-resolution box is a responsibility implemented through the existing overlay and gate paths, not a new service or durable aggregate.

## Wiring Surface

No new public surface is planned. Any private factoring is called by these existing production paths:

| Candidate source | Production integration |
|---|---|
| `src/conductor/src/engine/conductor.ts` | `continueRoutedHostExit`, settled-leaf resume after `stackPreflight`, and whole-feature entry use the authoritative context before selection and gate checks. The ordinary Conductor run remains the entry point. |
| `src/conductor/src/engine/resume-entry.ts` | Existing `resolveRunnableResumeEntry` remains the prerequisite-clamp owner; callers pass the correct overlay. Changes here are allowed only if needed for that integration, preserving flat behavior. |
| `src/conductor/src/engine/conduct-state-store.ts` | Existing overlay and routed-write functions are reused. No change is currently required; preserve absent-child-field semantics and `last_step` handling if factoring touches this file. |

No new external-system call is needed. Existing filesystem stores and Git/cursor adapters retain their ownership; no direct subprocess or hosted-API seam is introduced. Event-spine check: no channel added, existing durable state is read by name, and existing dispatch/refusal events remain on the current spine.

## Verification design

Use bounded Conductor integration tests for live exit and restart because the defect crosses state adoption, selection, and dispatch. Start with root region statuses absent, authoritative child-owned state/evidence, and a previous host distinct from the leaf. Stop at the first intended validator dispatch or actionable refusal through the existing test runner boundary. Do not seed root success as a shortcut.

Cover pending suite and pending review independently, stale or negative child evidence despite old root success, outstanding routed work, unreadable child state, and whole-feature writes remaining flat. Prove completed BUILD is not invoked and region evidence is not copied into root. Preserve existing flat execution coverage. Use local Git only for cursor/route semantics; replace provider and other third-party boundaries. Tests cited here were inspected, not executed; this is specification work.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Former host evidence is mistaken for leaf completion | Integration | Medium | Medium | Resolve leaf after reconciliation; fixture uses different host and leaf evidence. |
| Read context changes whole-feature write ownership | Data | Medium | Medium | Reuse routed port; assert root-only whole-feature statuses and verdicts. |
| Restart and live selection diverge | Technical | Medium | Medium | Share transition preparation and test both public run paths. |
| Concurrent specifications alter the same conductor paths | Integration | High | Medium | Reconcile against implementation HEAD; preserve each gate's owner and regression coverage. |

## Overlap scan

The advisory scan completed with GitHub dependency access. It reported no open blocker entries and found eight sibling branch names touching `conductor.ts` (local and origin copies deduplicated):

- `spec/base-moved-re-kick-skips-test-suite-on-preserved-p`
- `spec/clean-build-review-pass-halts-on-a-deferral-reserv`
- `spec/dotted-adr-citation-halt-test-is-skipped-on-main-a`
- `spec/planner-escalation-to-architecture-review-still-ha`
- `spec/routed-leaf-acceptance-specs-completion-still-requ`
- `spec/routed-verify-green-refuses-the-leaf-host-which-ne`
- `spec/stacked-no-op-rebase-never-satisfies-its-gate-afte`
- `spec/test-suite-infrastructure-retry-spins-past-its-cap`

This is advisory file overlap, not proof of a semantic conflict or dependency. The scan warns that renames/name-only diffs may not be detected. Later conflict-check and land dependency review retain their own authority.

## Verify-Claims Ledger

- **Verified:** `restoreWholeFeatureState` clears child context and reads root state; live exit then selects `manual_test`, while settled-return resume skips ordinary child activation. Source: `conductor.ts` at the named methods and `resumedAtWholeFeature` branch.
- **Verified:** `manual_test` requires `test_suite`; `gates.ts::checkGate` and `resume-entry.ts` use state, while `selector.ts::gateSatisfied` applies verdict/stale precedence.
- **Verified:** the child overlay removes root region values rather than inheriting them; the routed port keeps non-region writes flat and aligns cross-store cursors. Source: `conduct-state-store.ts`.
- **Verified:** `verdictPathFor` refuses whole-feature verdicts under child paths. Source: `gate-verdicts.ts`.
- **Verified:** the existing routed-leaf-return fixture initializes root suite completion. Source: `test/engine/routing/conductor-routed-leaf-return.realgit.test.ts::fixture`.
- **Operator-approved:** scope, approach A and technical track; diagram approved before this review.

No unconfirmed load-bearing assumption remains for this design. Verify-claims verdict: CLEAR. No implementation or test execution has occurred.

## ADRs Created

None. This corrects conformance to existing child-state and routed-repair decisions without changing a structural boundary. No accepted historical artifact is falsified by the correction, so no amendment is needed.
