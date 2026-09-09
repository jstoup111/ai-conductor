**Status:** Accepted

# Stories: Durable PRD widening decision reconciliation

Technical track; source #2429. Derived from approved adr-2026-09-07-durable-prd-widening-decision-reconciliation. Operator approved all eight stories in composer. #2383 remains the implementation prerequisite; #2440/#2060/#2441 own later slices.

## Story 1: Capture the decision the operator actually made

**Architecture basis:** D1, D3.

As the operator, I want an explicit widening decision saved against its original finding so later review prose cannot invalidate the capture.

### Acceptance Criteria

#### Happy Path
- Given an original over-scope offer and an explicit acceptance with rationale, when PRD review resumes, then the original evidence, operator attribution, and acceptance are durably available before the new reviewer runs
- Given several valid accept/refuse entries, when capture runs from either existing over-scope routing path, then each decision is retained once and can be read after restart

#### Negative Paths
- Given an untouched pending entry or a machine-cleared halt, when capture runs, then no operator decision is created
- Given a changed immutable offer reference, missing rationale, invalid decision word, or unresolved operator identity, when capture runs, then the affected entry produces a named defect and grants no authority
- Given one defective row and a valid sibling, when capture runs, then the valid decision survives and the defective row remains a visible blocker
- Given a lease timeout, write failure, or interruption between source and decision persistence, when capture stops and resumes, then no acceptance exists without a valid original source and no duplicate decision is created

### Done When
- [ ] Original evidence and attributable decision records can be inspected independently of the replacement report
- [ ] Both capture entry paths yield the same persisted decisions and named defects for the same clear

## Story 2: Keep refusals and explicit reversals authoritative

**Architecture basis:** D1, D3, D8.

As the operator, I want a refusal to persist until I explicitly revise it so retries cannot reverse my decision.

### Acceptance Criteria

#### Happy Path
- Given a refusal and a later equivalent current widening, when the gate evaluates it, then the halt identifies the existing refusal and offers an explicit revision tied to that decision
- Given an explicit acceptance superseding that refusal with a rationale, when the decision is recorded, then the new decision is effective and both decisions remain attributable

#### Negative Paths
- Given an old acceptance clear replayed after a newer refusal, when capture repeats, then the refusal remains effective
- Given a supersession referring to another case or conflicting decision revision, when submitted, then it is rejected without changing either case authority
- Given a refused finding absent on one lap and recurring later, when reconciled, then its historical refusal has not been erased
- Given a currently refused NC finding, when routing follows the refusal branch, then no plan task, BUILD work order, or deferral issue is created

### Done When
- [ ] Inspection shows the ordered supersession chain and one effective decision per decided identity
- [ ] Restart and replay leave the same effective decision and no NC repair effects

## Story 3: Recover existing decisions without silently losing evidence

**Architecture basis:** D2, D4.

As the operator, I want upgrade and restart to preserve valid older decisions and identify records needing recovery.

### Acceptance Criteria

#### Happy Path
- Given valid version-1 decision rows, when upgraded, then their original evidence, attribution, order, and decisions remain available in the new state
- Given a valid legacy fenced cleared decision and a differently worded current report, when imported, then the original decision is retained with legacy provenance before any current binding is decided

#### Negative Paths
- Given malformed decision storage or an unsupported retired format, when recovery reads it, then it names the format or corruption and leaves the original evidence intact
- Given a legacy decision with several plausible current matches, when reconciled, then the record survives but none of those findings inherits automatic approval
- Given a crash during migration or a repeated migration attempt, when resumed, then valid records are not duplicated or reordered and partial state cannot pass completion
- Given a store belonging to another feature or an unknown future version, when read, then it is rejected explicitly rather than converted to empty history

### Done When
- [ ] Before/after record inventories retain all supported original decisions and their relative authority
- [ ] Recovery results distinguish absent state, unsupported state, corrupt state, and unresolved legacy binding

## Story 4: Share history storage without mixing gate authority

**Architecture basis:** D1, D2.

As the operator, I want PRD widening history and build-review history to coexist without either writer losing the other gate’s records.

### Acceptance Criteria

#### Happy Path
- Given #2383 build-review cases, effects, and suppression history, when PRD history is added or migrated, then all existing build-review evidence and effective outcomes are preserved
- Given PRD widening history, when build-review suppression or case state changes, then the PRD history remains available unchanged

#### Negative Paths
- Given a PRD case presented for a build-review act/defer effect, when evaluated, then the foreign-domain route is rejected and no effect occurs
- Given a malformed domain record, conflicting source ownership within a domain, or an older incompatible writer, when storage is accessed, then it refuses explicitly without overwriting newer state
- Given overlapping PRD and build-review updates or a failed atomic replacement, when retried, then the successful state includes both domains without lost records
- Given the same lap-local ordinal in unrelated domains, when histories are stored, then it does not make those findings equivalent or transfer operator authority

### Done When
- [ ] The mixed-domain store retains the original build-review suppression, source, and effect inventories across each writer
- [ ] Observed build-review pass/fail, recurrence, and effects match the predecessor’s behavior when no PRD work is present

## Story 5: Reconcile drift against complete prior decision history

**Architecture basis:** D5, D7.

As the operator, I want later findings compared by substance so wording changes do not erase decisions or create accidental approvals.

### Acceptance Criteria

