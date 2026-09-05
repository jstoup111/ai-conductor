# Implementation Plan: Closeout tail corruption recovery

**Date:** 2026-09-05
**Source-Ref:** jstoup111/ai-conductor#2173
**Stories:** .docs/stories/closeout-tail-corrupt-line-recovery-2173.md
**Conflict check:** S exemption; no blocking conflicts identified in the bounded tail repair.

## Technical Approach

Repair CloseoutEventTail and its private reader in place. Parse newline-terminated records individually, consume malformed complete lines, and retain the existing byte-based cursor and unfinished-suffix behavior. Add `pipeline_tail_diagnostic` to ConductorEvent with `reason: 'malformed-line' | 'poll-failed'`, `path: string` containing the fixed relative ledger path, and optional `byteOffset: number` identifying the skipped line's start. Omit raw record contents and exception messages: the reason and location suffice and cannot echo sensitive corrupt payloads. Persist and render this event using the existing bus, EventPersister, daemon renderer and terminal subscriber; do not append diagnostics to the source ledger or invent a sidecar.

Make public poll calls share one in-flight promise covering both reading and awaited emission. Establish that promise before any asynchronous gap and clear it on success or failure; avoid an ignored rejecting promise from a bare `.finally()` chain. The timer keeps the current one-second interval but attaches a terminal rejection handler that emits `poll-failed`, containing even diagnostic-reporting failure. Direct callers retain an awaitable failure on unexpected I/O; missing-file remains an empty read. A failed read does not advance the cursor. Stop clears the timer synchronously as today; it does not cancel an already running owned poll.

Follow existing temporary-ledger integration fixtures in `src/conductor/test/closeout-tail.test.ts`, with real bytes only where bytes are under test. Add a narrow optional injected read dependency only if required to control overlap and errors without module-wide mocks. Use deferred promises and fake timers, await every started operation, and stop the tail before fixture cleanup. The emitter already swallows subscriber failures; preserve that contract. No Conductor.run(), LLM, GitHub, external process, or network is needed.

The existing approved pipeline-owned closeout architecture remains unchanged: the source file is the pipeline's same-schema sibling ledger; the new diagnostic is an engine occurrence on its existing emitter. No acceptance/system spec is required: real tail/emitter/persister collaboration and lower-layer renderer checks sufficiently cover this feature.

## Prerequisites

No outstanding issue dependency or environment provisioning. Use the existing source, test runner and generated event-sink contracts. All criteria concern behavior owned by this diff (`diff-local`); no claim depends on another feature delivering work.

## Tasks

### Task 1: Consume corrupt complete lines with one typed diagnostic

**Story:** Story 1; Story 3 malformed-line event payload
**Type:** negative-path
**Dependencies:** none
**Files:** src/conductor/src/engine/closeout-tail.ts, src/conductor/src/types/events.ts, src/conductor/src/engine/event-sinks.ts, src/conductor/test/closeout-tail.test.ts, src/conductor/test/engine/event-sinks.test.ts
**Files likely touched:** same as Files.

**Steps:**
1. Extend the existing temporary-ledger tests with A/invalid/B, repeated polling, UTF-8 bytes, blank lines, and a corrupt incomplete suffix that receives its newline later. Assert A/B exactly once in order and a single diagnostic at the invalid line's byte position. Establish RED through `ai-conductor scoped-run test/closeout-tail.test.ts` from src/conductor.
2. Replace all-or-nothing JSON parsing with per-complete-line recovery. Preserve byte offsets, absent-file behavior, and actual-truncation reset. Carry malformed-line locations out of the reader so the owner can emit diagnostics using its existing emitter; consuming a completed malformed row must advance past it even if reporting fails. Preserve successfully parsed event behavior without introducing schema validation.
3. Add the diagnostic union member and its EVENT_SINKS declaration: render true, persist true, audit false, otel false. Reuse the table's typed exhaustive registration pattern. Emit each skipped line's diagnostic once during the same tail traversal; use the relative path and byte offset, not raw content.
4. Run scoped tail/sink tests for GREEN; preserve existing partial-record and missing-file tests, and add a real truncation case only if existing coverage does not suffice. Commit the behavior.

**Done when:**
- The tail entry point emits A and B once across repeated polls and exactly one malformed-line diagnostic at the bad line's byte offset.
- An unfinished suffix produces no diagnostic until newline completion, and UTF-8 content does not shift later byte positions.
- Missing files and blank lines remain silent; real truncation still resets as before.
- EVENT_SINKS registers the diagnostic for rendering and persistence, excluding audit/OTel.

### Task 2: Serialize all poll callers over one in-flight operation

**Story:** Story 2
**Type:** infrastructure
**Dependencies:** 1
**Files:** src/conductor/src/engine/closeout-tail.ts, src/conductor/test/closeout-tail.test.ts
**Files likely touched:** same as Files.

**Steps:**
1. Add deferred-read and deferred-subscriber tests using the existing emitter and tail entry point. Start two direct polls and trigger timer ticks while the first traversal is blocked; assert one active traversal and that both direct callers await it. Establish RED with the scoped tail tests.
2. Store and share the active promise for the complete read-and-emit operation. Register it before asynchronous work can overlap. Release it on both settled outcomes without creating a detached rejecting cleanup promise.
3. Resolve the deferred operations, append one new event, and poll again. Assert no duplicate event, no cursor reset from drift, and delivery only of the appended event. A rejected injected read must release the guard and leave unread bytes available to the next successful poll.
4. Verify GREEN with fake timers and no real sleeps, await all started promises, and commit.

