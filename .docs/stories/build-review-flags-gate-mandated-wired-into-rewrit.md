**Status:** Accepted

# build_review sees the wiring_check instruction it is grading the response to (#1399)

Track: technical (no PRD — acceptance criteria live here)
Tier: S

## Context

`wiring_check` and `build_review` issue contradictory instructions about the same
`Wired-into:` plan contract, and neither can see the other.

When `wiring_check` finds a task whose declared-inert contract contradicts the diff, it kicks
back to BUILD with gap text that **explicitly instructs the fix** — "contract is stale, switch
to a declared call site". The build agent complies by rewriting the anchors in
`.docs/plans/<stem>.md`. `build_review`'s Scope rubric then FAILs the build on that very
compliance, because rubric item 2 treats any modification of `.docs/plans/` as unauthorized
"unless the approved plan justifies it" — and the grader has no way to know a gate demanded it.
`remediate` then derives the only remedy the finding supports, restoring the original anchors,
which re-triggers the identical `wiring_check` failure. The loop does not terminate without a
human.

Observed on `adr-approval-gate-before-build` (since shipped as #1384; its `.pipeline/`
artifacts are no longer on disk, so coverage here is fixture-based rather than a replay).
Cost: one `needs-human` HALT, operator forensics across three artifacts, and a `remediate`
routing to DECIDE that tripped the DECIDE-entry refusal.

`build_review` already has the right shape for the fix. Its grader prompt carries two
**engine-recorded context** sections — `## Engine-recorded rebase repair context` and
`## Engine-accepted scope widenings` (`build-review-prompt.ts:90,94`) — both framed as
*evidence, not exemption*: the grader judges whether an apparently out-of-plan hunk actually
implements the recorded context, and unmatched work stays subject to every rubric. The gate
instruction belongs in a third such section.

The instruction is already an engine-emitted occurrence: `conductor.ts:7243` emits
`{ type: 'kickback', from: 'wiring_check', to: 'build', evidence, count }` at the moment the
gate issues it. No new channel, no new writer, no new schema — the event is currently
`persist: false` in `event-sinks.ts:56`, so it reaches the audit trail but not the event
ledger; persisting it makes the structured record readable where `build_review` assembles its
inputs.

**Scope:** `wiring_check` only. Making `remediate` reject a remedy that contradicts a recorded
gate instruction is a distinct mechanism, filed separately.

## Story 1: The gate instruction is persisted to the event ledger

**Requirement:** Technical intent — the instruction must be durably readable as structured data.

As the conductor engine, I want each `wiring_check` → `build` kickback persisted to
`.pipeline/events.jsonl`, so that a later reader recovers `from`, `to`, and the verbatim gap
text as fields rather than by parsing a prose string.

### Acceptance Criteria

#### Happy Path
- Given a run in which `wiring_check` kicks back to `build`, when the kickback event is
  emitted, then a line is appended to `.pipeline/events.jsonl` whose parsed JSON has
  `type: "kickback"`, `from: "wiring_check"`, `to: "build"`, an `evidence` string equal to the
  newline-joined gap messages, a numeric `count`, and a `ts` timestamp.
- Given the same run, when the kickback is emitted, then the existing audit-trail record at
  `.pipeline/audit-trail/events.jsonl` is still written unchanged, so no existing consumer of
  the audit trail loses a record.
- Given two kickbacks in one run, when both are emitted, then both appear as separate lines in
  ledger order, each carrying its own `count`.

#### Negative Paths
- Given a consumer that reads `.pipeline/events.jsonl` and switches on `type` (the report
  renderer, the timing rollup, the cost rollup), when `kickback` lines are now present, then
  the consumer produces the same output it produced before for every other event type and does
  not error on the unrecognized line.
- Given a kickback emitted with no `evidence` (the field is optional on the union member), when
  the line is persisted, then the line is still valid JSON with `evidence` absent, and no
  writer throws.

### Done When
- [ ] `event-sinks.ts` declares `kickback: { render: true, persist: true, audit: true }`.
- [ ] A test asserts a `kickback` line lands in `.pipeline/events.jsonl` with all of
      `type`/`from`/`to`/`evidence`/`count` intact after a JSON round-trip.
- [ ] A test asserts the audit-trail record for the same kickback is unchanged.

## Story 2: build_review's input assembly collects this feature's wiring_check instructions

**Requirement:** Technical intent — the grader's inputs must carry the recorded instruction.

As the `build_review` step, I want my assembled inputs to include the `wiring_check` → `build`
kickbacks recorded for this feature, so that the grader is judging the response to an
instruction it can actually see.

### Acceptance Criteria

#### Happy Path
- Given `.pipeline/events.jsonl` contains two `{type:"kickback", from:"wiring_check",
  to:"build"}` lines, when `assembleBuildReviewInputs` runs, then the returned inputs carry
  both, in ledger order, each with its verbatim `evidence` text and its `count`.
