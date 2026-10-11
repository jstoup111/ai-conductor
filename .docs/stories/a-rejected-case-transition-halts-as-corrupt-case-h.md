**Status:** Accepted

# Stories: A rejected case transition halts as corrupt case history

Technical track, intake jstoup111/ai-conductor#3123. Fixture shorthand used below: a valid persisted
case store holding resolved case R that links source S, and a proposed next state that adds new
case N also linking S (the shape replayed from PR #2423, head `b680acd52`).

## Story 1: The case store classifies a refused next state as a rejected transition

**Requirement:** intake outcomes 1 and 5

As the adjudication engine, I want the case store to tell a refused proposed change apart from
unreadable or corrupt saved history, so that callers never report valid history as malformed.

### Acceptance Criteria

#### Happy Path
- Given the fixture, when the store applies the mutation proposing N, then it returns a rejected-transition failure distinct from every persisted-history failure and writes nothing.
- Given the fixture, when the store returns that rejected-transition failure, then the failure names the violated invariant as a source linked from more than one case, names the case ids R and N, and names the source id S.
- Given a valid persisted store and a proposed next state that repeats a case id, when the store applies the mutation, then it returns a rejected-transition failure naming that invariant and the repeated case id.

#### Negative Paths
- Given a persisted store file that itself links S from two cases, when it is read or mutated, then the store still fails with the existing malformed-state reason and never with a rejected transition.
- Given a persisted store file that is not valid JSON, when it is read or mutated, then the store still fails with the existing malformed-json reason.
- Given the fixture, when the mutation is rejected, then the store file is byte-identical to its content before the mutation and no temporary file remains.

### Done When
- [ ] Store tests assert the rejected-transition reason, its invariant, its case ids, and its source ids for the duplicate-source and duplicate-case-id next states.
- [ ] Store tests assert the same duplicate-source shape persisted on disk still fails as malformed-state through both read and mutate.
- [ ] A store test asserts the file bytes are unchanged after a rejected transition.

## Story 2: A build-review halt names the rejected transition and keeps history trusted

**Requirement:** intake outcomes 1, 2 and 3

As the operator, I want a build-review halt caused by a rejected transition to say so and name what
was rejected, so that I do not investigate corruption that does not exist.

### Acceptance Criteria

#### Happy Path
- Given the fixture and a judgement proposing N, when build-review adjudication runs, then it emits `remediation_adjudication_failed` whose reason identifies a rejected case transition and whose structured fields carry the invariant, the case ids R and N, and the source id S.
- Given that failed adjudication, when the conductor halts the feature, then the needs-human HALT reason names the rejected transition, the invariant, R, N and S, and states that persisted case history is valid and unchanged.
- Given that HALT reason, when the operator reads it, then it names the recovery path and contains no instruction to delete case history or accept a finding.

#### Negative Paths
- Given a persisted store that is itself corrupt, when build-review adjudication runs, then the event and HALT still report a malformed case store, carry no rejected-transition fields, and never state that history is valid.
- Given a rejected transition, when the feature halts, then the halt class is needs-human and the case store bytes are unchanged.

### Done When
- [ ] A coordinator test asserts the event's reason and structured invariant, case-id and source-id values for the fixture lap.
- [ ] A conductor-level test asserts the HALT reason text for the fixture lap and for a corrupt persisted store.
- [ ] The `remediation_adjudication_failed` union member declares the new structured fields as optional.

## Story 3: A feature halted by a rejected transition recovers without editing history

**Requirement:** intake outcome 4

As the operator, I want to resume a feature halted by a rejected transition once the proposed change
becomes admissible, so that I never delete case history or accept unresolved findings to proceed.

### Acceptance Criteria

#### Happy Path
- Given a feature halted by the fixture's rejected transition, when the HALT is cleared and the next lap's judgement proposes an admissible transition, then the lap reconciles against the same store file and R keeps its resolution, applied effect and source link byte for byte.

#### Negative Paths
- Given a feature halted by the fixture's rejected transition, when the HALT is cleared and the next lap proposes the same rejected transition, then adjudication fails closed again with the same rejected-transition diagnostic and the store file stays byte-identical.

### Done When
- [ ] A recovery integration test replays the fixture, clears the HALT, and proves both the admissible re-run and the repeated rejection against one unedited store file.
