**Status:** Accepted

# Stories: Parallel Validation Phase (ai-conductor#469)

Technical track — no PRD. Acceptance criteria derive from the APPROVED ADRs
`adr-2026-07-10-concurrent-group-core` (TS-CORE) and
`adr-2026-07-10-validation-group-join` (TS-JOIN). Requirement tags reference the
ADR stem + section.

---

## Story: Validation group fans out concurrently after build_review

**Requirement:** TS-JOIN §Decision-1/2

As a daemon operator, I want the SHIP-tail validators dispatched concurrently after
build_review so that the SHIP tail costs ~max instead of sum of validator durations.

### Acceptance Criteria

#### Happy Path
- Given a product-track M-tier feature **running in daemon/auto mode** whose
  build_review is done and whose three validators are all applicable, when the loop
  reaches the validation group, then manual_test and prd_audit dispatch concurrently
  (cap 2) and architecture_review_as_built dispatches as soon as either slot frees.
- Given all dispatched validators produce passing verdicts, when the join evaluates,
  then the group's state key is `done`, each member's own state key is `done`, and the
  loop continues to the next step with no rewind.

#### Negative Paths
- Given the group is dispatched, when the wall-clock of the group is measured in a test
  with three stub validators of durations 3t/2t/t and cap 2, then total duration is
  strictly less than 6t (serial sum) — concurrency is real, not sequential.
- Given a validator branch throws before producing any `.pipeline` marker, when its
  branch retries exhaust, then the group fails through the normal step-failure path
  (auto mode: `.pipeline/halt-user-input-required` written) and NO remediation
  dispositions are synthesized for that branch.
- Given SIGINT arrives while two branches are in flight, when the process exits, then
  every branch's synthetic state key (`«group»__«member»`) reflects its last known
  status on disk and a resumed run does not re-dispatch already-`done` members.
- Given the conductor runs in INTERACTIVE (non-auto) mode, when the loop reaches the
  validators, then the group does NOT fan out — the members execute via today's serial
  walk and manual_test's post-step checkpoint pauses for the operator exactly as before
  (conflict resolution 2026-07-10: group engages only in auto mode).

### Done When
- [ ] Engine test proves concurrent dispatch (interleaved start events for two members
      before either finishes) and cap enforcement (third member's start event only after
      a slot frees)
- [ ] Engine test proves all-green join → group `done`, loop advances, zero rewinds
- [ ] Engine test proves no-verdict branch → group failure → halt marker written, no
      remediation.json produced for that branch

---

## Story: Fan-out width respects existing skip rules (0–3 members)

**Requirement:** TS-JOIN §Decision-1

As a daemon operator, I want the group to honor today's tier/track/feature-type skip
rules so that parallelism never resurrects a validator that would have been skipped
serially.

### Acceptance Criteria

#### Happy Path
- Given a technical-track feature, when the validation group resolves membership, then
  prd_audit is not dispatched and its state key is `skipped` — identical to today's
  serial skip.
- Given an S-tier feature (or one whose DECIDE-phase architecture_review was skipped),
  when membership resolves, then architecture_review_as_built is not dispatched and its
  state key is `skipped`.
- Given only one member remains applicable, when the group runs, then behavior is
  observably identical to today's serial execution of that single step (same events,
  same gate checks, same retry ladder).

#### Negative Paths
- Given a feature where ALL members are skipped (e.g. technical track + S tier + no
  HTTP/UI stories), when the loop reaches the group, then the group itself is `skipped`,
  no session is dispatched, and the loop advances without writing any validator marker.
- Given a member is skipped, when the join evaluates, then the skipped member
  contributes no verdict and cannot fail the group (skipped ≠ no-verdict).

### Done When
- [ ] Engine tests cover width 3, 2, 1, and 0 membership matrices with correct state
      keys for each member
- [ ] Width-1 test asserts event-stream equivalence (same event types in the same
      order) with the pre-change serial baseline for that step

---