- Given the ledger contains no `wiring_check` kickbacks, when `assembleBuildReviewInputs` runs,
  then the returned collection is empty — the same shape `repairContext` and
  `acceptedWidenings` use when they have nothing.
- Given the ledger contains kickbacks, when `assembleBuildReviewInputs` runs, then the graded
  `diff` is unchanged from today's output — `.pipeline/` remains excluded via
  `MACHINERY_AUTHORED_PATHS`, so the ledger never appears in the diff being graded.

#### Negative Paths
- Given `.pipeline/events.jsonl` does not exist, when `assembleBuildReviewInputs` runs, then it
  returns normally with an empty collection and does not throw — matching the fail-open posture
  of `readKickbackLedger`.
- Given `.pipeline/events.jsonl` exists but three of its lines are truncated or malformed JSON,
  when `assembleBuildReviewInputs` runs, then every well-formed `wiring_check` kickback line is
  still returned, the malformed lines are skipped, and no error propagates to the caller.
- Given the ledger is unreadable (permission denied), when `assembleBuildReviewInputs` runs,
  then it returns an empty collection rather than throwing, so a degraded ledger can never
  block a build_review that would otherwise run.
- Given the ledger contains a `{type:"kickback", from:"test_suite", to:"build"}` line, a
  `{type:"kickback", from:"wiring_check", to:"plan"}` line, and a `{type:"step_failed",
  step:"wiring_check"}` line, when `assembleBuildReviewInputs` runs, then none of the three is
  returned — only `from:"wiring_check"` **and** `to:"build"` qualifies.
- Given the assembled inputs, when they are inspected, then they contain no `.pipeline/
  task-status.json` content, no session transcript, and no maker summary — the grader's input
  isolation is unchanged, and the only added material is engine-computed gap text.

### Done When
- [ ] `BuildReviewInputs` carries a new optional field for the recorded gate instructions,
      documented in the same style as `repairContext` and `acceptedWidenings`.
- [ ] `assembleBuildReviewInputs` populates it, with tests covering: present, absent, missing
      file, malformed lines, unreadable file, and the wrong-`from`/wrong-`to`/wrong-`type`
      rejections.
- [ ] A test asserts the returned `diff` is byte-identical to the pre-change output for the
      same repository state.

## Story 3: The grader is shown the instruction as evidence, not as an exemption

**Requirement:** Technical intent — a gate-mandated plan edit must stop reading as a Scope violation.

As the `build_review` grader, I want a third engine-recorded context section naming the gate
instructions issued during this build, so that a `.docs/plans/` hunk that implements one is
judged on whether it actually implements it — while an untraceable plan edit still fails Scope.

### Acceptance Criteria

#### Happy Path
- Given inputs carrying one `wiring_check` instruction, when the grader prompt is assembled,
  then it contains a third engine-recorded context section, positioned alongside the existing
  rebase-repair and scope-widening sections, rendering the instruction's `from` gate and its
  verbatim `evidence` text.
- Given inputs carrying no instructions, when the prompt is assembled, then that section
  renders `(none)`, exactly as the two existing sections do when empty.
- Given the section is present, when its instructional prose is read, then it states that the
  instructions are evidence and not an exemption, directs the grader to judge whether the
  `.docs/plans/` hunk implements the recorded instruction, and states that unmatched work
  remains subject to every rubric item — mirroring the existing sections' framing.
- Given inputs carrying two instructions, when the prompt is assembled, then both are rendered
  as separate entries, each independently attributable to its gap text.

#### Negative Paths
- Given a diff that rewrites a `Wired-into:` anchor in `.docs/plans/<stem>.md` and an
  instruction whose `evidence` names that task and anchor, when the grader evaluates Scope,
  then the hunk is not reported as an unauthorized DECIDE-artifact modification.
- Given a diff that rewrites unrelated prose in `.docs/plans/<stem>.md` while the only recorded
  instruction concerns a different task's anchor, when the grader evaluates Scope, then the
  edit still fails Scope — the section grants no blanket permission to touch the plan.
- Given a diff that modifies `.docs/specs/` or `.docs/stories/` while an instruction is
  recorded, when the grader evaluates Scope, then those edits still fail Scope — the recorded
  instruction covers only what it actually instructed.
- Given `evidence` text containing backticks and triple-backtick fences, when the prompt is
  assembled, then the surrounding prompt structure is not broken and every other section
  remains parseable.
- Given the prompt is assembled, when it is inspected, then it still references no maker
  transcript, task-status file, or self-report.

### Done When
- [ ] `buildGraderPrompt` renders the third section with an `(none)` empty fallback, tested for
      both the populated and empty cases.
- [ ] A test asserts the section's prose carries the evidence-not-exemption framing and the
      "unmatched work remains subject to every rubric" clause.
- [ ] A test asserts the two pre-existing engine-recorded sections render byte-identically to
      their current output.
- [ ] A test feeds `evidence` containing backticks and asserts the assembled prompt keeps every
      section boundary intact.
