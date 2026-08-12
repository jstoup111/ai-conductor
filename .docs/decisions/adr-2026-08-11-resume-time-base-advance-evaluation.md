# ADR: evaluate the feature's base at halt-resume, before any judged gate

**Status: APPROVED**
**Date:** 2026-08-11
**Issue:** jstoup111/ai-conductor#1245
**Stem:** `unhalt-after-main-advance-resumes-against-stale-fe`
**Deciders:** operator (James Stoup), architecture-review

## Context

Rebase-first play-forward is reachable **only** through the one-shot `.pipeline/REKICK`
sentinel. `clearMarker` (`daemon-rekick.ts:312-326`) is its sole writer, with exactly three
callers: `rekickSweep` (`daemon-cli.ts:1418`), the episode-end sweep
(`daemon-cli.ts:1501-1521`), and `reseal --clear-halt` (`reseal-cli.ts:146,244`).
`resumeRebaseFirst` returns `'skipped'` on its first line when the sentinel is absent
(`daemon-rekick.ts:447-448`).

Two facts make this a trap rather than a gap:

1. `rekickSweep` skips halts classed `needs-human` or `unclassified` on **every** sweep, not
   bounded by SHA (`daemon-rekick.ts:180-193`). That class can therefore never arm the
   sentinel for itself.
2. An operator clearing such a halt by hand (`rm .pipeline/HALT`) reaches none of the three
   callers. No `HALT.cleared` sibling is written, no sentinel appears.

The clear merely wakes the daemon — `watchHaltCleared` (`daemon-deps.ts:371-425`) calls
`waker.wake()` (`daemon.ts:780`) — and ordinary dispatch follows. Nothing anywhere evaluates
whether the feature's base is still current. No per-feature base-advance detector exists:
`daemon-sha.ts` compares only the daemon **root's** base tip against `.daemon/last-base-sha`,
and `git cherry` has zero call sites in `src/`.

