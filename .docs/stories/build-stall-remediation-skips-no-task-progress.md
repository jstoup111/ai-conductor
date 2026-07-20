**Status:** Accepted

# Stories: Build-stall auto-remediation must also fire for no_task_progress stalls (#569)

Technical track. Acceptance criteria for closing the gap where the build-stall `/remediate`
auto-remediation dispatch fires only for `halt_marker` stalls and not for `no_task_progress`
(zero-work) stalls. Fix = Approach A: synthesize a remediation prompt from the run's own context
for a `no_task_progress` stall and route it through the SAME `planRemediation` dispatch that
`halt_marker` stalls use (`conductor.ts:3622-3855`), bounded by the shared
`MAX_KICKBACKS_PER_GATE` budget, while leaving the durable no-evidence counter / `checkAndAutoPark`
path (`:3539-3620`) as the owner of the terminal HALT decision for this condition.

Source: `jstoup111/ai-conductor#569`.

---

## Story: A no_task_progress stall gets an auto-remediation attempt before halting

**Requirement:** Desired outcome 1 — in daemon auto mode, a build stall classified as
`no_task_progress` provably dispatches `/remediate` (via `planRemediation`) at least once before the
run falls through toward a terminal HALT, exactly as a `halt_marker` stall already does.

As the daemon build gate, I want a zero-work / no-task-progress stall to be routed through the same
automated `/remediate` remediation path that a halt-marker stall gets, so that a genuinely-transient
zero-progress dispatch (e.g. one confused attempt) can recover without an operator re-kick — closing
the gap between "stall with a question" (auto-remediated) and "stall with zero output" (previously
immediate fall-through to HALT with no corrective dispatch).

### Acceptance Criteria

#### Happy Path
- Given daemon auto mode, and a build attempt (`attempt >= 2`) that resolved no more tasks than the
  prior attempt so the stall circuit breaker sets `stalled = 'no_task_progress'` (`conductor.ts:3439-3441`),
  and no halt marker is present, and the shared remediation budget is not yet exhausted
  (`remediationRounds < MAX_KICKBACKS_PER_GATE`), when the `if (stalled)` block (`:3622`) runs, then
  `effectiveQuestion` is populated from synthesized context (NOT left `null`) and `planRemediation`
  is dispatched exactly once (`this.stepRunner.run('remediate', …)` is invoked).
- Given the synthesized prompt, then it is derived from the run's own available context — the
  completion-gate reason (`completion.reason`, i.e. the pending/not-completed task rows), the stall
  transition (`resolvedTasksBefore → resolvedTasksAfter`), and the no-evidence reason tags
  (`taskEvidence.noEvidenceReasons`, e.g. `zero_work_product`) — and is persisted to the stall
  evidence file so the dispatch and any later HALT can cite it.
- Given `planRemediation` returns `{ kind: 'route', target: 'build', hint }`, then the build retry
  loop resumes with `retryHint` set to the corrective hint and WITHOUT consuming a fixed retry
  (`attempt--; continue`) — identical to the `halt_marker` answerable-route behavior (`:3719-3735`).

#### Negative Paths
- Given interactive (non-daemon or `this.mode !== 'auto'`) mode, when a `no_task_progress` stall
  occurs, then no `/remediate` dispatch happens and the existing interactive/REPL-or-fallthrough
  behavior is unchanged (the new dispatch is daemon-auto-only).
- Given the shared remediation budget is already exhausted (`remediationRounds >= MAX_KICKBACKS_PER_GATE`)
  when a `no_task_progress` stall occurs, then no dispatch is attempted (see the dedicated
  budget-exhaustion story below for the required non-HALT fall-through).

### Done When
- [ ] A unit/engine test drives a daemon-auto build with a `no_task_progress` stall (attempt≥2, no
      progress, no halt marker, budget available) and asserts the `remediate` step / `planRemediation`
      is dispatched exactly once — previously it was never dispatched (`effectiveQuestion` stayed null).
- [ ] The test asserts the dispatched context/evidence file contains the synthesized signals
      (completion reason + stall counts + `zero_work_product` when tagged), not a halt-marker question.
- [ ] A test asserts a `route → build` outcome resumes the retry loop with the corrective hint and
      does not decrement the remaining fixed-retry budget (`attempt--`).

---

## Story: The halt_marker stall path is unchanged by the fix

**Requirement:** Invariant — populating `effectiveQuestion` for `no_task_progress` must not alter the
existing `halt_marker` stall behavior: question read from the marker, dispatch, and terminal-HALT
outcomes (route-misroute, halt, none, throw, budget-exhausted) all stay byte-for-byte.

As the daemon build gate, I want the halt-marker remediation path to keep working exactly as it does
today, so that adding no_task_progress remediation does not regress the case that already worked.

### Acceptance Criteria

#### Happy Path
- Given a `halt_marker` stall in daemon auto mode, when the block runs, then `effectiveQuestion` is
  still read via `readHaltMarkerContent` + `writeStallQuestionEvidence` (`:3633-3641`), the marker is
  cleared, and `planRemediation` is dispatched with the marker question — unchanged.
- Given a `halt_marker` stall with the remediation budget exhausted
  (`remediationRounds >= MAX_KICKBACKS_PER_GATE`), then the run still writes a fail-safe HALT marker
  carrying the question plus "Remediation budget exhausted …" and returns (`:3657-3677`) — a
  `halt_marker` stall still HALTs on budget exhaustion (this is the behavior that MUST differ for
  `no_task_progress`).

#### Negative Paths
- Given a `halt_marker` remediation outcome of `halt`, `none`, `route`-misroute, or a thrown
  dispatch, then the existing terminal-HALT-with-question paths (`:3719-3810`) fire unchanged.