#### Happy Path
- Given the original lease-wait widening from 1000ms to 5000ms and the observed expanded reviewer summary, when reconciliation identifies the same behavior, then the current finding inherits the original decision even with shifted lines or NC ordinal
- Given relevant accepted, refused, superseded, absent, and unresolved PRD cases, when unmatched current findings are reconciled, then the judgment has every current source and the complete retained PRD history
- Given an identical validated source/code/decision/contract snapshot, when repeated after restart, then its completed reconciliation is reused without another successful judgment

#### Negative Paths
- Given a different behavior sharing the same commit, path, ordinal, or similar prose, when reconciled as different, then it requires its own decision and cannot inherit acceptance
- Given missing evidence or ambiguous equivalence, when the result is uncertain, then the original decisions remain durable and the current finding stays unresolved without retries seeking a different answer
- Given any approved count, field, or total-input limit is exceeded, when context is assembled, then the named dimension and actual/allowed size are reported without silent truncation or pruning
- Given a changed source, code snapshot, decision revision, or contract version, when prior evidence is considered for reuse, then it is not reused as current authority

### Done When
- [ ] Every supplied current source has exactly one inspectable same, different, or uncertain result
- [ ] The exact observed two-summary case and a similar-looking different behavior yield distinct effective classifications
- [ ] Reuse and overflow are observable outcomes rather than missing judge activity or missing records

## Story 6: Constrain and validate reconciliation on both providers

**Architecture basis:** D5, D6, D7.

As the operator, I want the same closed reconciliation contract on both supported providers so output formatting cannot silently change authority.

### Acceptance Criteria

#### Happy Path
- Given either Claude or Codex selected for reconciliation, when dispatched, then the provider receives the engine-owned input and native output constraint and the engine consumes the validated final structured result
- Given an invocation that requests no schema, when dispatched, then its existing behavior is unchanged

#### Negative Paths
- Given unsupported schema capability, absent terminal output, malformed JSON, an unknown field, or an invalid field value, when the result is processed, then a named mechanical error prevents acceptance
- Given an unknown case reference, missing/duplicate source result, or contradictory binding, when validated, then no partial relation set becomes authoritative
- Given provider timeout or unavailability, when attempts are exhausted, then a named halt preserves decisions and consumes no BUILD or plan-growth allowance
- Given a contained self-host invocation, when the schema is materialized and the invocation ends or fails, then its scratch-file lifecycle stays within the feature’s authorized writable boundary

### Done When
- [ ] Provider-boundary fixtures prove native constraint arguments and correct final-result extraction for both hosts
- [ ] Invalid outputs produce field/reference-specific diagnostics and no accepted relation snapshot

## Story 7: Reject stale judgment and make every completion reader agree

**Architecture basis:** D8, D9.

As the operator, I want routing and completion to use the same current decision evidence so one reader cannot accidentally accept a stale widening.

### Acceptance Criteria

#### Happy Path
- Given a complete current relationship and an authoritative acceptance, when routing, report projection, artifact completion, and ship rendering evaluate it, then they agree the widening is accepted
- Given an ordinary story-criterion decision and a reworded report, when evaluated, then criterion-based authority is unchanged without NC semantic rematching

#### Negative Paths
- Given an operator reversal, changed report/source set, or changed code during judgment, when the result returns, then it is rejected as stale and the newer authority remains intact
- Given a reviewer assertion of approval without valid decision/binding evidence, when completion runs, then the assertion cannot make the gate pass
- Given malformed current report rows, corrupt relation evidence, or failure to render an otherwise recorded decision, when completion is checked, then the named defect remains blocking
- Given interruption after decisions persist but before relations publish, when restarted, then decisions survive and incomplete relationships cannot satisfy completion

### Done When
- [ ] The effective classification and freshness evidence observed at all four readers agree for accepted, refused, unresolved, and invalid cases
- [ ] Completion readers make no independent semantic identity judgment or provider call

## Story 8: Explain every decision and recovery outcome through existing events

**Architecture basis:** D9.

As the operator, I want the event trail and halt to explain what happened without inspecting unrelated logs.

### Acceptance Criteria

#### Happy Path
- Given a recorded offer, import, binding, rejection, or exact-result reuse, when it occurs, then the existing event trail names the relevant source/case/decision and bounded reason
- Given a recovery condition, when the engine halts, then the halt identifies the affected evidence and a concrete operator recovery action

#### Negative Paths
- Given an early return for malformed input, missing attribution, failed persistence, stale judgment, or overflow, when it occurs, then the reason remains visible instead of appearing as a generic unresolved verdict
- Given a valid sibling decision or retained refusal during another finding’s failure, when events and reports are rendered, then neither the valid authority nor the remaining defect is hidden

### Done When
- [ ] Persisted events and halt text identify the same affected records and reason on happy and failure branches
- [ ] The original rationale remains attributable in durable state and reports while event payloads remain bounded

## Negative-path category review

Invalid input and authority: Stories 1, 2, 3, 4, 6, 7. Timeouts/dependency availability: Stories 1 and 6. Concurrent access: Stories 2, 4, 7. Resource exhaustion: Stories 1 and 5. Partial failure/restart: Stories 1, 3, 4, 7. Data integrity/immutability: Stories 1-4. Dedup and identity: Stories 1-5. Alternate-branch visibility: Story 8. No deletion is introduced, so cascade deletion is inapplicable. No exception-class hierarchy behavior is required; failure outcomes are typed at the injected boundary.

## Verify-Claims Ledger

All behavioral expectations derive from operator-approved D1-D10; no new scope or unconfirmed product assumption is introduced. Third-party boundary validation uses faithful fakes; native schema help is evidence of the available flag, not proof of the new production integration. Verdict: CLEAR for story authoring; operator acceptance recorded in composer.
