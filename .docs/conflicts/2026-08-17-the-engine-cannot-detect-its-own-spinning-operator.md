# Conflict Check: The engine cannot detect its own spinning

**Date:** 2026-08-17
**Feature:** ai-conductor#1652 — technical track, Tier M
**Stories scanned:** `.docs/stories/the-engine-cannot-detect-its-own-spinning-operator.md` (Stories 1–6)
**ADR corpus scope:** `repo_wide` (`.ai-conductor/config.yml`) — all 481 files in `.docs/decisions/`
swept across four partitions; one partition re-run after an API failure, so coverage is complete.
**Result:** 4 blocking conflicts found against the first design and resolved by replacing its
mechanism; 1 blocking conflict resolved by a measurement that falsified the design's own premise;
3 constraints accepted into the design; 1 raised conflict dismissed on evidence; 1 defect in shipped
behaviour surfaced and routed out of scope. Re-check clean.

---

## How this check changed the feature

The intake proposed a cross-lap comparator over the persisted lap directories, keyed on finding
sites, with a kickback rate window as a second signal. The sweep and one measurement dismantled
three of its four load-bearing choices:

- the **rate window** is forbidden outright,
- the **lap directories** are not a counting unit,
- the **key** was a field the engine never verifies.

What survived — count on consumption, key on the typed anchor subject, halt `needs-human` with a
rendered body — is what the stories describe. Conflicts 1–4 are recorded against withdrawn designs
because they are the reason the current one exists.

---

## Conflict 1: A wall-clock rate window is forbidden in a decision path

