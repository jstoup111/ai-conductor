# Architecture Review: Halt-PR presentation reliability

**Date:** 2026-07-05
**Mode:** Lightweight (Medium tier — Feasibility + Alignment)
**Track:** technical
**Input:** explore output + technical intent (ai-conductor#274); sequence diagram
`.docs/architecture/sequences/halt-pr-reliability.md`
**Verdict:** APPROVED

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | ✅ No new deps. All primitives are existing `gh` CLI/REST calls already used in `pr-labels.ts`. `gh pr ready --undo` (draft conversion) and `gh pr list --json body,isDraft,labels,state` verified available. |
| Prerequisites | ✅ None. No migration, no config, no external account setup. Draft PRs already work on this repo (#267 is a draft). |
| Integration surface | ✅ Bounded: one existing seam (`pr-labels.ts`), one existing escalation path (`build-failure-escalation.ts`), one new sweep wired into `runDaemon` via the ADR-013 injected-dep hook, plus the two existing finish-time clear paths. No new module boundaries crossed. |
| Data implications | ✅ None. No schema, no persistence beyond GitHub PR state itself. |
| Performance risk | ✅ Low. Sweep adds one `gh pr list` per startup + idle tick, bounded by `--limit`, best-effort and non-throwing. Verify-after-write adds a bounded re-read per escalation. |
| Worktree isolation | ✅ Unaffected — operates on remote GitHub PR state, not local ports/DBs/files. The reconciliation heals *cross-checkout* breakage (a strength, not a conflict). |

**Load-bearing claims verified (verify-claims):**
- `gh pr ready --undo <url>` converts a PR to draft — verified (`gh pr ready --help`) + observed
  (#267 draft). 95%.
- Open PRs are enumerable with bodies/draft/labels — verified (`gh pr list --json`). 97%.
- Reuse-of-ready-PR is the #268/#269 root cause — inferred from `findOrCreatePr` reuse logic +
  the observed "non-draft, zero labels" symptom. 80% (does not change the design — the fix
  re-asserts state on the reuse path regardless of the exact historical cause).

No unconfirmed load-bearing assumption remains that would change the decision.

## Alignment

- **Pattern consistency:** ✅ Reuses the injected-`GhRunner` seam and the ADR-013 injected-dep
  hook pattern for daemon wiring — same shape as the existing `sweepMergeableLabels`. No new
  pattern introduced.
- **REST-not-`gh pr edit`:** ✅ Preserves the PR #172 decision (label writes via
  `gh api .../issues/N/labels`, never `gh pr edit --add-label`).
- **Idempotence / convergence:** ✅ `ensureHaltPresentation` asserts desired state only — safe to
  call from both escalation and the sweep. The sweep is additive (never removes label / flips
  ready); removal stays the finish-time job. This keeps the two loops non-conflicting.
- **Best-effort contract:** ✅ New helper never throws; on retry exhaustion it defers to the sweep,
  preserving the seam's swallow-and-continue contract.
- **Marker placement:** ✅ Body marker is an HTML comment (invisible in rendered Markdown), removed
  at finish so a rehabilitated PR is not re-halted — the loop closes.
- **Security boundaries:** ✅ No new endpoints, inputs, or trust boundaries; acts only on the
  daemon's own PRs via already-authenticated `gh`.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Sustained rate-limit exhausts inline verify-after-write | Integration | Medium | Medium | Reconciliation sweep re-asserts on next startup/tick; both are best-effort/non-throwing |
| Draft conversion unsupported on some future repo/plan | Integration | Low | Medium | Confirmed supported here (#267); helper logs + defers rather than throwing if `--undo` fails |
| Body-marker collision with human-authored PR body text | Data | Low | Low | Marker is a namespaced HTML comment string; write is idempotent (no duplicate) |
| Reconciliation races finish-time rehabilitation on the same PR | Integration | Low | Low | Finish removes the body marker; sweep enumerates by marker, so a finished PR drops out of scope |

No High-impact risk registered.

## ADRs Created

- `adr-2026-07-05-halt-pr-presentation-reliability.md` — **APPROVED** (operator selected Approach A,
  including the body-marker anchor). Captures D1–D5.

## Verdict

**APPROVED.** Proceed to `/stories`. One ADR drafted and approved → review marker written.
