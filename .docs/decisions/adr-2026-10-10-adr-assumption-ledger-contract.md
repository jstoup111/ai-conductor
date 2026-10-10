# ADR: ADR Assumption Ledger Contract

**Date:** 2026-10-10
**Status:** APPROVED (operator-approved 2026-10-10)
**Deciders:** James Stoup (operator), composer DECIDE session for issue #542

## Context

HARNESS.md's Correctness & Assumption Gate requires every load-bearing assumption behind a spec,
plan, or ADR to be surfaced with a confidence and a basis, and blocked until the operator confirms
it. The only enforcement is prose in `skills/verify-claims/SKILL.md` and
`skills/architecture-review/SKILL.md:28-31`. No mechanism rejects an ADR that carries no
assumptions at all. The issue records two escapes. #452's design rested on the unwritten
assumption "the pipeline agent will run task start", and the defect shipped. #520's ADR promised
that "#467 [is] subsumed via the evidence judge CLI" with no assumption trail behind it, and that
CLI shipped as a stub.

Where assumptions are written today (verified by reading the corpus on 2026-10-10): 27 files under
`.docs/decisions/` carry an assumptions heading. Almost all of them are `architecture-review-*` or
`review-*` documents rather than ADRs, and they use at least three incompatible shapes: tables with
different column sets, and bullet lists. `templates/adr.md.template` has no assumptions section.

Two APPROVED precedents bound where a gate on ADR content may live.
adr-2026-08-08-single-adr-approval-parser-three-rungs checks **approval status** at land,
discovery, and as-built. adr-2026-09-02-adr-decision-citability-contract D4 confines the
**content-shape** check for citability to land, because a shape check at discovery strands specs
that are already merged.

The `/conduct` path authors ADRs in-run, and its `architecture_review` step is
`enforcement: 'advisory'` (`src/conductor/src/engine/steps.ts`). In auto mode an advisory step's
failure is recorded as a skip and the run continues (`conductor.ts`, the auto-mode advisory branch
of step-failure handling). A predicate on an advisory step therefore cannot block.

## Options Considered

### Option A: Ledger section inside each ADR, one shared parser, land + conduct gates
- **Pros:** The assumption sits beside the decision it underpins. Follows the single-parser pattern
  of adr-2026-08-08 and adr-2026-09-02. Fails at authoring time on both DECIDE paths.
- **Cons:** Does not cover assumptions behind PRDs, stories, or plans. The conduct gate requires
  `architecture_review` to become gating.

### Option B: One ledger file per spec (`.docs/assumptions/«plan-stem».md`)
- **Pros:** Attributed by stem like the tier and track markers. Could cover all DECIDE artifacts.
- **Cons:** Contradicts the issue's outcome that the ledger is recorded in the ADR, and separates the
  ledger from the decision. Adds one more artifact type.

### Option C: Strengthen skill prose only
- **Pros:** No engine change.
- **Cons:** This is the status quo the issue exists to remove. It is prompt discipline where
  machinery can enforce the rule, which the repository Design Principle forbids.

### Option D: Option A plus a daemon-discovery rung
- **Pros:** Also catches spec PRs merged by hand without going through land.
- **Cons:** A content-shape gate at discovery strands merged specs, the failure that
  adr-2026-09-02 D4 avoids. It needs an enforcement-date cutoff to exempt the legacy corpus.
  Rejected by the operator during this review.

## Decision

Option A, because it delivers the issue's outcomes where the ADR is authored, reuses established
single-parser and land-rung patterns, and avoids creating a stranding failure class at discovery.

1. **Ledger grammar.** An in-scope ADR (decision 3) carries exactly one `## Assumptions` heading
   (case-insensitive; fenced code blocks excluded before matching, per adr-2026-08-08's parser
   hygiene). Its body is either:
   - **(a) The explicit empty statement**, the line `No load-bearing assumptions.` A table may
     follow it, but only with rows whose Load-bearing cell is `no`.
   - **(b) A ledger table** with the header columns, in this order:
     `| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |`, and at
     least one data row. Each row has:
     - `#`: a unique id of the form `A<n>`.
     - `Assumption` and `Impact if wrong`: non-empty.
     - `Basis`: exactly one of `verified`, `inferred`, `unverified` (case-insensitive).
     - `Confidence`: an integer from 0 to 100 followed by `%`.
     - `Load-bearing`: `yes` or `no`.
   A missing section, an empty body, or any row violating these rules fails the ADR. The empty
   statement, not the size of the change, is what lets an ADR with nothing to declare pass.
2. **Per-entry operator approval.** Every row with `Load-bearing` = `yes` and `Basis` other than
   `verified` (that is, `inferred` or `unverified`) has an `Approval` cell matching
   `APPROVED by operator YYYY-MM-DD` with a valid calendar date. Other rows may leave `Approval`
   empty or `—`. The approval is recorded in the artifact, never only in session logs.
3. **Scope: newly added ADRs, plus changed ADRs that already carry the section.** An ADR is
   *added* when its path exists in the working tree but not in the merge-base tree, and *changed*
   when the path exists in both and the content differs. Every added `.docs/decisions/adr-*.md` must
   pass decisions 1–2. A changed pre-existing ADR is checked only if it already contains an
   `## Assumptions` heading, so an amendment cannot corrupt a ledger and a legacy ADR is never
   forced to retrofit one. ADRs the spec does not touch are never checked, which exempts the
   existing corpus.