**Stories involved:** withdrawn Story ("halt when the kickback rate over a wall-clock window exceeds
a bound") vs the engine's time-signal policy
**Files:** intake hypothesis (c) in `.pipeline/intake-outcomes.md` vs
`.docs/decisions/adr-2026-07-10-intra-step-build-progress-events.md`
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-07-10-intra-step-build-progress-events
**Story ID:** withdrawn rate-window story
**ADR opposing sentence (verbatim):** the only approved wall-clock threshold in the engine is
emitted as `build_no_progress`, an **observability event**, once per quiet episode — time-based
signals report; they do not decide.
**Story opposing sentence (verbatim):** "(c) kickback rate over a window — and halts needs-human"
**Resolution:** Withdrawn. A rate trigger is also not reproducible run-to-run, which
`adr-2026-08-12`'s companion reasoning treats as disqualifying for a bound. `cumulative` already
answers the volume question from durable state, which is where the same ADR says it belongs. The
exclusion is carried explicitly into the stories' partial-delivery note and the coherence mapping
rather than left implicit.

---

## Conflict 2: A control decision may not be derived by parsing persisted history

**Stories involved:** withdrawn Story ("scan `.pipeline/build-review/lap-*` at the FAIL boundary and
count repeats") vs the governing convergence bound
**Files:** intake hypothesis 1 vs
`.docs/decisions/adr-2026-08-12-cumulative-build-review-convergence-bound.md`
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-08-12-cumulative-build-review-convergence-bound
**Story ID:** withdrawn lap-scan story
**ADR opposing sentence (verbatim):** "Rejected: it makes a control decision depend on parsing a
telemetry ledger whose reader … returns null on any malformed line, so one bad record would silently
disable the bound. State belongs in the state file; the event is the observation of it."
**Story opposing sentence (verbatim):** "the persisted lap dirs plus the kickback ledger already
carry every signal; a deterministic cross-lap comparator … may need no new data collection at all"
**Resolution:** Replaced. The tally lives on `KickbackGateEntry` beside `cumulative` (Story 1) and
ticks on consumption, so the control input is state and the `kickback` event field (Story 6) is its
observation — the exact split this ADR mandates and the one that keeps the durable counter legal
under event-spine exception C.

---

## Conflict 3: Lap directories count cache re-stamps, not judgements

**Stories involved:** withdrawn Story ("the same site failing across N lap directories") vs the
rubric-branch artifact contract
**Files:** intake hypothesis 1 vs
`.docs/decisions/adr-2026-08-13-engine-managed-build-review-rubric-branches.md`
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-08-13-engine-managed-build-review-rubric-branches
**Story ID:** withdrawn lap-scan story
**ADR opposing sentence (verbatim):** D2 — "The lap ID binds to the immutable input digest rather
than a mutable filename timestamp"; D7 — a cache hit **stamps a previously validated result into the
current lap's artifact** with cache provenance.
**Story opposing sentence (verbatim):** "the same test file or finding site failing N times across
rounds"
**Resolution:** Replaced, and confirmed by measurement rather than argument. A provenance census
over both features with laps on disk found 36 of 44 rubric artifacts on the incident feature and 20
of 20 on the other were `provenance.kind = 'cache-hit'`. The apparent 8-of-11 repeat signal was one
judgement counted eight times. Story 2's negative paths encode this permanently: an implementation
that enumerates `lap-*` to derive repeat counts must fail the suite.

---

## Conflict 4: `evidenceLocations` is presentation and is not engine-verified

**Stories involved:** withdrawn Story ("key the tally on the file path from `evidenceLocations`") vs
the finding-identity decisions
**Files:** withdrawn draft vs
`.docs/decisions/adr-2026-08-13-stable-build-review-finding-dispositions.md` and
`.docs/decisions/adr-2026-08-16-closed-build-review-finding-vocabularies.md`
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-08-16-closed-build-review-finding-vocabularies
**Story ID:** withdrawn evidence-path-key story
**ADR opposing sentence (verbatim):** the engine-verified references are `anchor.path`,
`anchor.changedTest`, `anchor.locus`, and `anchor.planTask`; `evidenceLocations` is relegated to the
human report alongside `summary`, and "summary wording and line numbers are deliberately excluded".
**Story opposing sentence (verbatim):** "keys on the repo FILE PATH component of each finding's
`evidenceLocations` (engine-verifiable against the immutable diff snapshot)" — the parenthetical was
false.
**Resolution:** Re-keyed onto the typed anchor subject (Story 2). This is the sharpest single
correction the sweep produced: the withdrawn key was chosen *because* an earlier measurement made it
look strong, and that measurement was Conflict 3's artifact.

---

## Conflict 5 (raised, dismissed on evidence): "a counter change cannot make the first repeat free"

**Stories involved:** Story 3 vs the build-settle refusal decision
**Files:** `.docs/stories/…` Story 3 vs
`.docs/decisions/adr-2026-08-05-build-settle-outcome-stamp.md`
**Type:** contradiction (raised)
**Severity:** blocking if sustained
**ADR filename stem:** adr-2026-08-05-build-settle-outcome-stamp
**Story ID:** Story 3
**ADR opposing sentence (verbatim):** "Raise `MAX_KICKBACKS_PER_GATE` or add a second counter
(rejected) … The defect is not the cap; it is that detection happens after payment. A counter change
cannot make the first repeat free."
**Story opposing sentence (verbatim):** "Given a site whose tally reaches the configured threshold,
when the FAIL block routes, then the run takes a halt classified `needs-human`"
**Resolution:** Dismissed. That ADR's remedy is a **definite-match** refusal — every component of
`(gate, tree hash, gate verdict, escalation rung)` present, comparable, and equal — which requires an
identical tree. On this incident class the tree moves every lap by construction (that is precisely
why `count` resets to 1 and the per-tree bound never engages), so its refusal can never fire here and
the first repeat cannot be made free by any mechanism. The two are complementary, not competing, and
the ADR records the reasoning explicitly in its Alternatives.

---

## Constraint 1 (accepted): cap-first ordering

**Source:** `adr-2026-07-27-daemon-decide-kickback-halt` (F3) and
`adr-2026-08-16-closed-build-review-finding-vocabularies` (D6)
**Constraint:** the cumulative-cap check stays first so "a daemon run that trips the cap still
reports the *ping-pong* reason rather than being masked".
**Accepted into:** Story 3's negative path — the cap halt wins on a tie and keeps its own distinct
reason — and Story 4, which renders the repetition table into the cap halt's body so the diagnosis
is not lost when the cap wins. The threshold (3) sits strictly below the cap (5), so in the normal
case they fire at different lap counts and do not compete.

---

## Constraint 2 (accepted): the stale-base disposition precedes any spend

**Source:** `adr-2026-07-23-build-review-fresh-base-disposition`
**Constraint:** a `build_review` FAIL is not routed to rework until the engine deterministically
re-verifies against a fresh base; findings graded on a stale base are discarded.
**Accepted into:** Story 1's negative path (a discarded lap ticks nothing) and Story 3's (the
short-circuit is unreachable for that lap). Without this the tally would count findings the engine
has already ruled invalid.

---

## Constraint 3 (accepted): a coarse key is licensed only by its consequence direction

**Source:** `adr-2026-08-16-closed-build-review-finding-vocabularies`, whose Option B —
"structural-only identity … keying on rubric plus paths" — was rejected because "two materially
different scope findings on one file collapse to one id", a High-impact risk carried from
`architecture-review-2026-08-13-build-review-rubric-dispositions`.
**Why this is a constraint and not Conflict 6:** the rejection is scoped to *identity*, where
collapse grants an acceptance blanket immunity over a file. Story 2 reuses the shape on the
**halting** side, where collapse produces a conservative human-required halt instead of silent
over-acceptance — the opposite failure direction, and the behaviour the operator explicitly asked
for.
**Accepted into:** the stories' closing note, which forbids this key from influencing identity,
dispositions, or any immunity decision, and requires an implementation that does so to fail review.
This is the feature's most likely source of a false halt and is tracked as R2 in the architecture
review.

---

## Out-of-scope defect surfaced during the sweep

`priorAttemptPointers` (`src/conductor/src/engine/remediation-context-pointers.ts:52`) keys #1620's
same-site prior-attempt pointers on the whole canonical anchor, which includes the free prose
subjects the grader re-words every lap. Whole-anchor equality repeated **zero** times across every
persisted lap on disk, so those advisory pointers appear never to fire in production. This is a
defect in shipped behaviour, independent of this bound's correctness, and is routed to its own
intake issue rather than widening this change.

---

## Re-check

Stories 1–6 as written carry no remaining contradiction, overlap, state conflict, or resource
contention against each other or against the swept corpus. Story 4 overlaps Story 3 by design — it
renders on both halt paths — and that overlap is deliberate, so the diagnosis ships even if the new
bound never fires. Clean.
