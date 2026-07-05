# Architecture Review: Daemon auto-resolve gitignored build-artifact rebase conflicts (ai-conductor#319)

**Date:** 2026-07-05
**Mode:** Lightweight (tier M) — feasibility + alignment
**Inputs reviewed:** track `.docs/track/daemon-auto-resolve-gitignored-rebase-conflicts.md`,
complexity `.docs/complexity/daemon-auto-resolve-gitignored-rebase-conflicts.md`, diagram
`.docs/architecture/daemon-auto-resolve-gitignored-rebase-conflicts.md`, the current engine
(`src/conductor/src/engine/rebase.ts`, `conductor.ts:runRebaseStep`,
`daemon-rekick.ts:resumeRebaseFirst`, `daemon-deps.ts`, `daemon.ts:pickEligible`,
`mergeable-sweep.ts`, `build-failure-escalation.ts`), and issue #319.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack:** pure Node fs + the existing injected `GitRunner`; no new packages, services, or infra.
- **Integration surface — three bounded seams, all located:**
  1. New base-ignored delete/modify branch inside `performRebase` (`rebase.ts:406-443`), mirroring
     the CHANGELOG-sole special-case (`:419`, `tryResolveChangelogConflict` `:478`). Lives in
     `performRebase` proper so it runs on BOTH call sites unconditionally (the re-kick path passes
     `cap: 0`, so the gated `/rebase` resolver loop cannot be the home for it).
  2. Orphaned-index recovery: split the preexisting-conflict guard (`rebase.ts:369-378`) on
     `rebaseStateActive()`; reuse the `abortRebase`/reset shape (`daemon-rekick.ts:255`).
  3. Re-dispatch route: new per-slug `.daemon/remediation-redispatch/<slug>` marker + eligibility
     check keyed off the `needs-remediation` label sweep (`mergeable-sweep.ts:151` already reads
     the label) and the `.pipeline/REKICK` sentinel (`daemon-rekick.ts:268`).
- **Net-new primitive:** a base-ref gitignore-membership helper (`git check-ignore` semantics
  against the base tree). Confirmed none exists (`check-ignore` has zero hits in `src/`); it belongs
  in `rebase.ts` beside `conflictedFiles`/`rebaseStateActive`.
- **Data:** one new gitignored repo-root dir `.daemon/remediation-redispatch/`; no schema, no
  migration.
