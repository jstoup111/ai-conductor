# ADR: A tree-attesting gate re-checks its predicate before the loop honors a persisted `done`

**Date:** 2026-08-19
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session for ai-conductor#1729

## Context

Two features HALTed `needs-human` on 2026-08-19 with three byte-identical `build_review` retries of
`build_review requires CURRENT test_suite proof (got STALE)` after a routine rebase onto latest.
Neither could be cleared by retry, re-kick, or unpark; recovery required hand-editing
`.pipeline/conduct-state.json` and `gates/test_suite.json`.

The engine holds two records of "has `test_suite` passed": the gate verdict
(`.pipeline/gates/test_suite.json`) and the step ledger (`.pipeline/conduct-state.json`). Both
observed features stranded on a disagreement between them, from opposite directions:

- `first-run-install-silently-defaults-the-update-cha`: verdict `satisfied: false` (written by
  `applyRebaseVerdicts`, `rebase.ts:1366`), ledger `test_suite: done`.
- `shipped-record-timing-never-reaches-measured-the-l`: verdict `satisfied: true`, while the
  content-addressed proof inspection returned STALE.

`adr-2026-07-11-verdict-aware-resume-entry` already established that the verdict layer, not step
state, is the satisfaction authority, and its backward clamp works: with an unsatisfied verdict on
disk, `earliestUnsatisfiedGateIndex` (`conductor.ts:3906`) lands `startIndex` exactly on
`test_suite`. The strand is the next statement. The loop's first action on each iteration is
(`conductor.ts:4351`):

```
const alreadyResolved = currentStatus === 'done' || currentStatus === 'skipped';
if (alreadyResolved && !explicitlyTargeted) continue;
```

State-only, and it runs before every other check — including the pre-dispatch predicate re-check at
`:4443`, which is guarded `step.phase === 'DECIDE'`. So the clamp selects `test_suite`, the loop
skips it, and `build_review` is dispatched against a prerequisite gate that is not satisfied.

Nothing corrects the ledger on this path. `scanKickbackVerdicts` — which `adr-2026-07-11` names as
the sole owner of verdict-driven state demotion — matches only verdicts whose `kickback.from` equals
a step that just completed **inside** the loop (`conductor.ts:8989`). A pre-loop re-kick writes
`from: 'rebase'` with no in-loop `rebase` step ever running, so the match never occurs. Confidence
90%, basis: verified at `daemon-rekick.ts:536-545`.

Constraints inherited:

- `adr-2026-07-11` Option C (reconcile state from verdicts) was **rejected**: side-effectful read,
  reconciliation-by-copy keeping two authorities, and fighting `scanKickbackVerdicts`. Its Option B
  (verdict-aware `checkGate`) was rejected as verified-broken, and its Decision item 4 keeps
  prerequisite checking state-only. Neither may be revisited here.
- `adr-2026-07-08-post-rebase-gate-first-mechanical-reverify` scoped its pre-verify to `build` and
  stated an eligibility bar rather than a membership list: "A gate is eligible for pre-verify iff its
  predicate mechanically re-verifies the current tree/history. Today that set is `{build}`; a future
  gate whose predicate becomes tree-attesting can be added by meeting that bar, not by listing it."
- `adr-2026-07-25-content-addressed-full-suite-proof` D5 makes `test_suite`'s predicate exactly that:
  "The content fingerprint is the reuse key, so an identical tree after rebase remains current while
  a dirty relevant edit becomes stale." Its D8 anticipates the consequence: "The verifier may
  immediately preserve it when content is identical."
- `adr-2026-07-11` records "regressing to top-of-list re-runs is a known prior failure class" — any
  re-check must fast-forward unchanged when the predicate says satisfied.

## Options Considered

### Option A: A mechanical re-check at the dispatch boundary, scoped by a declared eligibility property (CHOSEN)

