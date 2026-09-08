**Status:** Accepted

# Stories: OVER_SCOPE multi-finding decision block (#1846)

Technical track. Design authority: adr-2026-08-24-over-scope-decision-block-and-durable-refusals
(APPROVED). Requirement tags cite that ADR's decision numbers (D1–D8).

## Story 1: Halt presents every blocking finding in one decision block

**Requirement:** D1, D2

As an operator, I want an OVER_SCOPE halt to present all currently blocking findings at once so
that I can make the whole scope decision in one pass.

### Acceptance Criteria

#### Happy Path
- Given a prd-audit verdict with three OVER_SCOPE findings whose intent relation is outside-visible and no prior decisions, when the conductor halts, then the halt body contains one fenced `over-scope-decisions` JSON array with exactly three entries, each carrying criterion, original summary, relation, pending decision, and an engine-stamped original-offer reference
- Given the same verdict, when the halt body is rendered, then it also contains human prose naming the blocking criteria and the operator lever (edit each `decision` to `accept` or `refuse` with a `rationale`, then clear)
- Given the halt fires on the concurrent SHIP-join path instead of the serial tail, when the halt body is rendered, then it is byte-identical in structure to the serial-tail rendering (both sites call the shared helper)

#### Negative Paths
- Given a verdict with one outside-visible finding and one unaccepted outside-harmless finding, when the halt renders, then the decision block contains only the outside-visible criterion and the outside-harmless finding is never offered
- Given a verdict where every OVER_SCOPE finding is within intent or currently accepted and no defect remains, when routing runs, then no over-scope halt is written
- Given a verdict with an outside-visible finding that already has a recorded accept decision, when the halt set is computed, then that criterion is excluded and, if nothing else blocks, no halt occurs

### Done When
- [ ] One exported selection/render helper computes the blocking set (grade OVER_SCOPE ∧ relation outside-visible ∧ no durable decision) and renders the fenced block; both conductor emission sites call it (no duplicated selection logic)
- [ ] Halt body reaches disk only via `writeHaltMarker` with the over-scope halt class
- [ ] Unit tests cover 3-finding rendering, mixed-relation exclusion, and already-decided exclusion

## Story 2: One decided clear records every operator decision

**Requirement:** D3, D4

As an operator, I want a single halt clear to record all my per-finding decisions so that a
multi-finding audit costs one round trip instead of N.

### Acceptance Criteria

#### Happy Path
- Given a cleared halt body whose decision block has two entries edited to `decision: "accept"` and one to `decision: "refuse"`, each with a non-empty rationale, when the conductor's next prd_audit lap harvests `HALT.cleared`, then two accept decisions and one refuse decision are recorded in `.pipeline/accepted-widenings.json`, each with criterion, summary, decision, rationale, machine-resolved operator identity, and timestamp
- Given both accepted criteria and no other blocking findings, when routing re-runs after the harvest, then the gate does not re-halt on either accepted criterion
- Given a criterion with a recorded refuse decision, when a later cleared body carries `decision: "accept"` for it with a rationale, then the accept is recorded and the criterion no longer blocks

#### Negative Paths
- Given a cleared body whose entries are all still `decision: "pending"`, when the harvest runs, then nothing is recorded and the halt re-fires with the same blocking set
- Given a recording write that fails (e.g. unwritable `.pipeline/`), when the harvest runs, then the failure never throws into the conductor's halt/clear seam and the defect is surfaced via a spine event
- Given the same cleared body harvested twice (duplicate wake), when the second harvest runs, then no duplicate decision entries are created (idempotent by original offer/entry identity; replay never overrides a later explicit decision)

### Done When
- [ ] Wholesale parser reads the full fenced array from `HALT.cleared`; only explicit accept/refuse entries with non-empty rationale are recorded
- [ ] Record entries carry `{criterion, summary, decision, rationale, operator, decidedAt}`; operator identity resolves via the machine-scoped chain
- [ ] Harvest is idempotent and its write is best-effort (never throws); round-trip test proves 2-accept+1-refuse in one clear

## Story 3: Machine clears never mint decisions

**Requirement:** D3

As a harness owner, I want daemon rekicks, rewinds, and reseal clears to be inert with respect to
scope decisions so that only an operator's explicit edits confer acceptance or refusal.

### Acceptance Criteria

#### Happy Path
- Given an over-scope halt whose decision block is untouched (all `pending`), when the daemon rekick path renames `HALT` to `HALT.cleared`, then the subsequent harvest records zero decisions and the halt re-fires with the same blocking set

#### Negative Paths
- Given an over-scope halt, when `conduct-ts rewind` clears the halt, then no accept or refuse decision is recorded for any criterion
- Given an over-scope halt, when reseal `--clear-halt` runs, then no decision is recorded and the next prd_audit lap re-halts on the still-blocking findings

### Done When
- [ ] Tests simulate rekick-, rewind-, and reseal-produced `HALT.cleared` (or halt removal) and assert the decisions file is unchanged
- [ ] `pending` (and absent `decision`) is proven inert in the parser's unit tests

## Story 4: A refusal durably blocks with a changed halt

**Requirement:** D6

As an operator, I want a refused finding to keep blocking with a halt that says so, so that the
same halt never reappears unchanged and refusal is not re-litigated every lap.

### Acceptance Criteria

