# ADR: build_review short-circuits on a repeated unresolved site, and every convergence halt names what repeated

**Date:** 2026-08-17
**Status:** APPROVED
**Deciders:** Engineer (DECIDE phase, #1652), operator-confirmed — including an explicit operator
override of a recommendation to descope, recorded in D9.
**Relates to:** `adr-2026-08-12-cumulative-build-review-convergence-bound.md` (#1521 — the bound this
one composes with, and which named this refinement as its own strongest follow-up),
`adr-2026-07-26-cross-dispatch-kickback-livelock-bound.md` (#984 — the ledger and the reset rule),
`adr-2026-07-13-kickback-build-no-op-escalation.md` (#647 — the D2 no-op escalation, unchanged),
`adr-2026-07-23-build-review-fresh-base-disposition.md` (the stale-base exit that must precede this
one), `adr-2026-08-16-closed-build-review-finding-vocabularies.md` (#1611 — the anchor field
taxonomy this borrows, and whose D6 governs the block's exits),
`adr-2026-08-13-engine-managed-build-review-rubric-branches.md` (D7's cache re-stamp, the fact that
falsified the first design), `adr-2026-08-05-build-settle-outcome-stamp.md` (the "a counter change
cannot make the first repeat free" objection, answered in Alternatives)
**Supersedes:** nothing. **Does not change:** `MAX_KICKBACKS_PER_GATE`'s value or meaning, the
per-tree reset rule, `MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW`'s value, D2's escalation, any rubric's
PASS/FAIL judgement, finding identity, the disposition store's schema, or completion derivation.

## Context

Issue #1652. On 2026-08-16 two builds spun and only the operator noticed. The first ran eight
kickbacks in under two hours and ended here:

```text
loop_halt  build_review cumulative kickback cap exceeded (cumulative 6, cap 5):
           [completeness] missing_deliverable
           [completeness] missing_deliverable
```

**The bound was not missing.** `adr-2026-08-12` is APPROVED, implemented, enabled by default, and it
terminated the run. Two properties of that termination are the defect:

1. It arrives at lap 6, after the budget is gone.
2. It names nothing actionable. `lastReason` is the raw grader excerpt — a rubric and a concern
   kind. It does not say **which site** kept failing, which is the question the operator asked four
   separate times on 2026-08-16 and answered each time by hand from lap archaeology.

Confidence 99%, basis: verified — the `loop_halt` record above, read from
`.worktrees/stale-manual-test-…/.pipeline/events.jsonl`, plus `kickback-ledger.ts:35,180` and
`conductor.ts:7603-7618`.

### Why the run re-enters at all

`bumpKickbackGate` (`kickback-ledger.ts:166-167`) computes `madeProgress` from tree movement, and
every remediation lap commits real work, so `count` resets to 1 each lap and the per-tree bound is
unreachable. `adr-2026-07-26` D1 chose that fail-open behaviour deliberately. Only `cumulative`
survives, and by construction it measures **volume, not direction** — it cannot distinguish six laps
closing six different defects from six laps re-litigating one.

### The measurement that killed the obvious design

The intake's first hypothesis was that "the persisted lap dirs plus the kickback ledger already
carry every signal", so a comparator over `.pipeline/build-review/lap-*/<rubric>.json` would need no
new data. Counting those directories appeared to confirm it — one site flagged in 8 of 11 laps.

That number is an artifact. `adr-2026-08-13` D7 states that a rubric **cache hit stamps a previously
validated result into the current lap's artifact**. Filtering on `provenance.kind`:

| feature | lap dirs | fresh judgements | cache re-stamps |
|---|---|---|---|
| `stale-manual-test-discovered-at-finish-is-unroutab` | 11 | 2 | 36 of 44 rubric artifacts |
| `live-daemon-e2e-tier-covers-only-claude-no-real-ag` | 5 | 0 | 20 of 20 |

Eight of those eleven "laps" were one judgement re-stamped. So were the counts that briefly looked
like a fatal false-positive. **`lap-*` directories are not a counting unit** — they are
content-addressed by input digest (`adr-2026-08-13` D2), not chronological, and a cache hit mints
one without a new judgement. Any detector that globs them measures cache behaviour.

Confidence 95%, basis: verified — the provenance census above over both worktrees on disk, plus
`adr-2026-08-13` D2 and D7.

**Consequence for this ADR:** the largest genuine sample available anywhere is two fresh rubric
judgements. No threshold in this decision can be calibrated from data. That is stated as the
assumption it is, and D5 is its remedy.

## Decision

### D1 — A per-site repetition tally on the gate's ledger entry

`KickbackGateEntry` gains `siteRepeats: Record<string, number>`. `count` and `cumulative` keep their
exact current semantics. The three fields answer three different questions and are deliberately not
merged:

| Field | Question | Reset by |
|---|---|---|
| `count` | Was this lap a no-op over an unchanged tree? | any tree change or resolved-count increase |
| `cumulative` | Has this gate converged at all? | a `build_review` PASS |
| `siteRepeats` | Is one site failing over and over? | a `build_review` PASS |

Read tolerance is load-bearing and mirrors `adr-2026-08-12` D1 exactly: `isKickbackGateEntry` treats
an absent `siteRepeats` as a legacy entry and folds it to `{}` rather than rejecting the ledger. A
feature in flight when this ships gets a fresh tally, never a spurious halt.

**The tally is bounded.** Sites are unbounded in principle, so the record caps at a fixed number of
entries and evicts the lowest count on overflow (ties broken by insertion order). An unbounded map
on a durable ledger is a growth defect, and eviction biased toward *keeping* high counts is the
direction that preserves the signal.

### D2 — The site key is the rubric's typed anchor subject

`siteOf(finding)` returns the subject field of the finding's typed anchor:

| rubric | site |
|---|---|
| `scope` | `anchor.path` |
| `tautology` | `anchor.changedTest` |
| `rootCause` | `anchor.locus` |
| `completeness` | `anchor.planTask` |

These are exactly the fields `adr-2026-08-16` designates as **engine-verifiable references** against
the immutable snapshot, as distinct from the closed classification vocabularies and from the free
prose subjects it moves out of identity.

**Not `evidenceLocations`,** which an earlier draft of this design proposed.
`adr-2026-08-13-stable-build-review-finding-dispositions` classes it as presentation and excludes it
from identity ("summary wording and line numbers are deliberately excluded"), and `adr-2026-08-16`'s
verified-reference list does not contain it. Keying a terminal control decision on an unverified
presentation field contradicts both.

**Not the whole anchor.** The anchor carries free prose subjects (`exercisedBehavior`,
`statedDefect`, `missingOutcome`) that the grader re-words every lap, which is the drift #1611
exists to stop and which `adr-2026-07-26` D3 already established makes grader text useless as a
bound key. Measured over the laps on disk, whole-anchor equality repeats **zero** times.

**Deliberate consequence: the key is coarser than identity.** Two materially different findings at
one site across two kickbacks read as one repeat. `adr-2026-08-16` rejected path-level collapse for
*identity*, where collapse grants an acceptance blanket immunity over a file — a High-impact risk its
companion review named. **The consequence direction is opposite here.** On the identity side
collapse causes silent over-acceptance; on this side it causes a conservative `needs-human` halt
that a human then rules on. That asymmetry is the entire argument for reusing a key that decision
rejected, and it is why this ADR may not be read as reopening it.

### D3 — The tally ticks on consumed kickbacks, from the current lap's own join

One consumed kickback increments the tally for each site named by a finding that is **unresolved in
this lap's effective verdict** — `resolveEffectiveBuildReviewVerdict`'s `unresolvedFindingIds`, read
under the disposition store's existing lease. A site named only by an operator-accepted finding does
not tick: accepted is neither skipped nor passed, and it is not a repeat.

Two properties follow, and both are the reason this shape was chosen over a scan:

- **Immune to cache re-stamp inflation.** A tick is one real backward move, not one artifact. The
  census in Context is exactly the failure a scan-based design would inherit.
- **No stale-verdict authority.** Unresolved-ness is re-derived from the current round's join and
  never concluded from a prior lap's file, per
  `adr-2026-08-03-build-repair-member-reuse-validity`'s binding invariant that "no on-disk gate
  verdict, step status, or timestamp is sufficient authority on its own", and per
  `architecture-review-2026-07-08-post-rebase-gate-first-reverify`, which establishes that a
  `build_review` artifact does not attest the current tree.

A lap the fresh-base disposition discards never reaches the tally, because D6 places this exit after
it.

### D4 — Threshold 3, and exceeding it is a `needs-human` HALT

`MAX_SITE_REPEATS_BUILD_REVIEW = 3`. When any site's tally reaches it, the conductor writes a
`needs-human` halt whose reason names the site, its repeat count, the rubrics that raised it, and
the cumulative budget state.

**Why 3, stated as the assumption it is.** The cumulative cap halts at lap 6; a threshold of 3 trips
at roughly half the spend, which is the point of the feature. Below 3 it would fire on a site
legitimately revisited once. Above 3 it rarely pre-empts the cap it exists to pre-empt, and the
feature is inert. This is a judgement, not a measurement — **confidence 55%, basis: inferred** from
the incident timeline and the existing `MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW = 5` and
`MAX_KICKBACKS_PER_GATE = 2` precedents. It is materially *less* evidenced than `adr-2026-08-12`'s
cap of 5, which itself carried 70%, because the census in Context shows the corpus that would
calibrate it does not exist. D5 is the direct consequence.

`needs-human` is chosen, not defaulted. `daemon-rekick.ts:173-193` skips a `needs-human` halt on
every sweep while `mechanical` and `unclassified` halts are cleared and re-dispatched; a guard whose
halt the daemon auto-clears is not a guard. `adr-2026-07-28-total-halt-classification-legacy-boundary`
permits only `needs-human` or `mechanical` for a new writer and requires `needs-human` whenever
retry safety is not mechanically provable. It is not provable here.

**Accepted cost:** a feature whose third repeat at one site would have resolved on the fourth now
waits for an operator. This is the same trade `adr-2026-08-12` D3 and `adr-2026-07-26` D4 both
accepted, taken knowingly at a weaker evidence base.

### D5 — Config-gated, default on, with a written exit condition

A new optional block under the existing `build_review` config subtree resolves to enabled when
absent, mirroring `CumulativeKickbackBoundConfig` (`types/config.ts:316`). It carries `enabled` and
the threshold. `enabled: false` restores today's behaviour byte-for-byte: no tally is consulted and
the new halt path is unreachable. Validation is fail-closed on an out-of-range or non-integer
threshold — `adr-2026-07-03-pr-timing-config-key` requires a typo to hard-error rather than silently
disable a guard.

`adr-2026-08-12` D4 made this mandatory for exactly this class, on the ground that "a wrong cap
value can produce a false halt … and a false `needs-human` halt on a converging feature is the
expensive failure direction". D4's 55% confidence makes it more necessary here, not less.

**Exit condition**, per `adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag` ("a flag
with no exit condition becomes permanent by default"): once `repeatedSites` telemetry (D8) has
covered at least ten features that reached three or more consumed `build_review` kickbacks, the
threshold is re-derived from that corpus and this ADR is amended with the measured value. If
operators are routinely clearing this halt before then, the threshold is too tight — that is the
signal, and it is the same one `adr-2026-08-12` nominated for its own cap.

### D6 — Ordering inside the FAIL block

The new exit sits **after** the fresh-base disposition (`adr-2026-07-23` — findings graded on a
stale base are discarded, and must not tick a tally), **after** the D2 no-op escalation, **after**
`consumeKickbackBudget`, and **after** the cumulative-cap check.

Cap-first is not a preference. `adr-2026-07-27-daemon-decide-kickback-halt` fixes it so "a daemon run
that trips the cap still reports the *ping-pong* reason rather than being masked by the phase
reason", and `adr-2026-08-16` D6 preserves it while requiring that each HALT keep a distinct reason
and its class argument. Because the threshold (3) is strictly below the cap (5), the two fire at
different lap counts in the normal case and do not compete; when both would fire on one lap the cap
wins and D7 renders the repetition table into *its* body, so nothing is lost.

`adr-2026-08-16` D6 also requires the block's exit set be **derived by grep at implementation time**
rather than enumerated by hand, and the effective-verdict predicate be consulted **at** each exit
rather than hoisted once. Both apply to this change unchanged.

### D7 — Every convergence halt renders what repeated

The repetition table — site, repeat count, raising rubrics, cumulative budget state — is rendered
into the halt body of the new exit **and** of the existing cumulative-cap halt. Rendering lives in a
pure function over the ledger entry and the current lap's findings, returning prose to the existing
`writeHaltMarker` call site, per `adr-2026-08-08-finish-human-required-halt-rendering`.

The body may state only what the tally established — that a site was flagged in N consumed
kickbacks — and never that the run "is spinning" or "cannot converge"
(`adr-2026-08-05-worktree-classification-evidence-derived-reasons`).

This is the half of the feature that delivers issue outcome 2, and it ships on the cap path too, so
it is delivered even where the new bound never fires.

### D8 — `repeatedSites` on the `kickback` event

The `kickback` member of `ConductorEvent` gains an optional `repeatedSites` field carrying the sites
that ticked and their counts. `loop_halt` carries the same figures in its reason text via the central
`Conductor.emitLoopHalt`.

This is not decoration. Per the event-spine skill, `siteRepeats` is legitimate durable state under
exception C — read by name by its own writer as a control input — **only because the occurrence is
also emitted**; a counter living solely in gitignored `.pipeline/` state would force an operator to
read a per-worktree file to reconstruct that a feature was failing to converge, which §3's corollary
names as a parallel channel wearing an existing file as a disguise. This is the identical reasoning
`adr-2026-08-12` D5 applied to `cumulativeCount`, and the identical field shape.

No new event variant: `adr-2026-08-11-halt-events-ride-the-persisted-spine` rejected per-emit-site
halt payloads, so the halt rides the existing central path.
`adr-2026-07-26-event-sink-registry-exhaustiveness` requires the additive field's sink decision to be
explicit.

### D9 — Scope: `build_review` only, and the operator override

Only the `build_review` kickback site consults the tally. `prd_audit` and `manual_test` share the
re-wordable-reason property and are the natural next candidates; neither has an incident behind it,
and `adr-2026-08-12` D6 deliberately left them for whichever issue produces the evidence. That
reasoning is adopted unchanged. `test_suite` is excluded for the further reason that no per-round
failing-test history exists to key on — `.pipeline/test-suite-evidence.json` is overwritten each run
and the ledger retains only `lastReason`.

**The operator override.** DECIDE recommended descoping to D7 alone — the diagnosis, with no new
bound — because no evidence on disk demonstrates that site repetition separates spin from
convergence. The operator overrode it: *"I want to short circuit cycles regardless — if it looks
like no progress is being made we need to short circuit regardless."*

The override is recorded because it, not the evidence, is what carries D1-D6. Part of the
recommendation rested on numbers that the provenance census in Context later retracted, so the
recommendation was weaker than it appeared when made. What survives the retraction is the 55%
confidence in D4 and the collapse asymmetry in D2 — both now stated as accepted costs with D5 as the
remedy, rather than reasons not to build.

## Alternatives considered

- **Diagnosis only (D7 without D1-D6).** No new bound, no new authority, no false-positive surface,
  and explicitly permitted — `adr-2026-07-13-session-fresh-verdict-artifacts` allows historical lap
  artifacts to "feed diagnosis, never satisfy a gate". Delivers issue outcomes 2 and 3 in full.
  Declined by operator override under D9: it leaves outcome 1 to a cap that fires after the spend.
- **Globbing `.pipeline/build-review/lap-*` for cross-lap repeat counts** — the intake's first
  hypothesis. Rejected on the provenance census in Context: lap directories count cache re-stamps,
  not judgements, and 36 of 44 artifacts on the incident feature were re-stamps. It also collides
  with `adr-2026-08-12`'s rejected "derive the count from the ledger at decision time" alternative
  ("state belongs in the state file; the event is the observation of it") and with
  `adr-2026-08-03`'s stale-verdict-authority invariant.
- **A bounded LLM convergence judge** over the last K laps' finding sets. Rejected:
  `adr-2026-08-12`'s consequences record "no LLM is in the bound's decision path" as a preserved
  property of the convergence machinery; `adr-2026-07-21-demote-task-stamping-to-telemetry` records
  that this repository's answer to a failing machinery class is removal rather than another guard;
  and it puts a provider call inside the loop #1629 already reports as fragile, where a mis-ruling
  becomes a new spin source.
- **A wall-clock kickback-rate window**, as the intake suggested. Rejected as forbidden: no approved
  decision sanctions a wall-clock signal in a *decision* path,
  `adr-2026-07-10-intra-step-build-progress-events` confines the engine's only time-based threshold
  to observability events, and a rate trigger is not reproducible run-to-run.
- **Test-weakening detection** (the intake's second hypothesis — assertions deleted or relaxed at a
  repeatedly-flagged site). Genuinely mechanical and genuinely a spin signal, but it is a different
  signal with an existing owner: the tautology rubric already grades assertion strength, and
  `adr-2026-08-15` warns against treating "the recurring finding's symptom while leaving the cause".
  It also needs the `test_suite` per-round history that does not exist. Left to a follow-on.
- **Raising the cumulative cap, or a definite-match pre-dispatch refusal instead of a counter.**
  `adr-2026-08-05-build-settle-outcome-stamp` rejected "add a second counter" with "the defect is
  not the cap; it is that detection happens after payment. A counter change cannot make the first
  repeat free." Answered rather than ignored: that ADR's remedy is a refusal on a *definite* match —
  every component of `(gate, tree hash, verdict, rung)` present and equal — which requires an
  identical tree. Here the tree moves every lap by construction (that is why `count` resets), so no
  definite match exists and its refusal can never fire on this incident class. The two mechanisms
  are complementary: definite-match makes a genuine no-op repeat free; this bound handles the
  did-work-but-same-site repeat, which cannot be known before the work is done.
- **A new `ConductorEvent` variant for the detection**, rather than a field on `kickback`. Rejected
  under `adr-2026-08-11-halt-events-ride-the-persisted-spine` and for consistency with
  `adr-2026-08-12` D5's precedent on the same event.

## Consequences

- **Positive.** The incident class terminates at three repeats at one site instead of six laps, and
  both convergence halts now name the site an operator has to rule on — removing the manual lap
  archaeology #1652 was filed about. Detection stays fully deterministic; no LLM enters the decision
  path. The tally survives re-dispatch because it lives in the same durable ledger `adr-2026-07-26`
  established, and it is immune to the cache re-stamp that defeats every artifact-scanning design.
- **Preserved invariants.** `MAX_KICKBACKS_PER_GATE` and `MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW`
  keep their values and meanings; the per-tree reset rule is untouched; D2's no-op escalation is
  untouched; cap-first ordering holds; finding identity, the disposition store, and every rubric's
  PASS/FAIL judgement are unchanged; a legacy ledger without `siteRepeats` reads clean.
- **Negative / watch.** The threshold is the least-evidenced part of this decision at 55%, and
  materially weaker than the 70% `adr-2026-08-12` recorded for its own cap — D5's flag and exit
  condition exist for that reason and should be exercised, not left dormant. Two different findings
  at one site count as one repeat (D2), so a feature that legitimately revisits one file three times
  halts; if that is what operators see, the threshold is too tight. The `siteRepeats` eviction rule
  means a feature failing at very many distinct sites can lose a tally before it matures — that
  fails **open**, which is the correct direction.
- **Known limitation (#497 class), accepted.** `.pipeline/` is gitignored, so deleting
  `.worktrees/<slug>` resets the tally. This fails open — a fresh budget, never a spurious halt —
  identical to the limitation `adr-2026-07-26` and `adr-2026-08-12` both accepted for this ledger.
- **Follow-on surfaced during DECIDE, not addressed here.** `priorAttemptPointers`
  (`remediation-context-pointers.ts:52`) keys same-site prior-attempt pointers on the whole
  canonical anchor, which includes the free prose subjects. Whole-anchor equality repeated zero
  times across every lap on disk, so #1620's advisory pointers appear never to fire in production.
  That is a defect in a shipped feature, out of scope for this ADR, and is filed separately.
