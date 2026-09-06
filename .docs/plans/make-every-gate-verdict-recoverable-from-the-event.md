# Implementation Plan: Recoverable gate verdicts

**Date:** 2026-09-06
**Stories:** .docs/stories/make-every-gate-verdict-recoverable-from-the-event.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing telemetry contract — one event union, one persister, one audit trail, one OpenTelemetry projection — and turns on an existing sink rather than adding a channel, a variant, or a field.

## Summary

Five bounded tasks deliver #2067: the existing gate-verdict event becomes a persisted ledger record, the SHIP validation-group join gains the emission it never had, and both renderers state a satisfied verdict instead of suppressing it. Renaming the audit gate, rewording a gate report's own summary line, audit-trail changes, and OpenTelemetry changes are outside this slice.

## Technical Approach

The verdict event already exists, is already emitted on the serial path, and is already projected to the audit trail and to OpenTelemetry. Only three things are missing, and each is independent of the others.

First, persistence. The sink table declares this event `persist: false`, so the persister never subscribes to it and the run ledger has no verdict record at all. Flip that single declaration and add the type to the pinned persisted-event contract in its test; the pinned list is deliberately an exact set, so a newly persisted type must be declared there. Persisting is safe by inspection: the persister only computes intervals for the step-open, step-close, and group-close types, so a verdict record carries no interval and closes none, and existing ledger readers select by event type rather than scanning positionally.

Second, the missing emission. The serial walk emits a verdict for any gate it just ran, and the finish fence emits one per non-green validator. The SHIP validation group is the third path: at its join it recomputes each dispatched member's objective verdict from on-disk evidence into a local map, writes the per-member verdict file, and emits nothing. That is why the audit gate — a group member in auto mode — has no verdict in the log, in the ledger, or in the audit trail. Add the emission at the join, after the point where the accepted-risk audit route may replace a member's computed verdict, so the recorded value is the one the join acted on rather than a superseded intermediate. Emit only for members the join actually computed a verdict for, and use the same tracked emitter the surrounding join code already uses so the breadcrumb and forwarding behavior are identical to every neighbouring emission. Do not touch the all-green decision, the kickback target selection, or the verdict files.

Third, the render. Both renderers currently return early for a satisfied verdict, which is defensible on its own but was paired with no persistence, so quieting the log also erased the record. Render both outcomes: state the verdict in words, keep the existing unsatisfied wording, and append the reason only when the event carries one. Deliberately do not reuse the provider-completion check glyph, because the confusion this issue reports is precisely that a provider-completion marker reads as a gate pass; a line that says a gate verdict in words and carries no completion glyph is distinguishable from one that carries the glyph and states no verdict.

For the group-join proof, follow the local fixture pattern already used by the parallel-validation fan-out acceptance test: seed a temporary repository with every step before the first validator marked done on a product-track, medium-tier feature, then drive the real conductor with an injected fake step runner that writes each member's completion artifact, auto mode, daemon on, artifact verification on, and entry at the first validator so the run is bounded to the join. The traits that matter are the injected runner, the real internal path with no third-party call, and a run that ends at the observation; assertion style and fixture builders may vary. Search hints: the seeding and conductor-construction helpers in that acceptance file, and the group-core join code in the conductor. Unit-level assertions belong in the sink test and the two render tests; the conductor run is used only where the behavior is the wiring itself.

## Preconditions and claim ledger

- Operator approved the Small scope, the technical track, the two stories, and the exclusion of the gate rename and report-summary wording on 2026-09-06 (delegated).
- Verified: the sink declaration for the gate verdict is `render: true, persist: false, audit: true, otel: true`, and the persisted-type list is derived from that table.
- Verified: the sink test pins the persisted set as an exact list with an explicit comment that a newly persisted non-halt event must update that contract.
- Verified: the persister computes intervals only for the step-completed, step-failed, step-refused, parallel-completed, and terminal parallel-failure types, so a verdict record neither opens nor closes an interval.
- Verified: the conductor emits this event at exactly two sites — the finish validation fence and the post-run verdict tail — and the validation-group join computes member verdicts into a local map without emitting.
- Verified: the audit trail already maps a satisfied verdict to a pass record and de-duplicates against the positive-evidence record, so the new group-path emissions need no audit-trail change.
- Verified: both render branches suppress a satisfied verdict, and the daemon-render test asserts that suppression explicitly, so it is the RED anchor for the render tasks.
- Verified: the parallel-validation fan-out acceptance test drives a real auto-mode group dispatch with an injected fake step runner and a captured emitter, with no network, no provider, and no repository-wide suite invocation.
- Event spine: no new channel and no new variant — an occurrence the union already carries gains its missing sink and its missing emission site. No separate write location, so no event-spine exception is claimed.
- Scope check: A — consumer-facing engine behavior; B — n/a, no new skill; C — provider-agnostic.
- Verify-claims verdict: CLEAR. Every path, symbol, and behavior above was read in the worktree; no unconfirmed assumption changes the approach or the task breakdown.

