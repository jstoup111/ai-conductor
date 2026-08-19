# Track: Rebase-invalidated test_suite proof HALTs build_review

Track: technical

Scope: the BUILD gate loop's dispatch boundary, the post-rebase pre-verify set, the step-runner
retry seam, and an operator navigation verb. Operator-confirmed 2026-08-19: all four mechanisms in
one spec (the "All four" option), covering every desired outcome on ai-conductor#1729.

Excluded: the aggregate suite's own execution, fingerprinting, or evidence format
(`adr-2026-07-25-content-addressed-full-suite-proof` owns those, unchanged); the preserve/invalidate
partition `adr-2026-07-20-post-rebase-delta-aware-invalidation` computes (consumed, never
recomputed); `build`'s own retry and progress accounting (#280); and any change to which gates a
rebase invalidates.

## What the defect actually is

Two features HALTed `needs-human` on 2026-08-19 with three byte-identical `build_review` retries of
`build_review requires CURRENT test_suite proof (got STALE)`, raised by `TestSuiteProofError`
(`build-review-inputs.ts:186`). `build_review`'s own prerequisites are `['wiring_check',
'test_suite']` (`steps.ts:181`), so the step it needs cannot run from inside it and every retry
re-reads the same stale proof.

The stranding is one line. At `conductor.ts:4351` the loop short-circuits on step state alone:

```
const alreadyResolved = currentStatus === 'done' || currentStatus === 'skipped';
if (alreadyResolved && !explicitlyTargeted) continue;
```

This runs **before** any predicate re-check. `adr-2026-07-11-verdict-aware-resume-entry`'s backward
clamp does its job — with `gates/test_suite.json` reading `satisfied: false`, `earliestUnsatisfiedGateIndex`
lands `startIndex` on `test_suite` — and then the very first loop iteration skips `test_suite`
because `conduct-state.json` still says `test_suite: done`, and falls through to `build_review`.
Confidence 95%, basis: verified — the clamp at `conductor.ts:3899-3966`, the skip at `:4351`, and
the only pre-dispatch predicate re-check at `:4443`, which is guarded `step.phase === 'DECIDE'`.

Nothing demotes the step ledger on this path. `scanKickbackVerdicts` — which
`adr-2026-07-11` names as the sole owner of verdict-driven state demotion — fires only for verdicts
whose `kickback.from` equals a step that just completed **inside** the loop. A pre-loop re-kick's
`applyRebaseVerdicts` writes `kickback: {from: 'rebase'}` (`rebase.ts:1366`) with no in-loop `rebase`
step ever running, so the match never occurs and `conduct-state.json` keeps `test_suite: done`
indefinitely. Confidence 90%, basis: verified at `conductor.ts:8989` and `daemon-rekick.ts:536-545`.

The second feature reached the same dead end from the opposite disagreement: its
`gates/test_suite.json` read `satisfied: true` while the content-addressed proof inspection returned
STALE. `gateSatisfied` (`selector.ts:56-64`) treats a persisted verdict as authoritative and never
re-derives it, so a cached `true` for a content-addressed gate outlives the fact it recorded.

**Both variants are the same shape:** a satisfaction claim cached in a ledger, consulted at the
dispatch boundary in place of the cheap mechanical predicate that would have contradicted it.

## Chosen approach (operator-confirmed)

Four changes, each on an existing seam.

**1. The BUILD gate loop re-checks its mechanical predicate before honoring `done`.** The
DECIDE-phase re-check at `conductor.ts:4443` already establishes the pattern and the wording for
why: "an autonomous forward walk must not author a DECIDE artifact merely because its persisted
status is unresolved." The inverse is equally true — an autonomous forward walk must not *skip* a
BUILD gate merely because its persisted status says resolved. One predicate call fixes both observed
variants and delivers outcome-6 for free: a CURRENT proof answers `done: true` and the loop
fast-forwards to `build_review` with no re-run, because `test_suite`'s predicate
(`artifacts.ts:3076-3098`) is exactly the content-addressed inspection.

**2. `test_suite` joins the post-rebase pre-verify set.**
`adr-2026-07-08-post-rebase-gate-first-mechanical-reverify` scoped its pre-verify to `build` alone
and stated the eligibility bar rather than the membership: "A gate is eligible for pre-verify iff its
predicate mechanically re-verifies the current tree/history. Today that set is `{build}`; a future
gate whose predicate becomes tree-attesting can be added by meeting that bar, not by listing it." Its
own table marked `test_suite` absent because `test_suite` did not exist in that form. It does now,
and `adr-2026-07-25` D5 is the qualifying property, stated in that ADR's own words: "The content
fingerprint is the reuse key, so an identical tree after rebase remains current while a dirty
relevant edit becomes stale." That ADR's D8 already anticipated this — "The verifier may immediately
preserve it when content is identical." This is meeting a published bar, not widening a scope.

**3. A deterministic step-runner failure routes instead of burning the budget.**
`adr-2026-07-13-retry-classify-rerun-vs-route` built exactly this classifier and its signal (b),
`identical-repeat`, is this failure's shape precisely: attempt ≥ 2, byte-identical reason, inputs
unchanged. It is wired only at the completion-gate-miss seam (`conductor.ts:6884`); a step-runner
that returns `{success: false}` retries unconditionally to `stepMaxRetries` (`:6729`). Extending the
existing classifier to that seam is smaller than a second mechanism, and the halt it produces names
the step that must re-run — outcome-3 — rather than "retries exhausted".

**4. A supported operator navigation verb.** Recovery today is a hand-edit of
`.pipeline/conduct-state.json` plus `gates/*.json` plus `rm .pipeline/HALT`, with no CLI.
`adr-2026-08-01-conduct-state-mutation-port` already owns the shape: "Explicit invalidation such as
`done` to `stale` is expressed as an authorized mutation with the current expected value." The verb
is a client of that port, not a new writer.

## Approaches weighed and declined

- **Reconcile `conduct-state.json` from the verdicts at resume.** This is `adr-2026-07-11`'s
  Option C, rejected there for reasons that still hold: a side-effectful read, reconciliation-by-copy
  keeping two authorities, and fighting `scanKickbackVerdicts`. Change 1 deliberately does the
  opposite — it consults the predicate at the boundary and mutates nothing.
- **Make `checkGate` verdict-aware.** This is `adr-2026-07-11`'s Option B, rejected there as
  verified-broken, and its Decision item 4 keeps prerequisite checking state-only. Not revisited.
- **Broaden `scanKickbackVerdicts` to fire for `from: 'rebase'` verdicts written pre-loop.** Would
  demote `test_suite` to `stale` and let the existing skip work. Declined: it re-introduces the
  two-authority reconciliation Option C was rejected for, and it fixes only the variant where a
  kickback verdict exists — the second observed feature had `satisfied: true` on disk and would be
  untouched.
- **Teach `build_review`'s runner to dispatch `test_suite` itself.** Declined outright: it inverts
  the step topology, makes a gate its own prerequisite's runner, and leaves the loop's skip defect
  live for every other gate.
- **Widen the pre-verify to every gate.** Declined: `adr-2026-07-08`'s bar exists precisely to keep
  non-tree-attesting predicates (`build_review`'s presence glob, `manual_test`'s mtime scan) out.
  Only `test_suite` newly meets it.

Engine-internal control flow plus one new CLI verb; no user-facing product capability, so acceptance
criteria live directly in the stories.