Before the `alreadyResolved` short-circuit honors a persisted `done`/`skipped`, an **eligible** gate
re-evaluates its own mechanical completion predicate against the current tree. `done` on a satisfied
predicate fast-forwards exactly as today; `done` contradicted by the predicate dispatches the step.
Eligibility is declared on the `StepDefinition` as the `adr-2026-07-08` bar — the predicate
mechanically re-verifies the current tree/history — so the set is a property of each step rather
than a list at the call site.

- **Pros:** fixes both observed variants with one mechanism, because it consults the fact rather than
  either cache of it; delivers outcome-6 for free, since a CURRENT proof answers `done: true` and the
  loop fast-forwards with no re-run; mutates nothing, so `adr-2026-07-11`'s objection to Option C
  does not apply; reuses `checkStepCompletion`, introducing no fourth satisfaction predicate; mirrors
  a proven pattern already in the same loop 90 lines below.
- **Cons:** adds a predicate call per eligible step per iteration (bounded: two steps, and both
  predicates are local filesystem/git reads); the eligibility property must be justified per step or
  it becomes the "list at the call site" it exists to replace.

### Option B: Broaden `scanKickbackVerdicts` to fire for pre-loop `from: 'rebase'` verdicts

Demote `test_suite` to `stale`, and the existing state-only skip then works (`stepSatisfied` counts
`stale` as unsatisfied for gate purposes; the skip's `alreadyResolved` does not include it).

- **Rejected.** It is `adr-2026-07-11` Option C wearing a different hat — the loop copies one ledger
  into the other and both remain authorities. Decisively, it fixes only the first variant: the second
  feature had `satisfied: true` on disk and no kickback verdict at all, so nothing would fire.

### Option C: Make `gateSatisfied` re-derive rather than trust the persisted verdict

- **Rejected.** `gateSatisfied` is called by both the resume clamp and `selectNextGate`, and
  `adr-2026-07-11` Decision item 5 makes "one authority, shared by entry and tail" load-bearing.
  Making it impure would put a filesystem read inside a pure selector and change the meaning of every
  verdict, including judged gates whose predicates are not tree-attesting.

### Option D: Teach `build_review`'s runner to run `test_suite` when the proof is stale

- **Rejected.** It inverts the step topology by making a gate the runner of its own prerequisite,
  and it leaves the loop's skip defect live for every other gate — the next gate to disagree with its
  ledger strands identically.

## Decision

Adopt **Option A**.

### D1 — Eligibility is a declared property of the step, tested by the `adr-2026-07-08` bar

`StepDefinition` carries a declaration that this step's completion predicate mechanically re-verifies
the current tree or history. A step earns it by meeting `adr-2026-07-08`'s bar, which is restated
here unchanged and not relaxed. At this ADR's approval the eligible set is `{build, test_suite}`:

| Gate | Predicate basis | Attests the current tree? |
|---|---|---|
| `build` | `deriveCompletion` over git evidence trailers, re-derived on every evaluation (`artifacts.ts`) | Yes — established by `adr-2026-07-08` |
| `test_suite` | content fingerprint over the resolved command, tracked and declared inputs, and declared environment (`adr-2026-07-25` D4-D7) | Yes — the fingerprint is the reuse key, so an identical tree reads CURRENT and any relevant edit reads STALE |
| `build_review` | artifact-presence glob over `.pipeline/build-review.json` | No — unchanged from `adr-2026-07-08`'s table |
| `manual_test` | latest-attempt FAIL scan plus session-freshness mtime | No — unchanged |

`wiring_check` is excluded: its predicate returns `{done: true}` unconditionally
(`artifacts.ts:3074`), so a re-check can never contradict a persisted status and the declaration
would be inert. Adding a gate to the set is an ADR-level act requiring the bar be shown met, not a
code-local edit.

### D2 — The re-check runs at the dispatch boundary, before the `alreadyResolved` short-circuit

Placement is load-bearing and is the whole fix: after the short-circuit the step is already skipped.
It runs only when `this.verifyArtifacts` is true — the same condition `advanceTail` and the DECIDE
re-check already gate on, and the condition the daemon production path always sets.

### D3 — The re-check reads; it never writes

No state mutation, no verdict write, no event-driven demotion. A predicate that contradicts a
persisted `done` causes the step to be **dispatched**; the step's own success path then records its
outcome through the existing machinery. This is what distinguishes the decision from
`adr-2026-07-11`'s rejected Option C, and the distinction is the reason that rejection is not
reopened.

### D4 — One authority, and it is `checkStepCompletion`

The re-check calls `checkStepCompletion` with the same `completionCtx` the DECIDE re-check and
`advanceTail` use. No new predicate, no second definition of "satisfied", and no reading of the
verdict file at this seam — the verdict layer keeps its own role at the clamp and the tail.

### D5 — Fail-closed on an unreadable predicate, and the direction is stated

A predicate that throws is treated as **not satisfied**, so the step is dispatched. The cost of a
wrong answer in that direction is a redundant re-run of a mechanical step; the cost in the other
direction is the strand this ADR exists to remove. This matches `adr-2026-07-08`'s "any pre-verify
error → invalidate (never skip on doubt)".

### D6 — `test_suite` joins the post-rebase pre-verify set, by the same eligibility declaration

`applyRebaseVerdicts` pre-verifies every gate carrying D1's declaration, not the hardcoded `build`.
This is `adr-2026-07-08`'s own stated extension mechanism used as published; that ADR's scope
sentence ("exactly `build` — not `build_review`, not `manual_test`") is superseded **only** as to
`test_suite`, and only because `test_suite` meets the bar the same sentence's neighbouring paragraph
defines. `build_review` and `manual_test` remain excluded, for the reasons in D1's table.

D6 is not redundant with D2. D6 keeps the *verdict* honest where the knowledge lives, which preserves
the no-gratuitous-lap fast path (outcome-6) at its natural site and keeps the resume clamp's input
truthful. D2 keeps the *dispatch* honest regardless of how either ledger came to disagree, including
the second observed variant, for which no rebase kickback verdict was ever written. Either alone
leaves one observed failure live.

### D7 — `checkGate` and the selector are unchanged

Prerequisite checking stays state-only (`adr-2026-07-11` D4) and `gateSatisfied` stays pure and
verdict-authoritative (`adr-2026-07-11` D5). This ADR adds a boundary check; it re-decides neither.

## Consequences

### Positive

- Both observed 2026-08-19 strands are closed by machinery at the point of violation, and the class
  is closed rather than the instance: any eligible gate whose ledger drifts from the tree is
  re-dispatched instead of skipped.
- `build_review` is no longer dispatched against an unsatisfied prerequisite (outcome-2), because
  the prerequisite is now re-derived rather than remembered.
- A CURRENT proof after a rebase still fast-forwards straight to `build_review` (outcome-6), because
  the predicate consulted *is* the content-addressed inspection.
- `adr-2026-07-08`'s eligibility bar becomes executable rather than prose, so the next tree-attesting
  gate is added by declaration and inherits both D2 and D6.

### Negative

- Two additional predicate evaluations per loop iteration in the BUILD region. Both are local reads
  (`test_suite` hashes declared inputs; `build` walks git evidence) and neither dispatches an agent,
  but the fingerprint hash is the more expensive of the two and its cost scales with tracked-input
  count.
- A project whose `test_suite` fingerprint is unstable across identical trees would now re-run the
  suite on every resume rather than strand. That is a strictly better failure, but it is a visible
  behavior change and belongs in the release note.
- The eligibility declaration is a new thing to get wrong. A step declared eligible whose predicate is
  not genuinely tree-attesting would be re-dispatched forever; the mitigation is that adding one is
  an ADR-level act (D1), not a code-local edit.