Observed consequence (#1245, `codex-readiness-distinguishes-unavailable-doctor-p`): the
feature resumed at BUILD against a stale merge-base while carrying a commit already
patch-equivalent to main. `build_review` grades
`git diff merge-base(origin/<default>, HEAD)..HEAD` (`build-review-inputs.ts:143-169`), so
that already-upstream commit stayed in the graded diff and read as unauthorized feature
scope. The scope gap routed to `plan`, which is ungrantable in daemon mode
(`decide-entry-policy.ts:26,155-163`), producing a terminal `needs-human` HALT that no
number of retries could clear.

## Options Considered

### Option A: evaluate the base when resuming a halted feature (chosen)
Compute base currency at the resume seam; play forward through the existing
`resumeRebaseFirst` only when the base actually advanced.
- **Pros:** Reuses `resolveFreshBase` + `isBranchCurrent` + the whole play-forward, all
  tested. Untouched-base resumes are a strict no-op, so still-current evidence survives.
  Seal handling comes free via the existing rebaseline. Bounded to the failing path.
- **Cons:** Introduces a per-feature currency computation the codebase does not have. A
  resume can now conflict where it previously dispatched instantly.

### Option B: a freshness precondition before every dispatch
Verify currency on all dispatches, not just halt-resume (essentially the never-implemented
`base-refresh` custom step from PR #603 — no `actions.ts` exists in the engine today).
- **Pros:** One invariant, no resume-specific carve-out; also covers long-running features
  that drift without halting.
- **Cons:** Rebases healthy in-flight features whenever main advances, invalidating gates
  mid-build across the whole fleet. The blast radius is fleet-wide for a defect that is
  resume-specific.

### Option C: filter upstream-equivalent commits out of build_review's graded diff
Exclude commits patch-equivalent to `origin/<default>` from the graded range.
- **Pros:** Smallest change; `patch-id` tooling already exists in `rebase-translate.ts`.
- **Cons:** Treats the symptom. The feature still builds, tests, and anchors evidence
  against a stale base. Satisfies only outcome 2 of the issue's five in-scope outcomes.

## Decision

**Option A.** Evaluate base currency at halt-resume, in `runConductorInWorktree`, placed
**after** the `isOperatorParked` check (`daemon-cli.ts:1067`) and **before**
`resumeRebaseFirst` (`daemon-cli.ts:1082`) — therefore before `conductor.run()`
(`daemon-cli.ts:1112`).

Placement is load-bearing in three ways:

- **After the park check.** Park keeps strict precedence and a parked worktree's unconsumed
  sentinel stays untouched, so all four existing park/HALT guards keep holding
  (`daemon.ts:589-606`; `conductor.ts:3944-3968`; `daemon-rekick.ts:131-146`;
  `daemon-cli.ts:1067-1079`).
- **Before `conductor.run()`.** The verdict-aware resume clamp (`conductor.ts:3543-3612`)
  then reads the verdicts `applyRebaseVerdicts` just wrote rather than pre-rebase ones.
- **In the daemon call site, not the conductor.** `conductor.run()` is shared with
  interactive runs, where a forced rebase would be wrong — `runRebaseStep` already hard-codes
  a noop for non-daemon runs (`conductor.ts:9139-9147`). Keeping the policy in the daemon
  layer avoids leaking daemon-only behavior into the shared loop.

### The predicate

"The base advanced" is evaluated in two steps, composing existing primitives and adding no
new git logic:

1. `resolveFreshBase(git)` (`rebase.ts:274-330`) resolves the base ref, probing the tracking
   ref against `ls-remote` and fetching only when they differ.
2. `isBranchCurrent(git, resolution.ref)` (`rebase.ts:360-367`) —
   `rev-list --count HEAD..<baseRef> === 0`.

Yielding exactly three verdicts:

| Verdict | Condition | Action |
|---|---|---|
| `current` | base resolved and `isBranchCurrent` true | Dispatch as today. No rebase, no seal rotation, no gate invalidation. |
| `advanced` | base resolved and `isBranchCurrent` false | Play forward through `resumeRebaseFirst`. |
| `undeterminable` | `resolveFreshBase` degraded to its local fail-soft shape (`kind: 'local'`) | Dispatch as today. **Never rebase onto a base we could not verify.** |

The `undeterminable` rule is deliberate and is the one place this design does not simply
reuse `isBranchCurrent`'s own convention. `isBranchCurrent` returns `false` on an unknown ref
("not provably current"), which is the safe direction *inside* `performRebase` — the rebase
then fails loudly. At a gate that *decides whether to rebase at all*, that same convention
would inverted-fail: an unresolvable base would force a rebase onto a possibly-wrong local
ref. `resolveFreshBase` fail-softs to a local default-branch name on any git or network error
(no origin, discovery failure, `ls-remote` failure, `rev-parse` failure), so this case is
reachable in normal operation and must fail toward today's behavior.

### Observability

The verdict is an occurrence in time that the daemon log, UI, and OTel exporter all need, so
it rides the existing spine: a variant on the `ConductorEvent` union
(`src/conductor/src/types/events.ts`), emitted through `ConductorEventEmitter`. No sidecar
file, no bespoke log, no status stamped into an existing artifact.

Precedent for both the shape and the "pure telemetry, never affects step outcome" framing:
`build_review_base` (`events.ts:328-336`, carrying `mergeBase` / `trackingRefSha` /
`remoteHeadSha` / `fresh`) and `rebase_mergeable_skip` (`events.ts:548-556`, carrying
`baseRef` / `baseSha` / `baseKind`). The new variant follows them — it records which base was
compared and what was decided, so an operator can tell `current` from `undeterminable`
without inspecting the filesystem.

## Consequences

### Positive
- Clearing a HALT stops being a trap. The operator-recovery ritual the incident required —
  park, hand-write a REKICK sentinel, preserve/clear a raced HALT, nurse the seal — is no
  longer needed for this class.
- A commit already patch-equivalent to main is dropped by the rebase before `build_review`
  ever sees it, so it cannot be misattributed as feature scope.
- No manual `conduct-ts reseal` after a resume-triggered rebase: `performRebase` verifies the
  seal before moving HEAD (`rebase.ts:681-698`) and `translateAfterRebase` rotates it with
  trigger `proactive-rebase` in the same operation (`rebase-translate.ts:437-476`). No new
  authorization channel is introduced.
- A current base costs two git commands and changes nothing — still-valid evidence is not
  invalidated.

### Negative
- A resume that previously dispatched instantly can now spend a rebase, and can conflict.
  Containment is the existing bounded `runGatedRebaseResolution` followed by a HALT — the
  same path today's re-kick resume already uses — so no new failure mode is introduced, but
  the *frequency* of that path rises.
- An operator clearing a HALT can now see the feature re-halt on a rebase conflict rather
  than resuming. This is a genuinely different HALT with a different reason, not the original
  finding re-derived, but it is still a second intervention.
- Base evaluation runs per halt-resume, adding a `ls-remote` round-trip on the path where the
  tracking ref is stale.

### Follow-up Actions
- [ ] Add the `ConductorEvent` variant and its sink entry.
- [ ] Route the resume decision through `resumeRebaseFirst` without altering the sentinel's
      one-shot or park-preserved semantics (see
      `adr-2026-08-11-play-forward-entry-trigger`).
- [ ] Cover the `undeterminable` verdict explicitly in tests — it is the case most likely to
      regress into "rebase onto a local ref".
