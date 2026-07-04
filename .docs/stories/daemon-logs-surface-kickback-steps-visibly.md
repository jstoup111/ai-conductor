**Status:** Accepted

# Stories: Daemon kickback log visibility

Technical track — acceptance criteria derived from
adr-2026-07-04-kickback-event-emission-and-log-prominence (APPROVED) and the
architecture review conditions. Source: jstoup111/ai-conductor#240.

---

## Story: Kickback log line is prominent and structurally distinct

**Requirement:** ADR §Decision-1 (prominent line format)

As an operator scanning the daemon log, I want engine kickbacks rendered as a
high-contrast line so that backward pipeline motion is distinguishable at a glance
from forward step progression.

### Acceptance Criteria

#### Happy Path
- Given a `kickback` event `{from: 'prd_audit', to: 'build', evidence: 'FR-3 unmet', count: 1}`, when `renderDaemonEvent` renders it with color enabled, then the console line is `↩ KICKBACK: prd_audit re-opened build — FR-3 unmet (×1)` in bold yellow with **no** leading dim `·` chrome.
- Given the same event with `count: 2`, when rendered, then the line ends `(×2)` so repeat re-opens of the same gate are visible.
- Given any other inner-loop event (step_started, step_completed, step_retry, gate_verdict), when rendered, then its existing dim-`·` format is byte-for-byte unchanged.

#### Negative Paths
- Given NO_COLOR / non-TTY (chalk disabled), when the kickback event is rendered, then the plain-text line still reads `↩ KICKBACK: prd_audit re-opened build — FR-3 unmet (×1)` — the uppercase `KICKBACK` tag alone distinguishes it (prominence never depends on ANSI codes).
- Given a kickback event with `evidence: undefined`, when rendered, then the line renders without a dangling `— ` separator (no `— undefined`), and still carries the `KICKBACK` tag and `(×N)` count.

### Done When
- [ ] `renderDaemonEvent` kickback case emits the undimmed `↩ KICKBACK:` format; byte-exact assertions updated in `test/engine/daemon-render.test.ts` for color-on, color-off, and missing-evidence cases.
- [ ] All non-kickback render cases pass their existing byte-exact tests unmodified.

---

## Story: Durable daemon.log carries the KICKBACK anchor after ANSI stripping

**Requirement:** ADR §Decision-1 (structural prominence in the stripped file log)

As an operator reading `.daemon/daemon.log` (or `conduct daemon logs`) after the fact,
I want kickback lines to remain prominent and greppable in the ANSI-stripped file so
that backward motion is findable without a live color terminal.

### Acceptance Criteria

#### Happy Path
- Given a kickback event rendered while the daemon log sink is attached, when the line is written to `.daemon/daemon.log`, then the file line is timestamped, ANSI-free, and contains the literal substring `KICKBACK: prd_audit re-opened build`.
- Given a daemon run with one kickback among many step lines, when the operator greps the file for `KICKBACK`, then exactly the kickback line matches (no false positives from forward-progress lines).

#### Negative Paths
- Given color output enabled on the console, when the same line reaches the file sink, then no ANSI escape bytes appear in the file (stripAnsi parity holds for the new bold/yellow styling, including nested chalk styles).
- Given log rotation triggers (file exceeds the 1 MB cap) immediately after a kickback line, when the log rolls to `daemon.log.1`, then the kickback line is preserved intact in the rotated file, not truncated mid-line.

### Done When
- [ ] A test writes a kickback event through the real `log()` + `formatDaemonLogLine` path and asserts the file line is ANSI-free, timestamped, and contains `KICKBACK:`.
- [ ] Grep-anchor uniqueness asserted: no other render case output contains the substring `KICKBACK`.

---

## Story: Front-half amendment kickback emits one event at detection time

**Requirement:** ADR §Decision-2 (front-half emission; shared counting; cap enforcement; no happy-path routing change)

As an operator watching DECIDE, I want a conflict-check/stories amendment kickback to
produce a kickback log line the moment the offending step completes — and a HALT when a
gate oscillates past the cap — so that the pipeline going backwards is visible when it is
decided, and unbounded amendment spin stops for a human instead of looping silently.

### Acceptance Criteria

