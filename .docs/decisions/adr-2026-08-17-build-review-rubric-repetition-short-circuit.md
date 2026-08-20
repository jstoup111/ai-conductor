# ADR: build_review short-circuits on a repeatedly-failing rubric, and every convergence halt names what repeated

**Date:** 2026-08-17
**Status:** WITHDRAWN (2026-08-20) — was APPROVED

> **Withdrawn 2026-08-20 by operator decision (#1652 → v1.1; #1718 covers the solution).**
> Not implemented. This ADR is retained as the historical record and because other features'
> artifacts cite it; it is **not** live guidance and `MAX_RUBRIC_FAILURES_BUILD_REVIEW` does not
> exist in the engine.
>
> D4's threshold of 4 was selected as "the only threshold in the sweep with complete separation" at
> 85% confidence over an **11-feature** corpus. Re-running the sweep over the current **20-feature**
> corpus separates at no threshold in 3–6: `rubric-cache-identity-is-sha-anchored` shipped clean
> with **6** per-rubric failures, while the cap-terminated `2026-08-13-implementation-drifts` peaks
> at **3**. D4's own stated residual — "corpus size and the labelling of spin versus healthy" — is
> what came due.
>
> The deeper fault is the key, not the number. It counts how *often* a rubric failed, not whether it
> failed on the *same thing*. `rubric-cache-identity` tautology failed 6 times across **7 distinct
> sites** (max repetition 1) — convergence; `shipped-record-timing` rootCause failed 4 times across
> **2 sites** with one repeating **4 of 4** — spin. D2 chose the rubric enum expressly to avoid
> finding identity ("Not the finding, the site, or any prose"), and that avoidance is why the key
> cannot tell the two apart.
>
> #1718 establishes that the dominant failure mode is **frontier expansion** — later laps opening
> new substance without repeating any — and assumes this ADR's machinery detects same-substance
> repetition. It does not. As specified, this design would terminal-HALT exactly the converging
> features #1718 exists to protect.
>
> Any re-spec should key on same-substance repetition, and must account for the #1611 identity drift
> D2 was avoiding — most likely mechanical bookkeeping plus an LLM equivalence judgement. See #1652
> for the full corpus replay.

**Deciders:** Engineer (DECIDE phase, #1652), operator-confirmed — including an explicit operator
override of a recommendation to descope (D9), and an operator direction to re-key the bound onto
whatever the corpus showed carried real value, which produced D2.
**Relates to:** `adr-2026-08-12-cumulative-build-review-convergence-bound.md` (#1521 — the bound this
one composes with, and which nominated exactly this key as its own strongest follow-up),
`adr-2026-07-26-cross-dispatch-kickback-livelock-bound.md` (#984 — the ledger and the reset rule),
`adr-2026-07-13-kickback-build-no-op-escalation.md` (#647 — the D2 no-op escalation, unchanged),
`adr-2026-07-23-build-review-fresh-base-disposition.md` (the stale-base exit that must precede this
one), `adr-2026-08-16-closed-build-review-finding-vocabularies.md` (#1611 — whose D6 governs the
block's exits), `adr-2026-08-13-engine-managed-build-review-rubric-branches.md` (D7's cache
re-stamp, the fact that falsified the first design),
`adr-2026-08-05-build-settle-outcome-stamp.md` (the "a counter change cannot make the first repeat
free" objection, answered in Alternatives)
**Supersedes:** nothing. **Does not change:** `MAX_KICKBACKS_PER_GATE`'s value or meaning, the
per-tree reset rule, `MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW`'s value, the PASS-reset semantics of
`cumulative`, D2's escalation, any rubric's PASS/FAIL judgement, finding identity, the disposition
store's schema, or completion derivation.

## Context

Issue #1652. On 2026-08-16 two builds spun and only the operator noticed. The first ran nine
`build_review` kickbacks; the second flagged one test on four consecutive laps under three different
concern kinds. The operator asked "is it cycling?" four times that day and answered it each time by
hand from lap archaeology.

**The existing bound is not missing — it is both late and largely unreachable.** Reconstructed from
the aggregates embedded in `step_failed` events across 11 features with `build_review` kickback
history (`.daemon/evals-raw/features/*/events.jsonl` plus the live worktrees):

| feature | kickbacks | PASSes | cumulative cap fired |
|---|---|---|---|
| `loop-halt-never-reaches-events-jsonl` | 16 | 1 | no |
| `stale-manual-test-discovered-at-finish` | 10 | 1 | yes |
| `finish-publication-burns-its-retry-budget` | 9 | 1 | no |
| `rubric-cache-identity-is-sha-anchored` | 9 | 2 | no |
| `out-of-plan-production-edits` | 7 | 0 | no |
| `harden-intake-ledger-durability` | 6 | 2 | no |
| `live-daemon-e2e-tier-covers-only-claude` | 5 | 0 | yes |
| `tautology-fails-are-unfixable` | 5 | 1 | no |
| `remediation-repairs-are-blind` | 3 | 1 | no |
| `plan-over-prescription` | 3 | 1 | no |
| `off-tag-checkout-reports-up-to-date` | 1 | 0 | no |

Five features exceeded the cap's nominal threshold of five kickbacks and **the cap fired on two of
eleven**, because `adr-2026-08-12` D2 resets `cumulative` on a `build_review` PASS and each of those
runs contained at least one. That reset is deliberate and this ADR does not reopen it — but it means
`cumulative` does not bound a feature that intermittently passes, which is the shape every long spin
in the corpus took.

Confidence 95%, basis: verified — the reconstruction above, plus `kickback-ledger.ts:35,180`,
`conductor.ts:7603-7618`, and the `loop_halt` records in each feature's ledger.

### The measurement that killed two earlier designs

The intake's first hypothesis was that the persisted lap directories already carry every signal.
Counting them appeared to confirm it — one site flagged in 8 of 11 laps. That number is an artifact:
`adr-2026-08-13` D7 stamps a cache hit's prior result into the current lap's artifact, and a
provenance census found 36 of 44 rubric artifacts on the incident feature, and 20 of 20 on another,
were re-stamps. **`lap-*` directories are not a counting unit** — they are content-addressed by input
digest (D2), not chronological.

A second design keyed a per-**site** tally (the rubric's typed anchor subject) on consumed kickbacks.
That survives the re-stamp problem but does not measure spinning. Over the same 11 features, at its
best threshold it fired on **2 of the 5 features that actually spun** — and missed
`finish-publication`, the episode #1652 was filed about, which ran nine kickbacks with a maximum site
repeat of two. Sites move as remediation fixes them; that is convergence, not spin.

## Decision

### D1 — A per-rubric failure tally on the gate's ledger entry

`KickbackGateEntry` gains `rubricFailures: Record<string, number>`. `count` and `cumulative` keep
their exact current semantics. The three fields answer three different questions:

| Field | Question | Reset by |
|---|---|---|
| `count` | Was this lap a no-op over an unchanged tree? | any tree change or resolved-count increase |
| `cumulative` | How many laps has this gate spent in total? | a `build_review` PASS |
| `rubricFailures` | Is one rubric failing over and over? | a `build_review` PASS |

Read tolerance mirrors `adr-2026-08-12` D1 exactly: `isKickbackGateEntry` treats an absent
`rubricFailures` as a legacy entry and folds it to `{}` rather than rejecting the ledger, so a
feature in flight when this ships gets a fresh tally, never a spurious halt. The record is bounded by
construction — there are four rubrics — so no capacity or eviction rule is needed.

### D2 — The key is the rubric, chosen on measured separation

One consumed kickback increments the tally for each rubric that contributed at least one **unresolved**
finding to this lap's effective verdict.

This is the key `adr-2026-08-12` itself nominated: "halt when the same rubric item fails N
consecutive times regardless of tree movement … Genuinely attractive: it measures semantic
convergence directly rather than proxying it by lap count … Recorded as the strongest candidate for a
future refinement, and it composes with this bound rather than replacing it." This ADR is that
refinement.

Measured over all 11 features, classifying the five with operator-reported or cap-terminated spin
against the six that converged:

| key | threshold | fires on spin | fires on healthy | kickbacks avoided |
|---|---|---|---|---|
| per-rubric failures | 4 | **5 of 5** | **0 of 6** | 14 |
| per-rubric failures | 3 | 5 of 5 | 2 of 6 | 21 |
| per-rubric failures | 5 | 4 of 5 | 0 of 6 | 9 |
| consecutive same-rubric run | 4 | 5 of 5 | 0 of 6 | 10 |
| per-site repetition | 3 | 2 of 5 | 0 of 6 | 6 |

**Non-consecutive, not a run.** A consecutive-run key scores the same on separation but avoids fewer
kickbacks, because a rubric that alternates in and out resets it. `adr-2026-07-26` D3's objection to
lap counting — "a grader that alternates between two rubric items would evade it" — applies to the
consecutive variant and not to the total.

**Not the finding, the site, or any prose.** The rubric name is an engine-supplied enum from the
rubric registry, not grader output, so `adr-2026-07-26` D3's finding that build_review reasons are
never byte-stable across laps cannot touch it. Nothing about finding identity, dispositions, or
`adr-2026-08-16`'s vocabularies is read or affected; the earlier site-keyed design had to argue
against that ADR's rejection of path-level collapse, and this one does not.

### D3 — The tally ticks on consumed kickbacks, from the current lap's own join

Unresolved-ness comes from `resolveEffectiveBuildReviewVerdict`'s `unresolvedFindingIds`, read under
the disposition store's existing lease. A rubric whose findings are all operator-accepted does not
tick: accepted is neither skipped nor passed. A rubric that settled as an infrastructure failure does
not tick either — that is #1629's territory and a mechanical fault is not semantic churn.

Two properties follow:

- **Immune to cache re-stamp inflation.** A tick is one real backward move, not one artifact.
- **No stale-verdict authority.** Unresolved-ness is re-derived from the current round's join and
  never concluded from a prior lap's file, per `adr-2026-08-03-build-repair-member-reuse-validity`'s
  invariant that "no on-disk gate verdict, step status, or timestamp is sufficient authority on its
  own", and per `architecture-review-2026-07-08-post-rebase-gate-first-reverify`.

A lap the fresh-base disposition discards never reaches the tally, because D6 places this exit after
it.

### D4 — Threshold 4, and exceeding it is a `needs-human` HALT

`MAX_RUBRIC_FAILURES_BUILD_REVIEW = 4`. When any rubric's tally reaches it, the conductor writes a
`needs-human` halt naming the rubric, its failure count, the sites it most recently flagged, and the
cumulative budget state.

**Why 4 — measured, not assumed.** It is the only threshold in the sweep above with complete
separation: every spinning feature trips it and no healthy feature does. At 3, two healthy features
trip; at 5, `live-daemon-e2e` is missed. Confidence **85%, basis: verified** over an 11-feature
corpus. The residual 15% is corpus size and the labelling of "spin" versus "healthy", which rests on
operator reports and cap terminations rather than an independent oracle.

This is a materially stronger basis than the 55% the withdrawn site-keyed design carried, and than
the 70% `adr-2026-08-12` recorded for its own cap of 5.

`needs-human` is chosen, not defaulted. `daemon-rekick.ts:173-193` skips a `needs-human` halt on
every sweep while `mechanical` and `unclassified` halts are cleared and re-dispatched; a guard whose
halt the daemon auto-clears is not a guard. `adr-2026-07-28-total-halt-classification-legacy-boundary`
permits only `needs-human` or `mechanical` for a new writer and requires `needs-human` whenever retry
safety is not mechanically provable.

**Accepted cost:** a feature whose fourth failure of one rubric would have resolved on the fifth now
waits for an operator. On this corpus that case does not appear; the cost is real but unobserved.

### D5 — PASS-reset semantics are unchanged

`rubricFailures` resets on a `build_review` PASS, exactly as `cumulative` does under `adr-2026-08-12`
D2, and for that ADR's stated reason: a feature that legitimately passes, is later invalidated by a
rebase, and re-enters must not carry stale laps toward a halt it did not earn.

This was verified rather than assumed. The sweep was run twice — with the reset and without it — and
produced **identical results on every feature**: 5 of 5 spin, 0 of 6 healthy, 14 kickbacks avoided.
Keeping the reset therefore costs nothing measurable and avoids amending an approved decision.

The Context table's observation — that the cap fires on 2 of 11 features because one PASS clears
`cumulative` — is recorded there as motivation for a *per-rubric* counter, not as a proposal to
change the reset. Whether `cumulative` should also carry a never-reset floor is `adr-2026-08-12`'s
question and is left to it.

### D6 — Ordering inside the FAIL block

The new exit sits **after** the fresh-base disposition (`adr-2026-07-23` — findings graded on a stale
base are discarded and must not tick), **after** the D2 no-op escalation, **after**
`consumeKickbackBudget`, and **after** the cumulative-cap check.

Cap-first is not a preference. `adr-2026-07-27-daemon-decide-kickback-halt` fixes it so "a daemon run
that trips the cap still reports the *ping-pong* reason rather than being masked by the phase
reason", and `adr-2026-08-16` D6 preserves it while requiring each HALT keep a distinct reason and its
class argument. On the corpus the two rarely compete — the cap fired on 2 of 11 features and this
bound trips earlier in both — and where both would fire on one lap the cap wins and D7 renders the
rubric table into *its* body, so nothing is lost.

`adr-2026-08-16` D6 also requires the block's exit set be **derived by grep at implementation time**
rather than enumerated by hand, and the effective-verdict predicate be consulted **at** each exit
rather than hoisted once. Both apply unchanged.

### D7 — Every convergence halt renders what repeated

The table — rubric, failure count, the sites that rubric most recently flagged, and cumulative budget
state — is rendered into the halt body of the new exit **and** of the existing cumulative-cap halt.
Rendering lives in a pure function over the ledger entry and the current lap's findings, returning
prose to the existing `writeHaltMarker` call site, per
`adr-2026-08-08-finish-human-required-halt-rendering`.

The sites are included because they are what an operator rules on; they are **reported, never counted**.
The body may state only what the tally established, and never that the run "is spinning" or "cannot
converge" (`adr-2026-08-05-worktree-classification-evidence-derived-reasons`).

This is the half of the feature that delivers issue outcome 2. It ships on the cap path too, so it is
delivered even where the new bound never fires — which on this corpus is 6 of 11 features.

### D8 — `rubricFailures` on the `kickback` event

The `kickback` member of `ConductorEvent` gains an optional `rubricFailures` field carrying the
tallies after this kickback. `loop_halt` carries the same figures in its reason text via the central
`Conductor.emitLoopHalt`.

Per the event-spine skill, the durable tally is legitimate state under exception C — read by name by
its own writer as a control input — **only because the occurrence is also emitted**; a counter living
solely in gitignored `.pipeline/` state would force an operator to read a per-worktree file to
reconstruct that a feature was failing to converge, which §3's corollary names as a parallel channel
wearing an existing file as a disguise. This is the identical reasoning and field shape
`adr-2026-08-12` D5 applied to `cumulativeCount`.

No new event variant: `adr-2026-08-11-halt-events-ride-the-persisted-spine` rejected per-emit-site
halt payloads. `adr-2026-07-26-event-sink-registry-exhaustiveness` requires the additive field's sink
decision to be explicit.

### D9 — Scope: `build_review` only, and the operator directions

Only the `build_review` kickback site consults the tally. `prd_audit` and `manual_test` are the
natural next candidates; `adr-2026-08-12` D6 deliberately left them for whichever issue produces the
evidence, and that reasoning is adopted unchanged. `test_suite` is excluded for the further reason
that no per-round failing-test history exists to key on.

**Two operator directions shaped this ADR and are recorded rather than absorbed.** DECIDE first
recommended descoping to D7 alone, because no evidence then available showed repetition separating
spin from convergence; the operator directed that the short-circuit ship regardless. DECIDE then
reported that the site key it had chosen fired on only 2 of 5 spinning features and missed the filed
incident; the operator directed that the key be fixed to whatever the corpus showed carried real
value. The second direction is why D2 exists and why D4's confidence is 85% rather than 55%.

## Alternatives considered

- **Per-site repetition** (the withdrawn design, and the intake's "same test file or finding site
  failing N times"). Rejected on measurement: 2 of 5 spinning features, and it misses
  `finish-publication` entirely. Sites move as remediation fixes them, so repetition at a site is as
  consistent with convergence as with spin. It also had to argue past `adr-2026-08-16`'s rejection of
  path-level collapse; the rubric key does not.
- **Consecutive same-rubric run.** Same separation as the chosen key but avoids 10 kickbacks against
  14, because a rubric that alternates in and out resets the run — the evasion `adr-2026-07-26` D3
  warned about.
- **Globbing `.pipeline/build-review/lap-*` for repeat counts** — the intake's first hypothesis.
  Rejected on the provenance census: lap directories count cache re-stamps. It also collides with
  `adr-2026-08-12`'s rejected "derive the count at decision time" alternative ("state belongs in the
  state file; the event is the observation of it").
- **Raising the cumulative cap, or removing its PASS reset.** Not needed: D5's twin sweep shows the
  per-rubric key performs identically with the reset in place, so the approved semantics stand.
  Whether `cumulative` should additionally carry a never-reset floor is a real question the Context
  table raises and is left to `adr-2026-08-12`.
- **A bounded LLM convergence judge.** Rejected: `adr-2026-08-12`'s consequences record "no LLM is in
  the bound's decision path" as a preserved property; `adr-2026-07-21-demote-task-stamping-to-telemetry`
  records that this repository's answer to a failing machinery class is removal rather than another
  guard; and it puts a provider call inside the loop #1629 already reports as fragile.
- **A wall-clock kickback-rate window** (the intake's third signal). Rejected as forbidden: no
  approved decision sanctions a wall-clock signal in a control path,
  `adr-2026-07-10-intra-step-build-progress-events` confines the engine's only time-based threshold to
  observability, and a rate trigger is not reproducible run-to-run.
- **Test-weakening detection** (the intake's second hypothesis). Genuinely a spin signal, but the
  tautology rubric already grades assertion strength, and it needs `test_suite` per-round history that
  does not exist. Left to a follow-on.
- **A definite-match pre-dispatch refusal instead of a counter.**
  `adr-2026-08-05-build-settle-outcome-stamp` rejected "add a second counter" with "a counter change
  cannot make the first repeat free". Answered: its remedy requires an identical tree, and here the
  tree moves every lap by construction (that is why `count` resets), so its refusal can never fire on
  this class. The two are complementary.

## Consequences

- **Positive.** Every spinning feature in the corpus terminates, on average four kickbacks earlier —
  14 kickbacks avoided across five features, the largest saving being 6 of 10 on
  `stale-manual-test`. Both convergence halts now name what an operator has to rule on, removing the
  lap archaeology #1652 was filed about. Detection stays fully deterministic; no LLM enters the
  decision path. The tally lives in the durable ledger `adr-2026-07-26` established, and is immune to
  the cache re-stamp that defeats every artifact-scanning design.
- **Preserved invariants.** `MAX_KICKBACKS_PER_GATE` and `MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW` keep
  their values and meanings; the per-tree reset rule and `cumulative`'s PASS reset are untouched; D2's
  no-op escalation is untouched; cap-first ordering holds; finding identity, the disposition store,
  and every rubric's PASS/FAIL judgement are unchanged; a legacy ledger reads clean.
- **Negative / watch.** The corpus is 11 features and the spin/healthy labelling rests on operator
  reports and cap terminations, not an independent oracle — that is the 15% in D4. A feature that
  legitimately needs a fifth lap on one rubric now halts; unobserved on this corpus. The bound is
  coarse by design: it names a rubric, not a defect, so the operator still rules on substance — which
  is what outcome-2 asks for.
- **Known limitation (#497 class), accepted.** `.pipeline/` is gitignored, so deleting
  `.worktrees/<slug>` resets the tally. This fails open — a fresh budget, never a spurious halt —
  identical to the limitation `adr-2026-07-26` and `adr-2026-08-12` both accepted.
- **Follow-on surfaced during DECIDE, filed separately.** `priorAttemptPointers`
  (`remediation-context-pointers.ts:77`) keys #1620's same-site pointers on the whole canonical
  anchor, including free prose subjects. Measured over 67 graded-FAIL laps, a whole-anchor match to a
  prior lap occurred in 4 laps (6%) against 20 (30%) for a prose-free key, so those pointers fire
  rarely. Filed as jstoup111/ai-conductor#1693.