- **Both `performRebase` call sites** already share `runGatedRebaseResolution` (#300/#340), so the
  outcome model extension (`artifact_resolved`) is consumed identically on both — verdict wiring in
  `applyRebaseVerdicts` and `emitRebaseEvent` gets one new arm each.

## Alignment

- **ADR-001 keystone preserved:** after taking the base deletion the branch is genuinely current
  with the base, so `isBranchCurrent` stays truthful — no stale branch ever reports SATISFIED.
- **Follows the CHANGELOG-auto-resolve precedent** (FR-7) exactly: snapshot → take base side →
  `rebase --continue` → docs/artifact-only verdict that never invalidates downstream. `artifact_resolved`
  is verdict-equivalent to `changelog_resolved`.
- **Marker pattern** matches `.daemon/<state>/<slug>` (operator-park, processed, warned) — repo-root,
  gitignored, single-writer.
- **Dedup discipline:** the re-dispatch route deliberately does NOT relax `isProcessed`/ledger dedup;
  it adds a one-shot (slug, PR-number) anchor, directly answering the repo's three prior
  duplicate-dispatch incidents (backfill, slug-rename, same-slug).
- **EKS/remote posture:** per-checkout daemon state; multi-operator coordination out of scope (#184).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Base-ignored predicate drops a real source file | Data | Low | Critical | Test ignore on the BASE ref (not working tree); all-or-nothing over the conflict set; mandatory negative-path story (non-ignored delete/modify still HALTs) |
| Orphaned-index reset aborts a genuinely-active rebase | Data | Low | High | Recovery gated strictly on `rebaseStateActive() === false`; active rebase HALTs unchanged |
| Re-dispatch loops / re-fires on restart | Correctness | Medium | High | One-shot (slug, PR-number) durable marker; same open PR never re-dispatched twice; restart re-reads marker and no-ops |
| Re-dispatch touches shipped/healthy work | Correctness | Low | High | Eligibility requires processed + needs-remediation label + no merged/healthy PR; fail-closed on any uncertainty |
| New `artifact_resolved` arm missed in one verdict/event switch | Technical | Low | Medium | Exhaustive-switch discipline; story asserts the finish-time AND re-kick paths both classify it satisfied |

## ADRs Created

- `adr-2026-07-05-base-ignored-artifact-auto-resolution.md` — APPROVED (host engineer, 2026-07-05)
- `adr-2026-07-05-needs-remediation-redispatch.md` — APPROVED (host engineer, 2026-07-05)

## Adversarial-review revisions (2026-07-05)

An adversarial spec review surfaced two CRITICAL and four HIGH issues, all folded into the ADRs and
stories BEFORE this review closed APPROVED:

- **CRITICAL — orphaned-index reset target.** `reset --hard HEAD` when HEAD is detached at the base
  would drop feature commits and false-satisfy `isBranchCurrent` (the ADR-001 bug). Fixed: recovery
  restores the FEATURE tip (`ORIG_HEAD` / branch ref), and the standard post-rebase guards remain
  (ADR-1 §4, TR-4).
- **CRITICAL — re-dispatch loop via a new PR number.** A failed re-dispatch could spawn a fresh
  remediation PR and re-arm forever. Fixed: a monotonic per-slug attempt cap now bounds re-dispatch
  independently of the PR-number anchor (ADR-2, TR-6). (Confirmed `escalateBuildFailure`
  find-or-creates a deterministically-titled PR, so same-PR reuse usually holds — the cap covers the
  residual case.)
- **HIGH — rebase stage inversion.** Qualification now pinned to `git ls-files -u`: **stage 2
  absent AND stage 3 present** (deleted-by-us), with a mandatory inverse-case HALT test (ADR-1 §1,
  TR-1, new TR-7).
- **HIGH — ignore-against-a-ref.** `check-ignore` reads the working tree, not a ref. Fixed:
  disqualify the whole set if the branch touched any `.gitignore` vs base, then use native
  `check-ignore` (honors nested/negation) — no hand-rolled ref-ignore parser (ADR-1 §2, TR-2).
- **HIGH — CHANGELOG + artifact composition.** #268/#269 conflict on BOTH `dist` and `CHANGELOG`;
  the original all-or-nothing matched neither. Fixed: the resolver handles {CHANGELOG} ∪
  {base-ignored artifact} together (ADR-1 §1, TR-1).
- **HIGH — multi-commit recurrence.** `dist` re-conflicts on each replayed commit; a single
  `git rm` + one `--continue` still strands. Fixed: loop over successive pauses to completion with a
  max-iteration cap (ADR-1 §1, TR-1).

## Conditions

1. Both ADRs are APPROVED before stories land (hard gate — no DRAFT lands). ✅
2. Stories include negative-path scenarios asserting the contract at every call site with real
   adversarial inputs: non-ignored delete/modify HALTs; feature-deleted (stage-3-absent) HALTs
   (TR-7); branch-modified-`.gitignore` HALTs whole; mixed set HALTs whole; genuinely-active rebase
   never reset; orphaned-index recovery restores the feature tip (never false-satisfies);
   re-dispatch never fires twice for the same PR AND is capped per slug; re-dispatch never touches a
   merged/healthy slug; `artifact_resolved` classified SATISFIED on BOTH the finish-time and re-kick
   paths. ✅
3. New tests extend the real-temp-repo harness (`rebase-resolution.test.ts` pattern: real
   conflicting repo + injected runner, no Claude), not just the scripted `fakeGit`.
4. Docs + CHANGELOG updated in the same implementation PR (repo rule).
