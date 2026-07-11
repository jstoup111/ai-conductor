**Status:** Accepted

# Stories: Verdict-Aware Resume Entry (#532)

Technical track (no PRD). Requirements derive from issue jstoup111/ai-conductor#532 and the
APPROVED ADR `adr-2026-07-11-verdict-aware-resume-entry`. Stories state observable behavior of
`conductor.run({resume: true})`; the mechanism (backward-only clamp) lives in the ADR/plan.

---

## Story 1: Resume never dispatches past an unsatisfied gate verdict (#532 fixture)

**Requirement:** Issue #532 desired outcome 1; ADR Decision §1

As the daemon operator, I want a resumed run to dispatch the earliest step whose on-disk gate
verdict is unsatisfied, so that a cleared-HALT rekick can never fast-forward to `finish` over a
build the engine itself judged incomplete.

### Acceptance Criteria

#### Happy Path
- Given the exact #532 pre-kill fixture — `.pipeline/gates/build.json` `{satisfied:false,
  kickback:{from:'rebase', evidence:'rebase changed code/test paths: …'}}`, `build_review.json`
  and `manual_test.json` carrying the same unsatisfied kickback, `rebase.json`
  `{satisfied:true}`, and state `{acceptance_specs:'done', build:'failed', rebase:'done',
  last_step:'finish'}` (no step `in_progress`) — when `conductor.run({resume:true})` derives its
  start index, then the first step dispatched is `build`, not `finish`.
- Given the same fixture reached through the daemon path (rekick pre-loop rebase NOOP →
  `recordRebaseStepCompletion` stamps `rebase:'done'` → `run({resume:true})`), when the resumed
  loop starts, then the `step_started` event names `build` and no `finish` dispatch occurs before
  the build gate verdict flips satisfied.

#### Negative Paths
- Given the fixture with `.pipeline/gates/build.json` replaced by unparseable bytes (`{oops`),
  when the resume entry derives its start index, then it does not throw; the corrupt verdict is
  treated as absent (same `readVerdict` semantics the loop tail uses) and the state fallback
  (`build:'failed'` is not satisfied) still yields `build` as the start step.
- Given the fixture with the entire `.pipeline/gates/` directory deleted, when the resume entry
  derives its start index, then it does not throw and still starts at `build` (state fallback:
  `failed` is unsatisfied).
- Given the fixture, when the operator instead runs with an explicit `--from-step finish`
  (`fromStep` set, no `resume`), then the clamp does not apply and `finish` is targeted — the
  explicit operator override is exempt (ADR Decision §3).

### Done When
- [ ] An engine test constructs the verbatim #532 fixture (three unsatisfied kickback verdicts +
      `rebase:'done'`/`build:'failed'` state) and asserts the resolved start step is `build`.
- [ ] A companion test with the corrupt `build.json` variant asserts no throw and start step
      `build`.
- [ ] A `fromStep` test asserts the clamp is bypassed for explicitly targeted steps.

---

## Story 2: The in_progress resume branch is clamped too

**Requirement:** Issue #532 impact (post-kill state); ADR Decision §2

As the daemon operator, I want a resume that finds a step already marked `in_progress` to still
honor unsatisfied upstream gate verdicts, so that killing a wrongly-dispatched `finish` does not
reproduce the same wrong dispatch on the next resume.

### Acceptance Criteria

#### Happy Path
- Given the #532 post-kill state — same unsatisfied `build.json`, state additionally carrying
  `finish:'in_progress'` — when `conductor.run({resume:true})` derives its start index, then the
  first step dispatched is `build`, not `finish`, even though `findResumeIndex`'s first branch
  returns the `in_progress` step.

#### Negative Paths
- Given `build:'in_progress'` (killed mid-build) and no verdict for any step later than build
  unsatisfied, when the run resumes, then it starts at `build` — the clamp never moves the entry
  LATER than the in_progress step (backward-only; min() with an equal-or-later gate index leaves
  the in_progress choice intact).
- Given `finish:'in_progress'` and ALL gate verdicts on disk satisfied, when the run resumes,
  then it starts at `finish` exactly as today — the clamp is a no-op when nothing is unsatisfied.

### Done When
- [ ] A test with `finish:'in_progress'` + unsatisfied `build.json` asserts start step `build`.
- [ ] A test with `build:'in_progress'` asserts the entry stays `build` (no forward movement).
- [ ] A test with `finish:'in_progress'` + all-satisfied verdicts asserts start step `finish`.

---

## Story 3: Post-rebase kickback verdicts are honored on the next resume

**Requirement:** Issue #532 desired outcome 2

As the daemon operator, I want a file-changing rebase's kickback verdicts to determine the next
dispatched step on resume, so that invalidated downstream work is re-verified instead of trusted.

### Acceptance Criteria

#### Happy Path
- Given a state where `build`, `build_review`, and `manual_test` are all `done` and a
  file-changing rebase then wrote kickback verdicts `{satisfied:false, kickback:{from:'rebase'}}`
  for all three (state statuses unchanged, `rebase:'done'`), when the run resumes, then the first
  step dispatched is `build` — the earliest kicked-back gate — not `finish`.
- Given only `manual_test.json` is kicked back unsatisfied (build and build_review re-verified
  satisfied), when the run resumes, then the first step dispatched is `manual_test`.

#### Negative Paths
- Given a step whose state is `stale` (cascade-staled by an earlier kickback) but whose stale
  verdict file still says `satisfied:true`, when the run resumes, then that step is treated as
  unsatisfied (`stale` overrides a satisfied verdict — same `gateSatisfied` rule the loop tail
  uses) and is not skipped past.
- Given kickback verdicts exist only for steps BEFORE the derived `regionStart` (hypothetical
  front-half verdict), when the run resumes, then the clamp ignores them — only loop-region gates
  (at or after `regionStart` from `deriveGateTopology`) participate.

### Done When
- [ ] A test writes three kickback verdicts over done state and asserts start step `build`.
- [ ] A test with a single `manual_test` kickback asserts start step `manual_test`.
- [ ] A test with a `stale` status + satisfied verdict asserts the step is selected (not skipped).

---

## Story 4: All-satisfied resumes fast-forward unchanged (regression guard)

**Requirement:** Issue #532 desired outcome 3; ADR Consequences (negative)

As the daemon operator, I want resumes with fully satisfied verdicts to behave byte-identically
to today's state-only derivation, so that the fix cannot regress daemon re-dispatch into
re-running completed work.

### Acceptance Criteria

#### Happy Path
- Given a feature with DECIDE steps `done`, `build` through `manual_test` `done` with satisfied
  verdicts on disk, and `rebase:'done'` satisfied, when the run resumes, then the start step is
  `finish` — identical to the pre-fix state-only derivation.
- Given a fresh daemon dispatch (DECIDE steps preseeded `done`, no BUILD progress, no verdict
  files), when the run resumes, then the start step is `acceptance_specs` — the first pending
  step, exactly as before the fix.

#### Negative Paths
- Given a resume whose state-derived index lands in the linear front half (e.g.
  `architecture_review` pending, `stories` pending with no verdicts), when the start index is
  derived, then pending loop-region gates AHEAD of the candidate do not drag the entry forward —
  the start step remains the front-half step (backward-only clamp; ADR Decision §1).
- Given a feature whose loop-region steps are legitimately `skipped` (tier S skips) with no
  verdict files, when the run resumes, then skipped steps read as satisfied (state fallback) and
  the entry is not clamped back to them.

### Done When
- [ ] A test with all-satisfied verdicts asserts start step `finish` (parity with pre-fix
      derivation asserted against `findResumeIndex`'s raw output).
- [ ] A fresh-dispatch test (preseeded DECIDE, no verdicts) asserts start step
      `acceptance_specs`.
- [ ] A front-half test asserts a pending pre-loop step is not dragged forward past pending loop
      gates.
- [ ] A skipped-steps test asserts `skipped` loop gates without verdicts do not attract the
      clamp.