#### Happy Path
- Given a recorded refuse decision for criterion S5.2 and no other blocking findings, when the conductor re-halts, then the halt body names S5.2 as refused — rework required — and offers an explicit revise-decision entry tied to the existing refusal with no default acceptance
- Given one refused criterion and one new undecided outside-visible finding, when the halt renders, then the refused criterion appears in the refused prose and the new finding has a pending entry while any explicit revision entry for the refusal names the prior decision
- Given a refused criterion that the next prd-audit report no longer flags OVER_SCOPE, when routing runs, then the stale refusal has no effect and does not block

#### Negative Paths
- Given a recorded refusal, when any routing or completion path runs, then no plan task is appended and no route to DECIDE is produced on account of the refusal
- Given a refused criterion, when the identical report and refusal recur across laps over an unchanged tree, then the existing convergence bound still terminates the run rather than looping unboundedly

### Done When
- [ ] The shared blocking predicate treats refused criteria as blocking-but-already-decided: they block the gate, are named in the refused prose, and may have an explicit revision entry tied to the prior decision rather than a fresh pending acceptance
- [ ] prd_audit completion predicate in `artifacts.ts` and `routePrdAuditOverScope` consume the same single predicate
- [ ] Tests cover refused-only halt text, mixed refused+new halt, and stale-refusal mootness

## Story 5: Malformed operator edits fail closed and are named

**Requirement:** D7

As a harness owner, I want a defective decision block to be refused loudly so that an operator's
intent is never silently discarded and acceptance is never fabricated.

### Acceptance Criteria

#### Negative Paths
- Given a cleared body whose fenced block is not parseable JSON, when the harvest runs, then zero decisions are recorded, a spine event names the parse defect, and the re-halt body states the block was unreadable
- Given a cleared body containing an entry for a criterion the halted blocking set did not contain, when the harvest runs, then that entry is refused, nothing is recorded for it, and the defect event names the unknown criterion
- Given an entry edited to `decision: "accept"` with an empty or missing rationale, when the harvest runs, then that entry is refused with a named defect while other valid entries in the same block are still recorded
- Given a cleared body with no fenced decision block at all (an unrelated halt), when the harvest runs, then it is a no-op with no defect event

#### Happy Path
- Given a block with one valid accept entry and one defective entry, when the harvest runs, then the valid decision is recorded, the defective one is refused by name, and the re-halt lists only the still-undecided/defective criteria

### Done When
- [ ] Parse-don't-validate: unknown criterion, bad decision value, missing rationale, and malformed JSON each produce a distinct named defect (event payload), never a silent null
- [ ] Partial validity is per-entry: valid entries record, defective entries refuse
- [ ] Tests cover all four defect classes plus the unrelated-halt no-op

## Story 6: Existing decisions survive upgrade and invalid history is explicit

**Requirement:** D5 as amended by #2429

As an operator, I want supported existing decisions retained and unsupported or corrupt records identified so upgrade cannot silently erase my authority.

### Acceptance Criteria

#### Happy Path
- Given valid version-1 decisions and fenced legacy cleared entries, when migration runs, then the original evidence and decisions are retained with their attribution and ordering
- Given a legacy decision whose current finding is reworded, when captured, then the original decision persists before its current binding is judged

#### Negative Paths
- Given an old entries-shaped store or retired single-line marker, when recovery reads it, then it names the unsupported format and preserves the source instead of silently treating it as absent
- Given unparseable decision JSON, when read, then the corruption is named, the source is preserved, and completion is blocked rather than treating history as empty
- Given ambiguous legacy equivalence or interrupted migration, when recovery resumes, then no invented binding or duplicate decision grants approval

### Done When
- [ ] Supported record inventories retain original evidence, attribution, ordering, and decisions after migration
- [ ] Recovery distinguishes absent, unsupported, corrupt, and ambiguous legacy state without overwriting source evidence
- [ ] Restart can complete an interrupted supported migration without duplicating authority

## Story 7: Decisions ride the event spine and project into the record

**Requirement:** D8

As an operator, I want recorded decisions visible in the events log and the shipped record so
that scope decisions are auditable without spelunking `.pipeline/` state.

### Acceptance Criteria

#### Happy Path
- Given a harvest that records two accepts and one refusal, when it completes, then a decision-recorded event per decision (or one event carrying all three) is emitted through `ConductorEventEmitter` and persisted to `.pipeline/events.jsonl`
- Given recorded decisions, when the prd_audit verdict artifact is next written, then the decisions (criterion, decision, rationale) are projected into it in the recorded-findings shape
- Given an accepted widening, when `classifyPrdAuditGaps` computes cleanliness on the next lap, then the accepted criterion no longer counts as a fresh blocking finding

#### Negative Paths
- Given the event sink registry, when the new event type is added without a sink declaration, then compilation fails (total `EVENT_SINKS` record)
- Given a recorded decision that cannot be rendered into the verdict artifact, when projection runs, then completion blocks with a named reason rather than the decision silently disappearing

### Done When
- [ ] New `ConductorEvent` variant declared in the union and `EVENT_SINKS` with render/persist/audit declarations
- [ ] Verdict-artifact projection test proves decisions appear in the recorded shape
- [ ] Routing test proves an accepted criterion flips `classifyPrdAuditGaps` cleanliness on the next lap
