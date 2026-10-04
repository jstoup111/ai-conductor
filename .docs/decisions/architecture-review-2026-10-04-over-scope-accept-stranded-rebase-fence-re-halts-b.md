# Architecture Review: Over-scope accept stranded behind the resume-time rebase fence (#2983)
**Date:** 2026-10-04
**Mode:** Lightweight (Tier M) — §2 Technical Feasibility, §4 Architectural Alignment
**Input:** `.docs/track/over-scope-accept-stranded-rebase-fence-re-halts-b.md` (technical track,
Approach A), approved sequence `.docs/architecture/over-scope-accept-stranded-rebase-fence-re-halts-b.md`
**Stories reviewed:** none yet (pre-stories review)
**Verdict:** APPROVED WITH CONDITIONS

## Evidence (verified on the stalled feature `new-review-concern-at-a-resolved-anchor-halts-as-m`)

| Fact | Basis | Confidence |
|---|---|---|
| prd_audit halted with an NC.1 OVER_SCOPE offer at 00:44:15Z; `gates/prd_audit.json` (checkedAt 00:44:04.236Z) is that lap's own verdict — there was no separate 02:05Z re-verification (issue's time was a UTC/-0400 misread). | `events.jsonl` `gate_verdict`/`loop_halt`; file mtimes | verified, 97% |
| `[missing-relation]` was computed by the prd_audit completion predicate (`artifacts.ts`, `classifyPrdAuditWideningProjection`) ~0.15s **before** `prd_widening_reconciled` published the same-case relation (00:44:04.39Z). Relation data was never lost; the persisted reason is a pre-reconciliation classification. | event ordering vs. gate-file mtime | verified ordering, 90% on cause |
| Operator recorded `decision: accept` via `halt clear` → `HALT.cleared` at 01:03:36Z. | `HALT.cleared` mtime + body | verified |
| Next resume (01:06Z, and again 10:11Z) halted needs-human with `rebase transition still has an outstanding prd_audit repair or re-verification` before any step dispatched. | `conductor.ts` resume branch calls `rebaseOperationPublicationBlocker` and returns after `writeHaltMarker`; no `step_started` after 00:44 | verified, 95% |
| `HALT.cleared` is harvested only by `preparePrdWideningBeforeAudit` at prd_audit dispatch. | `conductor.ts` `preparePrdWideningBeforeAudit`; `accepted-widenings.ts` `OVER_SCOPE_CLEAR_INSTRUCTION` | verified |
| The resume fence (added #2555) exists to stop a restarted process "selecting finish across an interrupted/inconsistent rebase write". | inline comment at the call site | verified |

## Feasibility

- **Stack:** no new dependencies, packages, services, or infrastructure.
- **Prerequisites:** none. `appliedAt` is already stamped on applied rebase operations (#2689), so
  "re-judged after the rebase" is decidable from durable data (`verdict.checkedAt > appliedAt`).
- **Integration surface:** three engine seams in one module family — the publication fence
  (`gate-code-validity.ts`), the resume entry (`conductor.ts`), and the prd_audit completion
  predicate reason (`artifacts.ts`), plus read-only access to existing widening stores for halt text.
- **Data:** one additive record-format change — `RebaseOperationRecord` persists its preservation
  candidates (operator-requested so an interrupted operation can be completed without losing earned
  preservation). Records without the field remain valid and fall back to re-checking. No new
  persisted file; halt text is derived from existing `.pipeline/HALT.cleared`,
  `accepted-widenings.json`, and `remediation-cases.json`.
- **Performance:** a few extra small-file reads on resume only.
- **Worktree isolation:** per-worktree `.pipeline/` state only; no shared resources.

## Alignment

- **Governing ADRs (reused, not superseded):**
  - `adr-2026-07-11-verdict-aware-resume-entry` (APPROVED) — the resume entry clamps backward to the
    earliest unsatisfied gate verdict. Approach A hands a post-rebase unsatisfied re-judgement to
    exactly this mechanism instead of halting ahead of it; it conforms to that decision.
  - `adr-2026-08-16-restore-the-current-head-publication-fence` / `adr-2026-07-26-rebase-tail-current-branch-before-publication`
    — publication must not proceed over unresolved rebase effects. Preserved: the **finish**
    completion predicate keeps the full `rebaseOperationPublicationBlocker` check unchanged, and the
    accepted story `finish-fence-rejects-a-fresh-pass-for-a-gate-the-l` (finish-fence blockers for
    unsatisfied/absent preserved verdicts) remains true.
- **Pattern consistency:** the fence already distinguishes integrity faults (applying, malformed,
  unstamped preservation) from lifecycle effects (its own comment excludes invalidated/reverified
  entries). Treating a post-`appliedAt` unsatisfied re-judgement as a lifecycle effect on the resume
  path extends that existing split; it introduces no new structural pattern.
- **State management:** the fence result should become an explicit discriminated classification
  (integrity fault vs. outstanding-lifecycle gate vs. clear) consumed by both callers, rather than
  a boolean/string the resume path re-parses. Finish treats both non-clear kinds as blocking; resume
  treats only integrity faults as blocking.
- **Boundaries:** the rebase fence must not import prd-widening classification logic. Decision
  naming in halts reads the widening stores through their existing public readers at the resume
  call site (conductor), keeping `gate-code-validity.ts` widening-agnostic.
- **Security / authority:** no new authority path. An operator decision is still only harvested by
  the prd_audit lap and still only granted via `classifyPrdWidening`; refused/absent decisions halt
  as today. The change removes a block in front of the existing harvester; it creates no way to
  satisfy a gate without a fresh judgement.
- **Diagrams:** sequence added and approved; C4 component diagram unchanged (no new components).

## ADRs Created

- `adr-2026-10-04-resume-completes-interrupted-rebase-operation` — the structural prerequisite is met
  by the operator-added scope: it changes the durable state-transition design of the rebase operation
  (persisted preservation candidates and resume-time completion of an `applying` record). It also
  records the resume/finish fence split (D4–D5) and decision-naming halts (D6) so the whole change
  has one governing decision. Conforms to the APPROVED ADRs cited above; supersedes none.

## Wiring Surface

| Surface | Production caller (design-time) |
|---|---|
| Fence classification (integrity fault vs. outstanding lifecycle gate) exported from `gate-code-validity.ts` | Resume entry in `Conductor.run()` (`conductor.ts`, `this.resume` branch) and the `finish` completion predicate in `artifacts.ts` |
| Persisted preservation candidates on `RebaseOperationRecord` | Written by `applyRebaseTransition` (`rebase-transition.ts`), reached from the existing post-rebase callers in `conductor.ts` and `daemon-rekick.ts`; read by the resume-time completion |
| Resume-time completion of an `applying` operation | `Conductor.run()` resume branch, before `findResumeIndex`, calling the existing `applyRebaseTransition` |
| Decision-naming text for resume-fence halts | `Conductor.run()` resume branch, passed to the existing `writeHaltMarker(…, 'needs-human')` |
| Truthful unsatisfied reason for a pending over-scope offer | Existing prd_audit completion predicate in `artifacts.ts` → persisted `.pipeline/gates/prd_audit.json` and `gate_verdict` event |

Advisory overlap scan (`ai-conductor overlap-scan`): `conductor.ts` also touched by unmerged
`spec/daemon-self-host-guardrails` and `spec/self-host-phase6-wiring` — expect rebase churn only.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Narrowed resume fence lets a restarted process reach finish across an inconsistent rebase | Data | Low | High | Finish predicate keeps the full fence; tests prove finish still blocks with an unsatisfied/absent preserved verdict; resume still halts on applying/malformed/unstamped/stale-before-`appliedAt` |
| Resume-time completion preserves a gate whose verdict changed after the crash | Data | Low | High | Completion reuses `applyRebaseTransition`'s digest check against the persisted `originalVerdictDigest`; a mismatched verdict is never stamped |
| Pre-ADR `applying` records lack candidates | Data | Low | Low | Fail-closed fallback re-checks `invalidated` ∪ `preserved`; provisional `preparing-` records re-check every downstream gate |
| Unsatisfied preserved verdict recorded **before** `appliedAt` misclassified as fresh | Data | Low | Medium | Classification keys strictly on `checkedAt > appliedAt`; older or absent verdicts remain integrity faults |
| Resume clamp does not route to the unsatisfied preserved gate (state says done) | Technical | Low | High | `adr-2026-07-11` clamp reads on-disk verdicts; acceptance test resumes the reproduced state and asserts prd_audit dispatch + HALT.cleared harvest |
| Reason-text change breaks consumers parsing the prd_audit verdict reason | Integration | Low | Low | Keep the `NC.x (OVER_SCOPE)` prefix; grep consumers during plan |

## Conditions

1. Finish-path fence behavior is byte-for-byte unchanged (existing blocker strings preserved).
2. Every resume-path integrity fault still halts `needs-human`; tests cover malformed, unstamped
   preserved PASS, absent preserved verdict, and unsatisfied verdict older than `appliedAt`.
   An `applying` operation is completed (full descriptor with candidates, full descriptor without
   candidates, provisional descriptor), and a `refused` completion halts `needs-human`.
3. `gate-code-validity.ts` stays free of prd-widening imports.
4. Negative paths: a refused or absent decision halts through prd_audit exactly as today.
