# Conflict Check: Rebase-invalidated test_suite proof HALTs build_review (#1729)

**Date:** 2026-08-19
**Base:** `0b71bec78`
**ADR corpus:** `change_set` (the `conflict_check.adr_corpus` default). The change set's three
approved ADRs are compared in full against each other and against every ADR they cite, extend, or
supersede: `adr-2026-07-08`, `adr-2026-07-11`, `adr-2026-07-13`, `adr-2026-07-20`, `adr-2026-07-25`,
`adr-2026-07-26-event-sink-registry-exhaustiveness`, `adr-2026-07-28`, `adr-2026-08-01`,
`adr-2026-08-04`, `adr-2026-08-05`, `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic`,
and `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane`.
**Inventory:** all 6 stories in `.docs/stories/rebase-invalidated-test-suite-proof-halts-build-re.md`;
the three approved ADRs and the review report; all 4 open pull requests; all 20 live feature
worktrees; every `.docs/plans/` entry referencing the gate loop, the retry ladder, the rebase verdict
path, or `conduct-state.json`.
**Result:** **PASS — zero blocking conflicts.** Two overlaps found, both non-blocking: one additive
same-file overlap in a disjoint region, one stale long-lived branch that competes with nothing.

## Scan method

The production surface is small and enumerable, so the external scan was exhaustive rather than
sampled. `conduct-ts overlap-scan --paths conductor.ts,rebase.ts,daemon-rekick.ts,selector.ts,state.ts`
reported no overlap and no open blockers; that result was corroborated by hand rather than trusted,
because the tool's own note warns it may miss renames and name-only diffs, and because a prior review
in this repository recorded its low signal-to-noise on long-lived files.

| File this change touches | Open PR touching it | Live worktree touching it |
|---|---|---|
| `src/conductor/src/engine/conductor.ts` (loop boundary `:4351`, retry branch `:6729`) | none | none |
| `src/conductor/src/engine/steps.ts` (`StepDefinition` eligibility declaration) | none | none |
| `src/conductor/src/engine/rebase.ts` (`applyRebaseVerdicts` pre-verify set, `~:1300-1370`) | none | `hotfix-rebase-drop-guard` — Overlap 1 |
| `src/conductor/src/engine/daemon-rekick.ts` (`makeRekickBuildPreVerify`) | none | none |
| `src/conductor/src/engine/retry-classify.ts` | none | none |
| `src/conductor/src/engine/step-runners.ts` (`:2198` catch) | none | none |
| new `rewind` CLI module + registration | none | none |
| `docs/reference/cli.md` | #1720 — Overlap 2 | none |

Each open PR was checked with `gh pr diff --name-only`. #1687 is the bot-owned release PR and is
excluded by construction — this branch writes neither `VERSION` nor `CHANGELOG.md`. #1581 and #1168
touch none of these files. #1720 touches `docs/reference/cli.md` only.

Every live worktree was checked with `git diff --name-only origin/main...HEAD` filtered to the seam
files. Two matched; both are analysed below.

## Overlap 1 — `hotfix-rebase-drop-guard` also edits `rebase.ts` (non-blocking)

**Type:** same-file overlap. **Severity:** informational, mergeable.

`hotfix/rebase-drop-guard-supersession` adds a superseded-commit predicate to `rebase.ts` as a new
block after `~:815`, near the CI-failure resolver types. This feature's change is inside
`applyRebaseVerdicts` at `~:1300-1370`, roughly five hundred lines later. The two do not read or write
each other's symbols: the drop guard inspects a dropped commit's diff against HEAD content and
influences whether the rebase HALTs; the pre-verify change decides which gates are mechanically
re-verified **after** a rebase has already succeeded with `outcome.kind === 'changed'`.

**Semantic check.** The drop guard can convert a would-be HALT into a successful `changed` outcome,
which means it can *increase* how often `applyRebaseVerdicts` runs at all. That is the direction this
feature wants — more successful rebases reaching the pre-verify — and it changes neither what the
pre-verify decides nor which gates are eligible. No interlock is required. Whichever lands first, the
other rebases; the plan should anchor its tasks to the `applyRebaseVerdicts` seam rather than to line
numbers, which the hotfix will shift.

## Overlap 2 — PR #1720 also edits `docs/reference/cli.md` (non-blocking)

**Type:** shared documentation write target. **Severity:** informational.

