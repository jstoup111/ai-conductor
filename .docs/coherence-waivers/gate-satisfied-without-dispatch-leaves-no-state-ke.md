Waives: outcome-3

Rationale: outcome-3 of jstoup111/ai-conductor#1587 asks that "a finish→build kickback whose
remedy changes nothing observable twice in a row is detected as non-converging and halts with the
specific unsatisfied predicate named, instead of cycling." This spec deliberately does not deliver
the halt half of that outcome, for two independent reasons established during DECIDE.

**It is refused by an approved decision.** `adr-2026-08-16-restore-the-current-head-publication-fence`
D5 states verbatim: "Bounding is inherited, not invented. No new counter, allowance, or cap is
introduced. The fence's redirect is an ordinary `kickback` from `finish`, already bounded by
`MAX_KICKBACKS_PER_GATE` through the durable ledger." A cumulative bound on the `finish` gate is
also outside the declared scope of `adr-2026-08-12-cumulative-build-review-convergence-bound` D6,
which limits cumulative-cap consultation to `build_review` and names only `prd_audit` and
`manual_test` as candidates for extension. Delivering outcome-3 as specified therefore requires
amending two approved ADRs, not writing code.

**The failure it guards is not evidenced.** A validation pass over 170 features in
`.daemon/evals-raw/features/` found five `implementation_evidence_invalid` blocks across four
features between 2026-08-21 and 2026-09-08. Every one self-recovered within a single lap: the
kickback caused a real BUILD dispatch, which wrote the step statuses, and the feature proceeded.
The clearest is `reclaim-orphaned-full-suite-lock-recovery-claims` on 2026-09-08 — blocked at
15:21:34, build dispatched at 15:21:35, shipped as PR #2444. No feature in the corpus exhibited
the non-converging cycle the outcome describes. The one recorded occurrence, in the issue itself
on 2026-08-15, followed an operator state reset that has not recurred.

The operator confirmed this narrowing on 2026-09-14 after reviewing that telemetry, having asked
explicitly that the issue be validated as still live before it was specced.

**What this spec does deliver from outcome-3.** The second half — "halts with the specific
unsatisfied predicate named" — is delivered as Story 2: the refusal and its kickback now name which
member (`build_review` or `test_suite`) is unsatisfied, carried as a typed field rather than the
current fixed sentence. Only the non-convergence detection and its halt are waived.

**Recorded for follow-up.** Condition 5 of
`.docs/decisions/architecture-review-2026-09-14-gate-satisfied-without-dispatch-leaves-no-state-ke.md`
records the cheaper, already-approved route: the `finish` gate calls
`captureKickbackToBuildContext('finish')` but never `checkKickbackToBuildEscalation('finish')`,
unlike every other kickback gate. Wiring that pair would deliver outcome-3's detection under
`adr-2026-07-13-kickback-build-no-op-escalation` D2 with no new counter and no ADR amendment. It
warrants its own intake issue and is not absorbed into this feature's scope.