## Story: A FAIL verdict waits for its siblings; the join sees the union

**Requirement:** TS-JOIN §Decision-2/3

As a daemon operator, I want one consolidated kickback carrying every validator's
findings so that one rewind fixes everything instead of first-failure-wins serial
discovery.

### Acceptance Criteria

#### Happy Path
- Given manual_test produces FAIL rows while prd_audit and as-built are still running,
  when manual_test's branch completes, then the running siblings are NOT cancelled and
  the join waits for their verdicts.
- Given manual_test FAILed and as-built is BLOCKED and prd_audit PASSed, when the join
  evaluates, then exactly one rewind occurs whose retry hint contains BOTH the
  manual-test FAIL rows and the remediation guidance for the as-built gaps.

#### Negative Paths
- Given two validators fail, when the join classifies, then the rewind target is the
  earliest step among all dispositions (build earlier than acceptance_specs earlier than
  architecture_review earlier than plan) — never two sequential rewinds in one round.
- Given a sibling produces no verdict (infra failure) while another produced FAIL, when
  the join evaluates, then the group takes the step-failure/halt path — the FAIL verdict
  alone is NOT remediated around the broken sibling (no partial join).

### Done When
- [ ] Engine test: MT FAIL + as-built BLOCKED + prd PASS → exactly one `kickback` event,
      one navigateBack, hint contains both evidence blocks
- [ ] Engine test: FAIL verdict + sibling crash → halt, zero kickback events
- [ ] Engine test: sibling still-running when first FAIL lands → both completion markers
      exist at join time (no cancellation)

---

## Story: manual_test FAIL classification stays deterministic at the join

**Requirement:** TS-JOIN §Decision-3 (preserves adr-2026-07-06-manual-test-fail-routing)

As a harness maintainer, I want manual_test FAIL rows classified by engine code, not by
the remediate LLM, so that the deterministic-first rule and the existing APPROVED ADR
hold under parallelism.

### Acceptance Criteria

#### Happy Path
- Given only manual_test fails (siblings pass), when the join classifies, then the
  rewind to build carries the FAIL rows as the retry hint and NO remediate session is
  dispatched — byte-for-byte the 2026-07-06 ADR behavior.
- Given manual_test fails alongside a prd_audit gap, when the join runs, then remediate
  is dispatched exactly once and its input hint enumerates ONLY the prd-audit/as-built
  evidence files — manual-test FAIL rows are attached to the merged work order by the
  engine, not offered to remediate for re-classification.

#### Negative Paths
- Given the remediate planner returns an unusable/stale plan (readRemediationPlan →
  null), when the join falls back, then manual_test's deterministic build kickback still
  proceeds (the deterministic stream never depends on the LLM stream succeeding).
- Given manual_test FAIL rows exist but its self-heal budget (`MAX_KICKBACKS_PER_GATE`)
  is exhausted, when the join classifies, then the run halts with the existing
  budget-exhausted reason — parallelism does not grant extra kickbacks.

### Done When
- [ ] Engine test: MT-only failure → zero remediate dispatches, kickback hint equals the
      serial baseline's hint format
- [ ] Engine test: mixed failure → exactly one remediate dispatch; its dispatch context
      lists only prd-audit/as-built evidence paths
- [ ] Engine test: exhausted MT budget under the group → halt reason matches the serial
      baseline's wording

---

## Story: One remediate dispatch plans the union of prd-audit and as-built gaps

**Requirement:** TS-JOIN §Decision-3

As a daemon operator, I want a single remediation pass over all LLM-classifiable gaps so
that dispositions are consistent and token cost is one planner session per round.

### Acceptance Criteria

#### Happy Path
- Given prd_audit has 2 blocking FR gaps and as-built is BLOCKED on 1 ADR violation,
  when the join dispatches remediate, then `.pipeline/remediation.json` from that single
  session contains a disposition for every one of the 3 gaps (heterogeneous ids: FR-N
  and ADR-stem).