### Done When
- [ ] A test asserts a `halt_marker` stall still populates `effectiveQuestion` from the marker,
      dispatches once, and — with budget exhausted — writes the "Remediation budget exhausted" HALT
      and returns.
- [ ] The diff to the `halt_marker` branch is limited to sharing the dispatch call with the new
      `no_task_progress` branch; its HALT/return semantics are not weakened.

---

## Story: A no_task_progress stall that cannot be auto-remediated falls through to retry/auto-park, not an immediate HALT

**Requirement:** Desired outcome 2 — for a `no_task_progress` stall the durable no-evidence counter /
`checkAndAutoPark` (`:3539-3620`) remains the sole owner of the terminal HALT/park decision. When
remediation is unavailable or non-recovering (budget exhausted, or `planRemediation` returns
`halt`/`none`/throws/misroutes), the run must NOT terminal-HALT inside the stall block — it must fall
through to the existing retry accounting so the counter can reach its park threshold within one run.

As the daemon build gate, I want an un-remediable zero-work stall to keep the current
"fall through and let the durable no-evidence counter own the halt" behavior, so that adding a
remediation attempt cannot regress the auto-park accounting (the counter must still be able to reach
`DAEMON_NO_EVIDENCE_THRESHOLD` within a single generous run — the invariant documented at
`conductor.ts:3819-3831`).

### Acceptance Criteria

#### Happy Path
- Given a `no_task_progress` stall in daemon auto mode with the remediation budget already exhausted
  (`remediationRounds >= MAX_KICKBACKS_PER_GATE`), when the block runs, then NO HALT marker is written
  and NO early `return` occurs from the stall block — control reaches the existing fall-through
  (`resolvedTasksBefore = resolvedTasksAfter`, `:3856`) and the retry loop continues, so
  `checkAndAutoPark` on the next attempt can park with its own reason (`:3589-3618`).
- Given a `no_task_progress` remediation dispatch that returns `{ kind: 'halt' }`, `{ kind: 'none' }`,
  a non-`build` misroute, or throws, then the run does NOT terminal-HALT with that outcome — it falls
  through to the retry/auto-park path (distinct from the `halt_marker` branch, which HALTs on those
  same outcomes).

#### Negative Paths
- Given the same `no_task_progress` conditions but the counter reaches `DAEMON_NO_EVIDENCE_THRESHOLD`,
  then `checkAndAutoPark` parks the feature with its existing "no completion evidence after N
  attempts" reason (`:3603-3618`) — the terminal decision path is unchanged, only a remediation
  attempt was inserted ahead of it.
- Given the interactive-mode fall-through guard (`if (!(this.daemon && stalled === 'no_task_progress'))`,
  `:3832`) — it remains in place so a daemon `no_task_progress` stall never opens an interactive REPL.

### Done When
- [ ] A test asserts a budget-exhausted `no_task_progress` stall writes no HALT marker, does not
      `return`, and lets the retry loop continue (previously N/A — the path never HALTed here, but the
      new dispatch must not introduce a HALT for this branch).
- [ ] A test asserts a `no_task_progress` remediation `halt`/`none`/throw outcome falls through to
      retry rather than writing a terminal HALT (contrast: the `halt_marker` branch HALTs).
- [ ] A test asserts the durable no-evidence counter still increments per no-progress attempt and
      `checkAndAutoPark` still parks at the threshold — the counter accounting is unchanged by the fix.

---

## Story: An exhausted no_task_progress build halts with a distinct reason, not the generic "retries exhausted"

**Requirement:** Desired outcome 3 (operator legibility; bundled per the issue thread's
recommendation) — when a build step finally halts after a `no_task_progress` stall history, the
terminal reason string (`conductor.ts:4568-4573`) must name the actual cause (zero task progress)
rather than the misleading generic `step 'build' failed in auto mode (retries exhausted)`.

As an operator triaging a halted feature, I want the HALT reason to say the build stalled on
no task progress, so that I do not misread it as retry-budget exhaustion (the mislabel reported in
the issue at try 2/5 and 3/5, where the counter/stall — not the fixed retry budget — drove the halt).

### Acceptance Criteria

#### Happy Path
- Given a build step that halts via the generic terminal fallback (`:4557-4573`) after its last
  observed stall was `no_task_progress` (no more-specific HALT marker written by an
  auto-park/ceiling/remediation exit), when the reason is computed, then it reads a distinct
  `no_task_progress`-specific message (e.g. `build stalled: no task progress (<unresolved> tasks
  unresolved after <attempts> attempt(s))`) instead of `step 'build' failed in auto mode (retries
  exhausted)`.
- Given an existing more-specific HALT reason is already on disk (auth pre-flight, auto-park,
  attempt-ceiling, or a remediation HALT), then that reason is still preserved verbatim
  (`existingHalt` wins, `:4568-4570`) — the new string only replaces the generic fallback.

#### Negative Paths
- Given a build step that halts for a genuine reason OTHER than `no_task_progress` (e.g. a real
  completion-gate failure with forward progress that simply ran out of retries), then the existing
  reason string is unchanged — the distinct message is scoped to the `no_task_progress` case only.
- Given `unchangedInputNote` is set (the existing routed-with-unchanged-input note, `:4571-4572`),
  its precedence relative to the new note is deterministic and documented in the plan (no silent
  clobber of one by the other).

### Done When
- [ ] A test asserts a build that exhausts after a `no_task_progress` stall history writes a HALT
      reason naming no-task-progress, not "retries exhausted".
- [ ] A test asserts that when a specific HALT marker already exists (e.g. auto-park), that reason is
      preserved and the new string does not overwrite it.
- [ ] A test asserts a non-`no_task_progress` exhaustion still produces the pre-fix reason string.