4. **Single parsing authority.** A new pure function `parseAdrAssumptionLedger(content)` in
   `src/conductor/src/engine/artifacts.ts`, beside `adrApprovalStatus` and `parseAdrDecisions`, is
   the only code allowed to interpret the section. It returns either `ok` or diagnostics, each
   naming the failed rule (`missing-section`, `empty-section`, `malformed-header`,
   `malformed-entry`, `missing-approval`, `contradictory-empty-statement`) and the entry id where
   one applies.
5. **Land rung.** The compose land gate (`engineer/land-spec.ts`, the existing 4e ADR rung) rejects
   the spec with a new reason `adr-assumption-ledger`, naming each offending ADR, entry id, and rule.
   As in adr-2026-09-02 D4, this is an evidentiary defect: the refusal is non-waivable and the gate
   only refuses, appending no tasks.
6. **Conduct rung.** `GATE_ONLY_PREDICATES` gains an `architecture_review` entry that applies
   decisions 1–3 to the feature worktree, computing the merge base the way
   `coverage-binding-decide-set.ts` does (prefer `origin/«default»`, falling back to the local default
   branch). Unlike that resolver, the predicate fails closed: if no merge base can be resolved, the gate
   is unsatisfied with a reason saying so, and does not treat the unknown diff as empty (operator
   decision 2026-10-10). It reads ADRs from the working tree, so an uncommitted added ADR is in scope.
   It runs the same parser as decision 4. The `architecture_review` step definition changes from `enforcement: 'advisory'` to
   `enforcement: 'gating'`, so a failing gate halts an auto run for a human instead of being
   recorded as a skip. The step keeps `skippableForTiers: ['S']` and `kickbackTarget: true`.
7. **No discovery, BUILD, or SHIP consumer.** Daemon discovery (`daemon-backlog.ts`) and as-built
   review do not read the ledger. Following adr-2026-09-02 D4, a merged spec is never re-graded
   against this contract. Spec PRs merged by hand without going through land are the accepted
   residual gap.
8. **Authoring surfaces.** `skills/architecture-review/templates/adr.md.template` gains the
   `## Assumptions` section with the column header and the empty-statement option. Per
   adr-2026-08-13-markdown-default-inversion, the template is load-bearing runtime source.
   `skills/architecture-review/SKILL.md` names the section as required for every new ADR.
   `skills/verify-claims/SKILL.md` Practice 5 names this table as the form an ADR's ledger takes.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | `landSpec` already derives the spec's changed ADR paths and the merge-base ADR tree, so the land rung needs no new git plumbing (`land-spec.ts` 4e rung: `changedAdrPaths`, `baseAdrPaths`) | verified | 99% | yes | The land rung needs its own diff derivation; plan effort grows | — |
| A2 | `architecture_review` is advisory and an advisory failure auto-skips in auto mode, so a predicate alone cannot block | verified | 95% | yes | Flipping to gating would be unnecessary | — |
| A3 | Once the step is gating, a `GATE_ONLY_PREDICATES.architecture_review` entry is evaluated by the step-generic gate-verdict path (`gate-verdicts.ts` `checkGateCompletion` → `computeAndWriteVerdict`) the way the stories/plan entries are | inferred | 80% | yes | The conduct rung is inert. The plan carries a task that proves enforcement with a failing-ledger test and wires the call if it is absent | APPROVED by operator 2026-10-10 |
| A4 | Making `architecture_review` gating is acceptable even though every other architecture-review failure in auto mode will now halt instead of skip | inferred | 85% | yes | Auto runs halt more often for non-ledger architecture-review failures | APPROVED by operator 2026-10-10 |
| A5 | Daemon-built merged specs pass the new conduct predicate because their ADRs are already on the default branch, so the feature worktree adds none | inferred | 85% | yes | A merged spec halts at architecture_review during a daemon build. The plan carries a test pinning a daemon-shaped worktree with no added ADRs | APPROVED by operator 2026-10-10 |
| A6 | One canonical table form is enough because only new ADRs are bound; no legacy shape needs to be accepted | inferred | 90% | no | Authors push for bullet-list ledgers; the template removes the ambiguity | — |

## Consequences

### Positive
- An ADR cannot land, or pass `/conduct` architecture review, without declaring its assumptions or
  explicitly stating it has none.
- Operator approval of each unverified load-bearing assumption is visible in the artifact and
  checkable by any later reader or gate.
- One parser owns the grammar; future consumers inherit it.

### Negative
- Specs mid-DECIDE when this ships must add a ledger to their new ADRs before landing.
- `architecture_review` failures that were silently skipped in auto mode now halt.
- Hand-merged spec PRs bypass the check (decision 7).
- Whether an assumption is load-bearing remains the author's and operator's judgement. The machinery
  checks shape and approval, not truth.

### Follow-up Actions
- If hand-merged specs that bypass land become a recurring source of unledgered ADRs, revisit
  decision 7 with operator approval rather than widening discovery ad hoc.
