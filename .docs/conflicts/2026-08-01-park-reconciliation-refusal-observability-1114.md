# Conflict Check: park-reconciliation refusal observability (#1114)

Date: 2026-08-01
Stories: S1–S6
Verdict: **CLEAR to plan** — no blocking conflicts. Four contract collisions identified, each with a
resolution folded into the plan.

## Method

Cross-checked S1–S6 against each other, against the contracts asserted by the four existing
parked-reconciliation test files, against the two live ADRs governing park deletion, and against the
operator-facing docs that document the current refusal vocabulary.

## Inter-story

No contradictions. S1 defines the taxonomy; S2 enriches one member of it; S3/S4 consume it for
counting; S5 constrains all of them with an invariant; S6 records them. S5 is deliberately a
*constraint* on S1–S4 rather than a peer feature — it must be implemented as a characterization test
written **before** the taxonomy change, or it cannot prove anything about the prior behavior.

## Contract collisions with existing code and tests

### C1 — `not-ancestor` is asserted verbatim in six places (BLOCKING if unhandled)

`test/engine/park-reconciliation.test.ts` asserts the literal string in its refusal table (`:141-181`)
and in four squash-merge cases (`:225`, `:294`, `:321`, `:349`).
`test/acceptance/parked-feature-reconciliation.acceptance.test.ts:862` matches `/ancestor/i` against
operator output.

*Resolution:* every site is re-pinned to the specific new reason its scenario actually produces —
`:294` (branch advanced past merge) → `unmerged-commits`; `:321`/`:349` (gh unavailable, tip
unresolvable) → `no-merge-proof` / `ancestry-check-failed`; `:225` → `no-merge-proof`. The acceptance
regex must become a specific-reason assertion. **Loosening any of these to a wildcard is forbidden** —
it would delete the negative-path coverage that keeps the deletion gate honest.

### C2 — Two ADRs both constrain park deletion

`adr-2026-07-27` §3 (ancestry is sole authority) and `adr-2026-07-29-defer-feature-worktree-reap…`
(reap deferred until the shipped record is on main) overlap on when a worktree may be removed.

*Resolution:* no conflict in substance. The 07-29 ADR constrains *timing*, the 07-27 ADR constrains
*authority*. `adr-2026-08-01` amends only the authority clause and explicitly leaves the
record-as-precondition intact, which is what 07-29 depends on. Both remain APPROVED.

### C3 — `.docs/specs/2026-07-04-operator-park.md:31-41` carries an inline amendment naming the auto-unpark exception

That spec's Non-Goals were amended by the 07-27 ADR to permit exactly one autonomous unpark path.

*Resolution:* untouched. This feature adds no unpark path and removes none; the exception's wording
("ancestry-proven-merged park") is now imprecise for the same reason §3 was, so the plan adds a
one-line pointer to `adr-2026-08-01` rather than rewording the exception's scope.

### C4 — Dashboard renders the sweep with `autoCleanup: false`

`daemon-cli.ts:1607-1612` runs an observational pass; `:1615-1623` maps annotations.

*Resolution:* the dashboard pass refuses nothing because it never calls the helper, so `refused`
will be 0 there by construction. The plan must not present that 0 as evidence of health — the
annotation map keeps its existing `merged-ready` label, and the refusal breakdown is a
daemon-loop-only signal. Called out so it is not mistaken for a bug during review.

## Resource and state contention

- **Single guarded helper** — both call sites keep funnelling through `reconcileMergedPark`; no new
  delete path is introduced, so the single-writer audit (`park-marker-invariant.test.ts:83`) needs
  no re-scoping this time.
- **Per-pass caches** — `parkedSweepCache` and `sweepSummarySignatures` are both touched by S3/S4.
  S4 must land with or after S3, or the signature will be written against fields that do not yet
  exist. Encoded as a plan dependency.
- **`gh` call volume** — unchanged. The taxonomy reuses the single `pr list … --limit 1` call
  `isSquashMergedAtTip` already makes; S2's `git log` runs only on the branch that call already
  identified.

## Out of scope, confirmed non-overlapping

The merge→shipped-record reconciler gap the intake issue mentions in passing (merged work that never
gets a record, e.g. `2026-07-25-codex-auth-sandbox-permission-readiness-905`) is a genuinely separate
defect — those slugs never classify as `merged` at all, so they never reach the refusal path this
feature changes. Not addressed here.
