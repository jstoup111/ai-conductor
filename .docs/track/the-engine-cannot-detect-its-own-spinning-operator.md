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

**Count when a kickback is actually consumed, in the state file, keyed by rubric. Never glob
artifacts, and never key on anything the grader wrote.**

At the `build_review` FAIL exit the engine already holds this lap's own freshly-judged findings and
their effective verdict — `resolveEffectiveBuildReviewVerdict` gives `unresolvedFindingIds` under
the disposition store's lease. Each consumed kickback ticks a per-rubric failure tally on the
`KickbackGateEntry` beside `cumulative`. When one rubric's tally reaches 4, the run takes a
`needs-human` HALT whose body names the rubric, its failure count, the sites it most recently
flagged, and the budget state.

**The key was chosen by measurement, after a first attempt failed one.** A per-**site** tally, keyed
on the typed anchor subject, was authored and then withdrawn: replayed over 11 features
reconstructed from persisted event ledgers it fired on 2 of the 5 that spun and missed
`finish-publication`, the episode this issue reports. Sites move as remediation fixes them.

| key | threshold | spin | healthy | kickbacks avoided |
|---|---|---|---|---|
| per-rubric failures | 4 | 5/5 | 0/6 | 14 |
| per-rubric failures | 3 | 5/5 | 2/6 | 21 |
| consecutive same-rubric run | 4 | 5/5 | 0/6 | 10 |
| per-site repetition | 3 | 2/5 | 0/6 | 6 |

The rubric name is engine-supplied from the registry rather than grader output, so
`adr-2026-07-26` D3's finding that build_review reasons are never byte-stable cannot reach it, and
nothing about finding identity or `adr-2026-08-16`'s vocabularies is read or affected. The sweep was
also run with and without `cumulative`'s PASS reset and gave identical results, so `adr-2026-08-12`
D2 stays untouched.

Why each element is forced:

- **Ticking on kickback consumption, not on lap artifacts**, is immune to the re-stamp inflation
  that destroyed round 1: one tick per real backward move. It also satisfies
  `adr-2026-08-12`'s rejected alternative — "State belongs in the state file; the event is the
  observation of it" — which forbids deriving a control decision by parsing persisted history.
- **The rubric, not any grader-authored field.** Two earlier keys were tried and dropped:
  `evidenceLocations` (classed as presentation and excluded from identity by
  `adr-2026-08-13-stable-build-review-finding-dispositions`, and absent from
  `adr-2026-08-16-closed-build-review-finding-vocabularies`'s engine-verified reference list), then
  the typed anchor subject (verified, but it measured 2 of 5 on the corpus). The rubric name comes
  from the engine's own registry, so no grader text reaches the counting path at all.
- **Deriving unresolved-ness from the current lap's own join**, never from a prior lap's artifact.
  `adr-2026-08-03-build-repair-member-reuse-validity` binds that "no on-disk gate verdict, step
  status, or timestamp is sufficient authority on its own", and
  `architecture-review-2026-07-08-post-rebase-gate-first-reverify` establishes that a `build_review`
  artifact does not attest the current tree.
- **Config-gated, default-on**, mirroring `adr-2026-08-12` D4. Its reasoning still applies — "a
  false `needs-human` halt on a converging feature is the expensive failure direction" — though less
  urgently than it did for the withdrawn key, since the threshold is now measured rather than
  guessed. The flag remains the production escape for a number derived from eleven features.
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

## The two operator directions, stated plainly

**First:** exploration recommended descoping to diagnosis-only, on the ground that no evidence then
available showed repetition separating spin from convergence. The operator overrode it: *"I want to
short circuit cycles regardless — if it looks like no progress is being made we need to short
circuit regardless."*

**Second:** DECIDE then reported that the site key it had chosen fired on only 2 of 5 spinning
features and missed the filed incident. The operator directed: *"fix the keyed portion on what
provides real value add."* That direction produced the per-rubric key and the sweep above.

The sequence matters, because the first direction was taken against weak evidence and the second is
what supplied it. The threshold now rests on 11 features rather than zero, at **85% confidence,
basis verified**, against the 55% the withdrawn design carried. What remains uncertain is corpus
size and the spin/healthy labelling, which comes from operator reports and cap terminations rather
than an independent oracle — carried into the ADR as the accepted cost, with the config gate and the
in-tree re-derivation as its remedies.

The site-collapse objection that the withdrawn design had to argue past — `adr-2026-08-16`'s
rejection of path-level identity collapse — is **gone rather than mitigated**: the rubric key
touches no identity, disposition, or immunity decision.

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
- **Per-site repetition, keyed on the typed anchor subject** (the intake's signal (a), and this
  track's own first chosen design). Authored in full, then withdrawn on the corpus replay: 2 of 5
  spinning features, and it misses `finish-publication`, the filed episode. Sites move as
  remediation fixes them, so repetition at a site is as consistent with convergence as with spin.
- **Consecutive same-rubric run.** Same separation as the chosen key (5/5 spin, 0/6 healthy) but
  avoids 10 kickbacks against 14, because a rubric that alternates in and out resets the run — the
  evasion `adr-2026-07-26` D3 warned about.
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