#### Happy Path
- Given `conflict_check` completes with a gate verdict `{satisfied: false, kickback: {from: 'conflict_check', evidence: 'incompatible ADR seam'}}` on `architecture_review`, when `advanceTail` runs for `conflict_check` (a front-half step), then a `kickback` event `{from: 'conflict_check', to: 'architecture_review', evidence: 'incompatible ADR seam', count: 1}` is emitted and the renderer produces the `↩ KICKBACK:` line.
- Given that emission with the count at or below `MAX_KICKBACKS_PER_GATE`, when `advanceTail` returns, then it still returns `null` — the linear front-half advance (`i++`) is unchanged, no `navigateBack` is invoked, and step statuses are untouched by the scan.
- Given a second amendment kickback re-opens the same gate later in the run, when the event is emitted, then `count` is 2 — the per-gate counter is shared with the tail scan's counter (one counter per gate, not two).

#### Negative Paths
- Given the front-half kickback count for a gate exceeds `MAX_KICKBACKS_PER_GATE`, when the front-half scan detects the excess re-open, then the run HALTs via the tail scan's exact sequence — `.pipeline/HALT` written with a ping-pong reason naming the gate and count, remediation PR surfaced, `loop_halt` emitted (✋ line) — after the kickback event itself is emitted with the truthful count.
- Given front-half re-opens and tail re-opens of the SAME gate in one run, when counts accumulate, then they share one per-gate counter — 1 front-half + `MAX_KICKBACKS_PER_GATE` tail re-opens of the same gate exceeds the cap (two independent counters would let 2×cap oscillations spin unchecked).
- Given a front-half step completes with an unsatisfied upstream verdict that has NO `kickback` provenance, when `advanceTail` runs, then no kickback event is emitted (plain unsatisfied ≠ kickback).
- Given a kickback verdict whose `kickback.from` is NOT the step that just completed, when that step's front-half scan runs, then no event is emitted for it (each verdict is attributed to its emitting step only).
- Given the pipeline later reaches `build` and the tail scan runs over the same still-unsatisfied front-half-origin verdict, when `advanceTail` executes for `build`, then no duplicate kickback event is emitted for that verdict — exactly one emission per kickback verdict across the whole run (review condition 1).

### Done When
- [ ] Gate-loop integration test extended with a front-half amendment scenario asserting: exactly one `kickback` event, emitted at the offending step's completion, with correct from/to/evidence/count.
- [ ] Same test asserts happy-path routing is unchanged: below the cap, the step sequence after the kickback verdict is identical to a run without this feature (linear until `build`, selector routes back afterward as today).
- [ ] Integration test covers cap-exceeded front-half HALT: `.pipeline/HALT` written, `loop_halt` emitted, run stops (daemon:true, isolated repo per rebase-test convention).
- [ ] Unit coverage for: no-provenance verdict → no event; mismatched `kickback.from` → no event; shared per-gate counter across front-half and tail scans.

---

## Story: Operator back-navigation renders as a distinct BACK line

**Requirement:** ADR §Decision-3 (navigation_back rendering); review condition 3

As an operator reviewing a daemon log, I want checkpoint "back" navigation visible as
its own operator-attributed line so that backward motion I caused is never silent and
never confusable with an engine-initiated kickback.

### Acceptance Criteria

#### Happy Path
- Given a `navigation_back` event `{from: 'manual_test', to: 'build'}`, when `renderDaemonEvent` renders it, then a line reading `↰ BACK: manual_test → build (operator)` (final glyph/wording fixed by the byte-exact test) is produced instead of falling through the silent default case.
- Given both a kickback and a navigation_back in one log, when the operator scans or greps, then the two are distinguishable: the engine line contains `KICKBACK`, the operator line contains `BACK` and the `(operator)` attribution, and neither tag is a substring of the other's grep anchor pattern (`grep -w KICKBACK` matches only engine kickbacks).

#### Negative Paths
- Given color disabled (NO_COLOR / non-TTY / ANSI-stripped file log), when the navigation_back line is rendered, then it remains structurally distinct from the KICKBACK line by tag text alone.
- Given any event type still not cased in `renderDaemonEvent` (e.g. internal bookkeeping events), when rendered, then it remains silent — adding the navigation_back case must not accidentally render previously-silent event types (default case behavior unchanged for all others).

### Done When
- [ ] `renderDaemonEvent` has a `navigation_back` case; byte-exact tests cover color-on and color-off output.
- [ ] A test asserts `KICKBACK` and `BACK` lines are mutually non-conflatable (distinct tags, distinct glyphs, operator attribution present).
- [ ] A test enumerates the render cases and asserts the set of rendered event types grew by exactly {navigation_back}.