- Given the dispositions route to different steps, when the engine merges, then the
  rewind target is the earliest routed step and later-step dispositions are preserved in
  the work order for their gates to re-check on the next pass.

#### Negative Paths
- Given remediate's plan halts (`kind: 'halt'` — architectural-clarity or product-scope
  gap), when the join applies it, then the run halts with the remediation detail — the
  passing validators' verdicts do not override a human-gated gap.
- Given remediate returns dispositions for only a subset of the presented gaps, when the
  engine merges, then the unaddressed gaps' gates remain unsatisfied (they re-block on
  the next tail pass) — a partial plan cannot green-light an unplanned gap.
- Given the per-gate remediation budget (`remediationRounds`) is at cap, when the join
  would dispatch remediate again, then the run halts exactly as the serial path does
  today.

### Done When
- [ ] Engine test: 3-gap union → one remediate run, 3 dispositions consumed, earliest
      target chosen
- [ ] Engine test: halt disposition → loop_halt with remediation detail despite sibling
      PASSes
- [ ] Engine test: budget cap honored (no third remediate dispatch)

---

## Story: Rate-limited branch enters the shared episode without burning retries

**Requirement:** TS-CORE §Decision-4

As a daemon operator, I want a 429 in any branch to coordinate with the shared
rate-limit episode so that concurrent validators respect the provider window instead of
independently hammering it.

### Acceptance Criteria

#### Happy Path
- Given branch A receives a rate-limit result with a parsed deadline, when the core
  handles it, then the shared episode's deadline is entered (later-deadline-wins), the
  branch waits on `clear()`, and its retry does NOT decrement its retry budget.
- Given branch A is waiting out an episode, when branch B also gets rate-limited with a
  later deadline, then the episode deadline extends to B's deadline and both branches
  resume after the later window.

#### Negative Paths
- Given a branch is waiting on the episode, when the daemon sends SIGTERM/abort, then
  the branch's wait aborts via the abort-controller path (no orphaned timer keeps the
  process alive) and per-branch state persists.
- Given the episode is active from a prior step, when the validation group starts, then
  no branch dispatches until the episode clears (the group respects an inherited
  episode, same as the serial loop).
- Given a branch returns `authFailure` or `sessionExpired` (not rateLimited), when the
  core handles it, then the existing serial-loop semantics for that result apply to that
  branch (not silently treated as a generic failure).

### Done When
- [ ] Engine test with fake episode: two branches, staggered 429s → single shared
      deadline, both resume, retry budgets unchanged
- [ ] Engine test: abort during episode wait → branch exits cleanly, state written
- [ ] Engine test: authFailure in a branch → same handling class as the serial loop
      (assert against the serial baseline's behavior)

---

## Story: Each branch runs its own skill in its own fresh session

**Requirement:** TS-CORE §Decision-2/3

As a harness maintainer, I want per-branch skill dispatch and per-branch fresh sessions
so that concurrent validators can't interleave conversational state or run the wrong
step.

### Acceptance Criteria

#### Happy Path
- Given the validation group dispatches manual_test and prd_audit concurrently, when the
  step runner is invoked, then each invocation carries that member's own step name and a
  session id minted for that branch (`resume: false`), and the two session ids differ.
- Given a config-DSL `parallel:` group with branches naming different skills, when the
  group runs through the core, then each branch's session invokes its OWN skill (the
  ADR-004 dispatch bug is dead).

#### Negative Paths
- Given a branch retries after a transient failure, when the retry dispatches, then it
  resumes that branch's OWN session id (step-retry-resumes-session semantics preserved
  per branch), never a sibling's.
- Given two branches run concurrently, when either writes session markers
  (`.pipeline/session-created`, `conduct-session-id`), then the shared `this.sessionId`
  of the serial runner is not mutated by branch execution (assert it is unchanged after
  the group completes).

### Done When
- [ ] Runner-spy test: invocation list shows per-member step names and distinct
      fresh session ids
