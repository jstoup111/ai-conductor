**Status:** Accepted

# Stories: Daemon stall remediation (halt-user-input-required → /remediate)

Feature: daemon-mode-route-halt-user-input-required-through (#459, tier M, technical track)
Authoritative design: `adr-2026-07-10-daemon-stall-remediation.md` (APPROVED).
Requirements tags TR-1..TR-7 map to the ADR's Decision points 1–7.

---

## Story: Capture the stall question before the marker is cleared

**Requirement:** TR-1 (ADR §1)

As a daemon operator, I want the engine to capture the build agent's question before the
stall marker is deleted, so that no downstream path can lose it.

### Acceptance Criteria

#### Happy Path
- Given a daemon-mode build gate miss with `.pipeline/halt-user-input-required` containing
  `Need user decision: which auth provider?`, when the stall breaker runs, then
  `.pipeline/build-stall-question.md` exists containing exactly that text BEFORE
  `clearHaltMarker` deletes the marker, and the `build_stall` event still fires with reason
  `halt_marker`.
- Given a marker with multi-line content, when the stall breaker runs, then the evidence
  file preserves the full content verbatim (all lines, original order).

#### Negative Paths
- Given a marker that exists but is empty or whitespace-only, when the stall breaker runs,
  then the evidence file is written with the placeholder line
  `(agent wrote no reason into halt-user-input-required)` and the flow proceeds — it does
  not throw and does not skip the remediation dispatch.
- Given the marker is deleted by another process between the existence check and the
  content read (read throws ENOENT), when the stall breaker runs, then the flow treats it
  as the empty-marker case (placeholder evidence) and proceeds without crashing the run
  loop.
- Given a stall in interactive (non-daemon) mode, when the stall breaker runs, then the
  evidence file is NOT required for the REPL handoff and the existing interactive behavior
  is byte-for-byte unchanged (REPL opens, recheck runs).

### Done When
- [ ] Engine test: marker content lands in `.pipeline/build-stall-question.md` before the
      marker is unlinked (assert file content + marker absence ordering).
- [ ] Engine test: multi-line and empty/whitespace marker cases produce verbatim /
      placeholder evidence respectively.
- [ ] Engine test: ENOENT race falls back to placeholder without an unhandled rejection.

---

## Story: Daemon-mode stall dispatches a build_stall remediation pass

**Requirement:** TR-2 (ADR §2)

As a daemon operator, I want a stalled build routed through /remediate before any HALT, so
that answerable questions never require me.

### Acceptance Criteria

#### Happy Path
- Given daemon mode, a `halt_marker` stall, and `remediationRounds` under
  `MAX_KICKBACKS_PER_GATE`, when the stall branch runs, then `planRemediation()` is invoked
  with a dispatch context naming the stall question and
  `hintSource = { source: 'build_stall', evidenceFile: '.pipeline/build-stall-question.md' }`,
  and a `kickback`-class event records the round.

#### Negative Paths
- Given interactive mode (mode ≠ auto / no daemon), when a `halt_marker` stall occurs, then
  NO remediation dispatch happens and the existing REPL path runs unchanged.
- Given a `no_task_progress` stall (no marker), when the stall branch runs, then NO
  remediation dispatch happens (out of scope, #280) and today's behavior is preserved.
- Given `remediationRounds` already at `MAX_KICKBACKS_PER_GATE`, when a `halt_marker` stall
  occurs, then no dispatch happens and the fail-safe HALT (TR-5) fires directly.
- Given the daemon auto-park layer fires first (empty plan / no-evidence threshold), when
  the gate miss is processed, then the park HALT wins exactly as today — the stall
  remediation branch never runs after a park.

### Done When
- [ ] Engine test: daemon + marker + budget → `stepRunner.run('remediate', …)` called once
      with the stall dispatch context (fake runner records the call).
- [ ] Engine test: interactive mode with marker → remediate NOT dispatched, REPL invoked.
- [ ] Engine test: `no_task_progress` stall → remediate NOT dispatched.
- [ ] Engine test: budget exhausted → remediate NOT dispatched, HALT written.

---

## Story: Answerable stall resumes the build without burning a retry

**Requirement:** TR-3 (ADR §3)

As a daemon operator, I want an answerable stall to resume the build with the answer and an
intact retry budget, so that a deliberate pause is not punished as a failure.

### Acceptance Criteria

#### Happy Path
- Given a `build_stall` remediation returning `{ kind: 'route', target: 'build' }` with a
  hint carrying the answer, when the stall branch consumes it, then the next build attempt
  is dispatched in the SAME retry loop with `retryReason` containing the answer, and the
  attempt counter is unchanged across the resume (`attempt--` before `continue`).
- Given the resumed attempt completes the gate, when the loop exits, then no HALT exists
  and the step succeeds normally.

#### Negative Paths
- Given the resume, when the retry-as-escalation ladder is consulted for the resumed
  attempt, then the ladder has NOT advanced relative to the pre-stall attempt (a deliberate
  resume is not an escalation signal — same rule as sessionExpired).
- Given a `route` outcome whose target is NOT `build` (planner misroutes a stall answer to
  `plan`/`acceptance_specs`/`architecture_review`), when the stall branch consumes it, then
  the outcome is treated as unanswerable: fail-safe HALT carrying the question (fail-closed;
  no navigateBack from inside the build loop).
- Given the resumed attempt stalls AGAIN with a new marker, when the stall branch runs,
  then a second remediation round is consumed (TR-6) — the resume must not reset or bypass
  the budget.

### Done When
- [ ] Engine test: route/build outcome → next `stepRunner.run('build', …)` receives the
      answer in `retryReason` and the loop's attempt count is not decremented by the resume
      (assert total attempts allowed is unchanged).
- [ ] Engine test: escalation ladder state identical before/after a stall resume.
- [ ] Engine test: route with target `plan` → HALT written carrying the question.

---

## Story: Human-scoped stall halts with the question verbatim

**Requirement:** TR-4 (ADR §4)

As a daemon operator, I want a genuine human-judgement stall to surface the agent's actual
question in the HALT, so I can act on it without forensics.

### Acceptance Criteria

#### Happy Path
- Given a remediation outcome `{ kind: 'halt' }` (category architectural-clarity or
  product-scope), when the stall branch handles it, then `.pipeline/HALT` is written with
  the agent's question as the first non-empty line, followed by the disposition detail
  (id, category, rationale), and the run loop exits as halted.
- Given that HALT file, when the retries-exhausted writer at the end of the loop runs, then
  the existing preserve-specific-reason seam keeps the question — the file does NOT read
  `step 'build' failed in auto mode (retries exhausted)`.

#### Negative Paths
- Given the question contains characters that could break downstream consumers (backticks,
  quotes, very long single line), when the HALT is written, then `readHaltReason` (first
  non-empty line) still returns the question text without truncation to less than the full
  first line and the daemon dashboard renders it.
- Given a halt disposition with a missing/empty rationale, when the HALT is written, then
  the question line is still present (detail degradation never removes the question).

### Done When
- [ ] Engine test: halt disposition → `.pipeline/HALT` first line equals the marker's first
      line; `loop_halt` event reason matches.
- [ ] Engine test: after the full failure path completes, HALT content is the question, not
      the generic retries-exhausted string.

---

## Story: Fail-safe — the question survives every degraded exit

**Requirement:** TR-5 (ADR §5)

As a daemon operator, I want the HALT to carry the question even when remediation itself
breaks, so the dead end is at worst as informative as the agent's last words.

### Acceptance Criteria

#### Happy Path
- Given any stall that ultimately halts, when the run loop returns, then `.pipeline/HALT`
  contains the captured question (from `.pipeline/build-stall-question.md`) as its first
  non-empty line.

#### Negative Paths
- Given the remediate dispatch throws (runner crash / spawn failure), when the stall branch
  handles the error, then the HALT is written carrying the question and the run loop exits
  halted — the exception does not escape the loop.
- Given `.pipeline/remediation.json` is malformed JSON or fails the session-freshness check
  (`readRemediationPlan` returns null → outcome `none`), when the stall branch consumes it,
  then the HALT carries the question.
- Given `remediationRounds` is exhausted before dispatch (TR-2 negative), when the stall
  branch short-circuits, then the HALT carries the question.
- Given remediation returns dispositions that are ALL dropped by engine validation (e.g.
  halt without category), when the plan reads as empty/none, then the HALT carries the
  question.

### Done When
- [ ] Engine test matrix (dispatch throws / malformed JSON / stale file / budget exhausted /
      all-dropped dispositions): every case ends with `.pipeline/HALT` whose first line is
      the question — zero cases produce the generic message or an empty HALT.

---

## Story: Repeat stalls are bounded by the shared remediation budget

**Requirement:** TR-6 (ADR §6)

As a daemon operator, I want ask→answer→ask loops to terminate deterministically, so a
confused agent cannot spin remediation forever.

### Acceptance Criteria

#### Happy Path
- Given two stalls in one run each answered by remediation, when a third stall occurs, then
  the budget (`MAX_KICKBACKS_PER_GATE = 2`) is exhausted and the fail-safe HALT fires
  carrying the third question — no third dispatch.

#### Negative Paths
- Given one stall remediation already consumed this run and a later prd_audit gate blocks,
  when the prd_audit remediation is attempted, then only one round remains — the counter is
  genuinely shared, not per-trigger (assert combined accounting).
- Given a stall answered in run A and the feature re-dispatched in a fresh run B, when a
  stall occurs in run B, then the budget has reset (per-run counter, matching existing
  remediationRounds semantics) and the dispatch proceeds.

### Done When
- [ ] Engine test: third stall in one run → no dispatch, HALT with question.
- [ ] Engine test: stall round + prd_audit round exhaust the shared budget together.

---

## Story: /remediate stall-question contract and docs

**Requirement:** TR-7 (ADR §7)

As a harness maintainer, I want the stall-question input mode documented in the skill
contracts, so the planner produces dispositions the engine consumes deterministically.

### Acceptance Criteria

#### Happy Path
- Given `skills/remediate/SKILL.md`, when the stall-question mode is read, then it
  specifies: evidence file is a question (not a gap list); disposition id `stall:<slug>`;
  an answerable question emits `disposition: "build"`, `tasks: []`, the answer in
  `rationale`; an unanswerable one emits `disposition: "halt"` with the existing category
  taxonomy; the verify-claims/halt-on-uncertain rule applies unchanged.
- Given `skills/pipeline/SKILL.md`, when the marker semantics section is read, then the
  daemon-mode behavior (remediation attempt before HALT; question preserved in the HALT)
  is documented alongside the existing interactive REPL semantics.

#### Negative Paths
- Given a stall disposition that DOES include tasks (planner judged new work is needed),
  when the engine consumes the plan, then existing plan-append + task-status re-seed
  machinery runs unchanged (tasks are appended, not rejected) — the `tasks: []` rule is a
  default for pure answers, not an engine-side rejection.
- Given the gap-remediation input modes (prd-audit / finish / as-built), when their
  sections are read post-edit, then their contracts are unchanged (tasks required non-empty
  for `build` gaps remains stated for gap mode).

### Done When
- [ ] `skills/remediate/SKILL.md` documents the stall-question mode (input, id grammar,
      disposition shape, halt taxonomy applies).
- [ ] `skills/pipeline/SKILL.md` documents daemon-mode marker routing.
- [ ] `README.md` + `src/conductor/README.md` reflect the new daemon behavior (docs-track-
      features rule).
- [ ] `test/test_harness_integrity.sh` passes (SKILL.md frontmatter/cross-refs intact).