## Tasks

### Task 1: Persist the gate verdict to the run event ledger
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/event-sinks.ts, src/conductor/test/engine/event-sinks.test.ts
**Dependencies:** none

**Steps:**
1. Add the gate-verdict type to the pinned persisted-event contract list in the sink test, and extend the persister-backed assertion so a satisfied verdict and an unsatisfied verdict each land as a ledger record carrying step, satisfied, and reason.
2. Verify RED: the pinned set and the persister assertion both fail while the declaration still says persist false.
3. Implement: set persist to true in that one declaration, leaving render, audit, and OpenTelemetry as they are, and add a short comment stating that a gate's verdict is the one gate output that must outlive the run.
4. Verify GREEN, confirm the audited, rendered, and OpenTelemetry exact-set assertions still pass untouched, then run the focused sink test through the project's scoped run and the typecheck target that covers tests, and commit.

**Done when:**
1. The gate-verdict sink declaration reads persist true with its render, audit, and OpenTelemetry values unchanged.
2. The pinned persisted-event contract enumerates the gate-verdict type, and a persister fixture writes a satisfied and an unsatisfied verdict as ledger records carrying step, satisfied, and reason.
3. The audited, rendered, and OpenTelemetry exact-set assertions pass unmodified.

### Task 2: Emit a verdict for every validation-group member at the join
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/integration/gate-verdict-observability.integration.test.ts
**Dependencies:** 1

**Steps:**
1. Create the new integration test file named in Files. Follow the local fixture pattern described in Technical Approach: seed a temporary repository with every step before the first validator marked done, product track, medium tier, then construct the conductor with an injected fake step runner that writes each member's completion artifact, auto mode, daemon on, artifact verification on, and entry at the first validator so the run stops at the join. Allowed variation: fixture builders and assertion grouping. Required traits: injected runner, real internal conductor path, no provider or network call, bounded run.
2. Assert one gate-verdict event per dispatched member — the manual test, the audit, and the as-built architecture review — and that the same three records appear in the run's persisted event ledger.
3. Verify RED: today the join emits none of them.
4. Implement: at the join, after the point where the accepted-risk audit route may replace a member's computed verdict, iterate the computed verdict map in member order and emit one gate-verdict event per member through the same tracked emitter the surrounding join code uses. Emit nothing for a member with no computed verdict, and leave the all-green decision, the kickback target selection, and the per-member verdict files unchanged.
5. Verify GREEN, run the focused integration file through the project's scoped run and the typecheck target that covers tests, and commit.

**Done when:**
1. An auto-mode group-join integration fixture observes one gate-verdict event and one persisted ledger record per dispatched validation-group member, including the audit member.
2. The emission runs after the accepted-risk audit route may replace a member verdict, so the emitted value is the verdict the join acted on.
3. The join's all-green decision, its kickback target selection, and the per-member verdict files on disk are unchanged by the new emission.

### Task 3: Record the effective member verdict and never a fabricated one
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/test/integration/gate-verdict-observability.integration.test.ts
**Dependencies:** 2

**Steps:**
1. Add a fixture whose audit report carries a finding the accepted-risk route records rather than blocks, so the join replaces that member's computed verdict, and assert the recorded verdict is the post-replacement one rather than the superseded value.
2. Add a fixture in which one member's dispatch does not return a passing outcome, and assert no gate-verdict record exists for that member while the other dispatched members still have theirs.
3. Verify RED against the emission from Task 2 placed before the replacement point, then confirm GREEN with it placed after.
4. Run the focused integration file through the project's scoped run and commit.

**Done when:**
1. The override fixture's recorded audit verdict equals the verdict the join acted on, not the superseded computed value.
2. A member whose dispatch does not return a passing outcome has no gate-verdict record, while its dispatched siblings keep theirs.

### Task 4: State a satisfied verdict in both renderers
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/daemon-cli.ts, src/conductor/src/ui/terminal-renderer.ts, src/conductor/test/engine/daemon-render.test.ts, src/conductor/test/ui/terminal-renderer.test.ts
**Dependencies:** none

**Steps:**
1. Replace the daemon-render case that asserts a satisfied verdict renders nothing with cases asserting exactly one line naming the step and stating the verdict as satisfied, with the reason appended when present, and add the equivalent case to the interactive renderer's test.
2. Verify RED: both renderers return early for a satisfied verdict today.
3. Implement: in both gate-verdict render branches, render both outcomes — a satisfied verdict in a distinct successful style and the unsatisfied branch keeping its current text — appending the reason only when the event carries one, and deliberately using no provider-completion check glyph on either line.
4. Assert the rendered satisfied line carries no provider-completion glyph while the provider-attempt line still carries it.
5. Verify GREEN, run both focused render tests through the project's scoped run and the typecheck target that covers tests, and commit.