- [ ] DSL test (rewritten when-parallel suite): branch skills dispatch individually
- [ ] Test asserting the shared runner session id is identical before/after a group run

---

## Story: validation_concurrency config key bounds the fan-out

**Requirement:** TS-CORE §Decision-1

As a daemon operator, I want a config knob for group concurrency so that I can tune
burst rate against my provider limits.

### Acceptance Criteria

#### Happy Path
- Given no config key, when the group resolves its cap, then it is 2.
- Given `validation_concurrency: 3` in `.ai-conductor/config.yml`, when three members
  are applicable, then all three dispatch concurrently.
- Given `validation_concurrency: 1`, when the group runs, then members execute one at a
  time (serial behavior via the group path).

#### Negative Paths
- Given `validation_concurrency: 0`, a negative number, or a non-numeric value, when
  config resolves, then the cap clamps to the documented safe value (0/negative/NaN →
  default 2 semantics mirrored from `rebase_resolution_attempts` handling) and a
  validation note is surfaced — the engine never dispatches zero-width concurrency or
  crashes.
- Given an unknown sibling key (typo like `validation_concurency`), when
  `validateConfig` runs, then it is rejected by the existing unknown-top-level-key rule
  (the allow-list gains exactly one key).

### Done When
- [ ] config unit tests: default, explicit 1/2/3, clamp cases, typo rejection
- [ ] README.md + src/conductor/README.md document the key, default, and clamp rule in
      the same PR (docs-track-features gate)

---

## Story: Single-writer state and gate verdicts at the join

**Requirement:** TS-CORE §Decision-6; TS-JOIN §Decision-5

As a harness maintainer, I want branches to return outcomes while only the core writes
shared files so that concurrent validators cannot corrupt conduct-state.json or gate
verdicts.

### Acceptance Criteria

#### Happy Path
- Given branches complete in any order, when the join runs, then conduct-state.json is
  written by the core with every member's synthetic key and final statuses in one
  consistent snapshot.
- Given each member's gate check runs at join, then `.pipeline/gates/«member».json`
  verdicts are written serially by the core (never from inside a branch's concurrent
  context).

#### Negative Paths
- Given two branches finish within the same tick, when their outcomes record, then no
  interleaved/partial state-file write occurs (test via write-spy asserting all state
  writes happen on the core's thread of control, after the join point or at explicit
  serialization points).
- Given a branch's stale `.pipeline` review marker exists from a prior round, when that
  member re-dispatches, then the per-member stale sweep (`STALE_SWEEP_STEPS`) removes
  ONLY that member's marker — a sibling's fresh marker from this round is never swept.

### Done When
- [ ] Write-spy test: zero state-file writes originate inside branch execution
- [ ] Stale-sweep test: per-member sweep isolation across a group retry round
- [ ] Gate-verdict files present and well-formed for all members after a mixed-verdict
      join

---

## Story: Group progress is observable in the event stream

**Requirement:** TS-CORE §Decision-8

As a daemon operator following logs, I want branch-attributed events so that interleaved
concurrent output remains diagnosable.

### Acceptance Criteria

#### Happy Path
- Given the group starts, when events are emitted, then `parallel_started` carries the
  group name and the resolved member list, and each member's step-level events carry the
  member/branch identity.
- Given a member fails, when `parallel_failure` emits, then it names the member and the
  error; given all members succeed, `parallel_completed` emits with the member list.

#### Negative Paths
- Given a member is skipped by tier/track rules, when the group runs, then the member
  list in `parallel_started` reflects only dispatched members (observers never see a
  phantom member), while skipped members emit their existing skip events.
- Given the daemon log renders interleaved branch events, when two members emit
  simultaneously, then no event is attributable to the wrong member (event payload, not
  ordering, carries identity).

### Done When
- [ ] Event-stream test: mixed-outcome group emits started/failure/completed with
      correct member attribution
- [ ] Skip-case test: phantom members absent from group events

---

**Status:** Accepted (operator-approved 2026-07-10)
