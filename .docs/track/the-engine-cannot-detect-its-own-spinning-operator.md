# Track: The engine cannot detect its own spinning

Track: technical

Scope boundary: `build_review` only, operator-confirmed 2026-08-17, and the operator **overrode a
recommendation to descope**. The recommendation and the override are both recorded below, because
the override is the reason this track carries a new bound rather than diagnosis alone.

The engine must **short-circuit a build that is not making progress**, not merely describe the
failure after the budget is gone. Both halves ship: an earlier trip on repeated unresolved sites,
and a rendered diagnosis naming what repeated on that trip and on the existing cap halts.

Excluded: `test_suite` per-round failing-test history (the ledger retains only `lastReason` and
`.pipeline/test-suite-evidence.json` is overwritten each run, so the data does not exist yet);
substance-level equivalence matching across re-worded findings (jstoup111/ai-conductor#1611's
territory, spec landed and unimplemented); cross-rubric arbitration (#1630); infrastructure-failure
budget lanes (#1629); `prd_audit` and `manual_test`, which `adr-2026-08-12` D6 deliberately left for
whichever issue produces their evidence.

## What the incident actually was

jstoup111/ai-conductor#1652 reports two spin episodes on 2026-08-16 that only the operator
detected. Exploration established that the first episode's terminal state was **not** an absent
bound. The bound fired:

```text
loop_halt  build_review cumulative kickback cap exceeded (cumulative 6, cap 5):
           [completeness] missing_deliverable
           [completeness] missing_deliverable
```

`adr-2026-08-12-cumulative-build-review-convergence-bound` is APPROVED, implemented, enabled by
default, and it terminated the run. Two things were wrong with how it terminated, and they are the
two halves of this feature:

1. **It arrived after the budget was spent** — six laps, roughly two hours of dispatches.
2. **It named nothing.** `lastReason` is the raw grader excerpt. The halt body above literally
   repeats one phrase twice and still does not tell an operator *what site* kept failing. The
   operator asked "is it cycling?" four times on 2026-08-16 and each answer required manual lap
   archaeology.

So the feature is not "add a convergence bound". It is "make the existing bound trip on the right
signal, earlier, and say what it saw".

## The measurement that fixed the design — and the one that first broke it

Two rounds of measurement over the real persisted laps on disk. The first round was **wrong** and
is recorded because its error is the whole reason the final key is what it is.

**Round 1 (wrong).** Counting how many `lap-*` directories flagged each site suggested that keying
on the file path from `evidenceLocations` was a strong signal (8 of 11 laps on one feature) while
the full typed anchor was inert (0 of 11). It also suggested a fatal false-positive: the feature
with the *highest* repeat count ended `PASS`.

**Round 2 (correct).** `adr-2026-08-13-engine-managed-build-review-rubric-branches` D7 states that a
rubric **cache hit stamps a previously validated result into the current lap's artifact**. Filtering
on `provenance.kind`:

| feature | lap dirs | fresh judgements | cache re-stamps |
|---|---|---|---|
| `stale-manual-test-…` | 11 | 2 | 36 of 44 rubric artifacts |
| `live-daemon-e2e-…` | 5 | 0 | 20 of 20 |

Every number in round 1 was counting one judgement re-stamped by the cache. The apparent signal was
an artifact; so was the apparent false positive. The largest genuine sample on disk is **two fresh
judgements**, which is not enough to calibrate any threshold.

The durable conclusion is not about which key wins. It is that **`lap-*` directories are not a
counting unit at all** — they are content-addressed by input digest (D2), not chronological, and a
cache hit mints one without a new judgement. Any detector that globs them measures cache behavior.

## Chosen approach (operator-confirmed after the override)

**Count when a kickback is actually consumed, in the state file. Never glob artifacts.**

At the `build_review` FAIL exit the engine already holds this lap's own freshly-judged findings and
their effective verdict — `resolveEffectiveBuildReviewVerdict` gives `unresolvedFindingIds` under
the disposition store's lease. Each consumed kickback ticks a bounded per-site tally on the
`KickbackGateEntry` beside `cumulative`, keyed by the rubric's **typed anchor subject**:
`scope.path`, `tautology.changedTest`, `rootCause.locus`, `completeness.planTask`. When one site's
tally reaches the threshold, the run takes a `needs-human` HALT whose body names the site, its
count, the rubrics that raised it, and the budget state.

Why each element is forced:

- **Ticking on kickback consumption, not on lap artifacts**, is immune to the re-stamp inflation
  that destroyed round 1: one tick per real backward move. It also satisfies
  `adr-2026-08-12`'s rejected alternative — "State belongs in the state file; the event is the
  observation of it" — which forbids deriving a control decision by parsing persisted history.
- **The typed anchor subject, not `evidenceLocations`.**
  `adr-2026-08-13-stable-build-review-finding-dispositions` classes `evidenceLocations` as
  presentation and excludes it from identity; `adr-2026-08-16-closed-build-review-finding-vocabularies`
  enumerates the fields the engine verifies against the immutable snapshot and
  `evidenceLocations` is not among them. Round 1's key was the unverified one.
- **Deriving unresolved-ness from the current lap's own join**, never from a prior lap's artifact.
  `adr-2026-08-03-build-repair-member-reuse-validity` binds that "no on-disk gate verdict, step
  status, or timestamp is sufficient authority on its own", and
  `architecture-review-2026-07-08-post-rebase-gate-first-reverify` establishes that a `build_review`
  artifact does not attest the current tree.
- **Config-gated, default-on, with a stated exit condition**, mirroring `adr-2026-08-12` D4 exactly.
  Its reasoning applies with more force here: the threshold cannot be calibrated from existing data,
  and "a false `needs-human` halt on a converging feature is the expensive failure direction". The
  flag is the escape hatch, and per
  `adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag` it carries a written exit
  condition so it does not become permanent by default.
- **`needs-human`, and the existing halt sequence.** `daemon-rekick.ts` skips `needs-human` on every
  sweep while weaker classes are cleared and re-dispatched — a guard whose halt the daemon
  auto-clears is not a guard. The path reuses marker → `surfaceRemediationPr` → `emitLoopHalt`
  per `architecture-review-2026-07-04-daemon-kickback-log-visibility` condition 2, and the
  occurrence rides the spine per `adr-2026-08-12` D5.
- **Ordering.** `adr-2026-08-16` D6 requires the FAIL block's exits be **grep-derived at
  implementation time**, the effective-verdict predicate consulted **at** each exit rather than
  hoisted, cap-first ordering preserved, and each HALT to keep a distinct reason and class argument.
  The new exit sits after the fresh-base disposition (`adr-2026-07-23`: findings graded on a stale
  base are discarded, not counted) and after the cumulative cap, so a run that trips the cap still
  reports the ping-pong reason rather than having it masked.

## The operator override, stated plainly

Exploration recommended descoping to diagnosis-only, on the ground that no evidence on disk shows
site repetition separating spin from convergence. The operator overrode it: *"I want to short
circuit cycles regardless — if it looks like no progress is being made we need to short circuit
regardless."*

The override is sound and the recommendation rested partly on round 1's contaminated numbers, which
round 2 retracted. What survives the retraction is narrower but real, and is carried into the ADR as
an accepted cost rather than papered over:

- The threshold is **not evidenced**. Two fresh judgements is the whole corpus. `adr-2026-08-12` set
  its own cap at 5 on the same footing ("a judgement, not a measurement — confidence 70%") and
  named the config flag as the remedy; this follows that precedent explicitly.
- Two materially different findings at one site across two kickbacks read as one repeat.
  `adr-2026-08-16` rejected path-collapse for *identity*, where collapse grants blanket immunity.
  Here the consequence runs the other way — collapse causes a conservative halt a human then rules
  on, which is exactly the behavior the operator asked for and exactly issue outcome 2. That
  asymmetry is the argument, and it must be written down rather than assumed.

## Approaches weighed and declined

- **Diagnosis-only** (recommended by exploration, declined by the operator). Delivers issue
  outcomes 2 and 3 with no false-positive surface, and is explicitly permitted —
  `adr-2026-07-13-session-fresh-verdict-artifacts` allows historical lap artifacts to "feed
  diagnosis, never satisfy a gate". Declined because it leaves outcome 1 to a cap that fires after
  the spend, which is the operator's stated objection.
- **A bounded LLM convergence judge** over the last K laps. Declined: `adr-2026-08-12`'s
  consequences record "no LLM is in the bound's decision path" as a preserved property, and
  `adr-2026-07-21-demote-task-stamping-to-telemetry` records that this repo's answer to a failing
  machinery class is removal, not another guard. It also adds a provider call inside the loop
  #1629 already reports as fragile.
- **A wall-clock kickback-rate window.** Declined as forbidden: no approved ADR sanctions a
  wall-clock signal in a decision path, `adr-2026-07-10-intra-step-build-progress-events` confines
  the only time-based threshold in the engine to observability, and a rate trigger is not
  reproducible run-to-run.
- **Globbing `.pipeline/build-review/lap-*` for repeat counts** (the intake's first hypothesis —
  "the persisted lap dirs already carry every signal"). Declined on the round-2 measurement: lap
  dirs count cache re-stamps, not judgements.
- **Test-weakening detection** (the intake's second hypothesis). Genuinely diffable, but it is a
  different signal with a different owner — the tautology rubric already grades assertion strength —
  and it needs the `test_suite` per-round history that does not exist. Left out of scope.
- **Raising or retuning the existing cap instead of adding a signal.**
  `adr-2026-08-05-build-settle-outcome-stamp` rejected "add a second counter" with "a counter change
  cannot make the first repeat free". Answered rather than ignored: that ADR's remedy is a
  definite-match refusal for the *no-op* case, which needs an identical tree; here the tree moves
  every lap by construction, so no definite match exists and the two mechanisms are complementary.

Engine-internal control-flow and diagnosis change to `build_review`'s FAIL routing and the kickback
ledger; no user-facing product capability, so acceptance criteria live directly in stories.