**Done when:**
- Concurrent explicit and timer polls have at most one active read/emission traversal and produce no duplicate delivery.
- After a slow traversal, the next poll emits only newly appended records without cursor drift or replay.
- A failed traversal releases in-flight ownership and a subsequent successful poll delivers unread records.

### Task 3: Own background rejections and preserve timer lifecycle

**Story:** Story 3 background failure, recovery and lifecycle criteria
**Type:** negative-path
**Dependencies:** 2
**Files:** src/conductor/src/engine/closeout-tail.ts, src/conductor/test/closeout-tail.test.ts
**Files likely touched:** same as Files.

**Steps:**
1. Add a fake-timer test that injects a non-ENOENT read failure, then a successful read. Observe the timer callback's completion and emitted diagnostics; the failing tick must not leak a rejected promise. Establish RED through the scoped tail tests.
2. Attach terminal handling to the background poll invocation, emitting the `poll-failed` diagnostic through the existing emitter. Explicit poll callers may still observe the original read rejection. Ensure an unexpected diagnostic-reporting failure is contained by the background callback, with no recursive reporting loop.
3. Cover throwing/rejecting diagnostic subscribers with the real emitter. Preserve idempotent start and synchronous stop: repeated start creates one interval, stop prevents new polls, and already running work retains its rejection owner. Use deferred promises and fake timers; settle pending work before removing fixture state.
4. Verify GREEN and commit the failure/lifecycle behavior.

**Done when:**
- A failed background read emits a poll-failed diagnostic without an unhandled rejection and does not advance the cursor.
- The next successful tick emits unread complete records; a failing diagnostic subscriber cannot poison later ticks.
- Repeated start creates one polling timer, and no new background poll begins after stop.

### Task 4: Deliver tail diagnostics through existing persistence and rendering

**Story:** Story 3 persisted and operator-visible diagnostics
**Type:** happy-path
**Dependencies:** 1
**Files:** src/conductor/src/daemon-cli.ts, src/conductor/src/ui/terminal-renderer.ts, src/conductor/src/ui/subscriber.ts, src/conductor/test/closeout-tail.test.ts, src/conductor/test/engine/daemon-render.test.ts, src/conductor/test/ui/terminal-renderer.test.ts
**Files likely touched:** same as Files.

**Steps:**
1. Add a real tail/emitter/EventPersister integration using a temporary source ledger with one malformed line. Assert exactly one persisted diagnostic after repeated polls. Add focused daemon/terminal rendering cases asserting relative path, reason and byte position without corrupt content. Establish RED through the scoped affected-test union.
2. Implement the new cases in existing renderers and register the diagnostic in the terminal subscriber's existing event list. Follow the renderer_error path's pattern for warnings; keep the event's own name and semantics, never relabel it as a renderer failure. Include it in the existing direct terminal-warning forwarding condition so subscribed terminal users receive the diagnostic.
3. Confirm the EVENT_SINKS-driven persister/daemon subscription automatically reaches the new type. Modify only required closed exhaustive test fixture maps if the added union member makes them fail; do not add a new persistence mechanism. Keep diagnostic output on the established event path.
4. Run the scoped affected tests for GREEN, plus the repository's test-covering typecheck, and commit the diagnostic integration.

**Done when:**
- A malformed line observed through CloseoutEventTail is persisted once in events.jsonl by EventPersister, while subsequent valid source events still arrive.
- Existing daemon and terminal renderers display the diagnostic reason, relative ledger path and byte position, with no raw corrupt payload.
- Terminal event subscription forwards this diagnostic to its existing warning presentation path.

## Coverage Dispositions

| Criterion | Lowest sufficient proof | Owner |
| --- | --- | --- |
| A/invalid/B continuation; one skip diagnostic | Real temporary-ledger tail/emitter integration | Task 1 |
| UTF-8, blank lines, partial suffix, missing ledger, truncation | Focused existing/extended tail integration cases | Task 1 |
| Overlapping direct/timer calls; once-only delivery and correct cursor | Deferred I/O/subscriber and fake-timer tail tests | Task 2 |
| Failure releases guard; unread records recover | Injected failure followed by successful poll | Task 2 |
| Background rejection containment and later recovery | Fake-timer callback with injected I/O failure | Task 3 |
| Subscriber failure and start/stop invariants | Real emitter plus fake timers | Task 3 |
| Persisted and visible diagnostic without corrupt payload | Tail/emitter/persister integration plus focused render cases | Task 4 |

## Integration Ownership

Task 1 owns source-ledger-to-live-bus corruption recovery; Task 2 owns poll concurrency at the same entry point; Task 3 owns timer failure/lifecycle behavior; Task 4 owns the new diagnostic's persistence/rendering boundary. Every task owns its scoped RED/GREEN proof. Aggregate tests and SHIP validators retain completed-feature verification; there is no terminal catch-all task.

## Verify-Claims

Verified directly: CloseoutTailReader reads complete newline-delimited bytes, advances only after the current JSON.parse map, and resets after actual shrinkage. CloseoutEventTail currently has no serialization or timer rejection owner. ConductorEventEmitter.emit contains subscriber failures. EVENT_SINKS declares existing diagnostic routing and EventPersister uses that declaration. All changes extend these existing seams. No pending load-bearing assumptions; verdict CLEAR.