PR #1720 (`needs-remediation: feat/daemon-first-run-install-silently-defaults-the-update-cha`) touches
`docs/reference/cli.md` and no source file this change reads. This feature's documentation task adds a
`rewind` entry to the command reference. Distinct sections of one file; ordinary rebase resolution.

Noted rather than dismissed because #1720 is the very feature that HALTed in the incident this issue
was filed from. Its content is unrelated to the fix — it changes the update channel default — so it is
a coincidence of provenance, not a coupling.

## Non-conflicts, checked and cleared

**`assess-technical-assessment-2026-08-14` reports 108 commits and one seam file.** Inspected: it is a
long-lived branch carrying merged main history plus one documentation commit preserving a technical
assessment, with two shipped-record commits. It contains no competing edit to any seam this feature
touches; the seam file appears only through accumulated merged history. Not a conflict.

**Six plans matched the seam grep and have no `.docs/shipped/` record.** Each was checked against the
tree rather than against the record: `retry-classify-rerun-vs-route`
(`classifyRetryDecision` is imported at `conductor.ts:151` — shipped),
`resolve-436-rekick-pre-loop-rebase-satisfies-verdi` (`recordRebaseStepCompletion` is live in
`rebase.ts` — shipped), `2026-07-09-daemon-merged-pr-guard-on-retry` (`verifyMergedPrShipment` is
wired at `daemon-rekick.ts:462` — shipped), and three older plans whose mechanisms are likewise
present. All predate the shipped-record convention; the missing record is a bookkeeping gap, not
in-flight work. None is a conflict.

## ADR-to-ADR consistency within the change set

Checked pairwise, because all three ADRs alter what a resumed feature does.

| Pair | Interaction | Verdict |
|---|---|---|
| ADR-1 (boundary re-check) ↔ ADR-2 (route on unretryable) | ADR-1 makes the stale-proof strand self-resolving, so ADR-2's halt becomes the residual path. Each ADR states this explicitly; ADR-2 D3 names itself as residual. | Consistent — complementary, and neither is dead code: ADR-2 covers a proof stale for a reason the loop cannot resolve. |
| ADR-1 ↔ ADR-3 (rewind) | ADR-3 demotes to `stale`; ADR-1's boundary check honors `stale` because `alreadyResolved` covers only `done`/`skipped`, and `gateSatisfied` treats `stale` as unsatisfied (`selector.ts:59`). A rewound step is dispatched by both mechanisms in agreement. | Consistent — ADR-3 D2's choice of `stale` over `pending` is what makes this hold, and it is stated as the reason there. |
| ADR-2 ↔ ADR-3 | ADR-2 writes a `needs-human` halt; ADR-3 D4 clears the halt as part of a rewind. | Consistent — this is the intended sequence: the halt names the step, the operator rewinds to it, the halt clears. It is also the pair that discharges `adr-2026-08-05`'s operator-lever invariant, which neither does alone. |

## ADR-to-corpus consistency

- **`adr-2026-07-08` scope sentence.** ADR-1 D6 supersedes it for `test_suite` only, using that ADR's
  own published extension bar. Direct contradiction avoided by scope, and the superseding is stated in
  the text rather than implied.
- **`adr-2026-07-11` Decision items 4 and 5.** ADR-1 D7 preserves both explicitly; Story 2's negative
  path asserts them. No contradiction.
- **`adr-2026-07-11` rejected Option C.** ADR-1 D3's read-only rule is what keeps this from being that
  option re-proposed. Checked deliberately; see the review's Alignment section.
- **`adr-2026-07-13` Non-goals.** No new routing mechanism (ADR-2 D2 extends the existing classifier),
  no new budgets (D4 reuses `retry_routing`), no LLM (D2 stays pure), `build` excluded (D6). All four
  honored.
- **`adr-2026-07-20`.** Untouched and consumed; review condition 5 makes recomputing it a build-review
  rejection.
- **`adr-2026-08-01`.** ADR-3 D2 applies its `done → stale` mutation form verbatim rather than
  restating it.
- **`adr-2026-07-26-event-sink-registry-exhaustiveness`.** ADR-2 D5 adds no union member. ADR-3 D5
  does add a spine occurrence, which that ADR obliges to declare a sink — recorded here as a plan
  obligation, not a conflict, because the obligation is satisfiable and the ADR anticipates it.

## Precondition carried into the plan

None outside this repository's own tree. No other feature's spec must be amended for this one to land
— unusual for engine work here, and a direct consequence of the uncontended surface.