**Done when:**
1. Both renderers emit exactly one line for a satisfied verdict, naming the step and stating the verdict as satisfied, with the reason appended when present.
2. A rendered satisfied-verdict line contains no provider-completion check glyph, and the provider-attempt line still carries it.
3. The daemon-render sample guard still reports the gate-verdict type as rendering and reports no other type newly rendering.

### Task 5: Hold the verdict-render edges
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/test/engine/daemon-render.test.ts, src/conductor/test/ui/terminal-renderer.test.ts, src/conductor/test/engine/daemon-log.test.ts
**Dependencies:** 4

**Steps:**
1. Add a reasonless satisfied verdict case to both render tests and assert the line states the verdict and ends with no trailing separator and no empty reason.
2. Assert the unsatisfied daemon line's text is byte-identical to its current expectation.
3. Add a satisfied gate verdict to the daemon-log rendered-variant sample list and assert the kickback anchor text still appears on exactly one line.
4. Verify RED where the new cases are not yet satisfied, then GREEN, run the three focused files through the project's scoped run, and commit.

**Done when:**
1. A reasonless satisfied verdict renders with no trailing separator and no empty reason in either renderer.
2. The unsatisfied daemon-log line keeps its current text unchanged.
3. The kickback anchor appears on exactly one line when a satisfied verdict is among the rendered event samples.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a run computes a gate's objective verdict, when the run appends its events, then the run's persisted event ledger carries a gate-verdict record naming that step, its satisfied flag, and its reason. | 1 | "The pinned persisted-event contract enumerates the gate-verdict type, and a persister fixture writes a satisfied and an unsatisfied verdict as ledger records carrying step, satisfied, and reason." | diff-local |
| Story 1 happy: Given an auto-mode run dispatches the SHIP validation group and joins it, when each dispatched member's objective verdict is computed at that join, then the ledger carries one gate-verdict record per dispatched member, including the PRD-audit member. | 2 | "An auto-mode group-join integration fixture observes one gate-verdict event and one persisted ledger record per dispatched validation-group member, including the audit member." | diff-local |
| Story 1 negative: Given the join replaces the PRD-audit member's computed verdict with the accepted-risk route result, when that member's verdict is recorded, then the record carries the verdict the join acted on rather than the superseded one. | 3 | "The override fixture's recorded audit verdict equals the verdict the join acted on, not the superseded computed value." | diff-local |
| Story 1 negative: Given a dispatched member's branch does not return a passing dispatch outcome, when the group settles, then no gate-verdict record is written for that member. | 3 | "A member whose dispatch does not return a passing outcome has no gate-verdict record, while its dispatched siblings keep theirs." | diff-local |
| Story 2 happy: Given a gate's verdict is satisfied, when the daemon log renders that event, then it emits one line naming the step, stating the verdict as satisfied, and carrying the verdict's reason when one is present. | 4 | "Both renderers emit exactly one line for a satisfied verdict, naming the step and stating the verdict as satisfied, with the reason appended when present." | diff-local |
| Story 2 happy: Given a gate's verdict is satisfied, when the interactive terminal renderer renders that event, then it emits one line naming the step and stating the verdict as satisfied. | 4 | "Both renderers emit exactly one line for a satisfied verdict, naming the step and stating the verdict as satisfied, with the reason appended when present." | diff-local |
| Story 2 happy: Given a step's provider-completion marker and that step's satisfied gate verdict are both rendered, when an operator reads the two lines, then only the provider-completion line carries the provider-completion check glyph and only the verdict line states a gate verdict. | 4 | "A rendered satisfied-verdict line contains no provider-completion check glyph, and the provider-attempt line still carries it." | diff-local |
| Story 2 negative: Given a satisfied verdict carries no reason, when either renderer renders it, then the line states the verdict and ends without a trailing separator or an empty reason. | 5 | "A reasonless satisfied verdict renders with no trailing separator and no empty reason in either renderer." | diff-local |
| Story 2 negative: Given an unsatisfied verdict, when the daemon log renders it, then the existing unsatisfied line is unchanged and the kickback anchor text still appears on no line but a kickback line. | 5 | "The kickback anchor appears on exactly one line when a satisfied verdict is among the rendered event samples." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local against controlled fixtures. Task 1 owns the sink contract and the persister-backed ledger assertion at unit level. Task 2 owns the cross-boundary integration proof for this change: the group-join dispatch is the production boundary where a member's verdict is computed, and its observable behavior is the verdict event reaching the live bus and the run's ledger through the real conductor path with an injected runner. Task 3 owns the two negative fixtures over that same boundary. Tasks 4 and 5 own the render behavior at the two renderer entry points, which are the operator-facing boundaries for this change. No third-party service, provider, or repository-wide suite invocation participates in any of them, and no terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 2 -> Task 3
Task 4 -> Task 5

Task 1 and Task 4 have no dependencies and may run concurrently.
