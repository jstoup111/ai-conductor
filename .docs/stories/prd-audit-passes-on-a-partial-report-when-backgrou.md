**Status:** Accepted

# Stories: PRD-audit coverage completeness

Track: technical. Source: jstoup111/ai-conductor#1398.

## Story 1: Every authoritative criterion must carry a validated judgment

As the SHIP gate, I want omitted evidence to block rather than appear clean.

### Acceptance Criteria

#### Happy Path
- Given all active sealed story criteria have validated PASS judgments and applicable PRD traceability is complete, when completion evaluates the typed result, then the gate passes without another reviewer invocation.
- Given complete criterion evidence with a recorded widening acceptance valid under current decision authority and no other blockers, when completion evaluates it, then acceptance remains effective.

#### Negative Paths
- Given complete-looking PASS findings that omit two active criteria, when completion evaluates them, then it blocks naming both missing criteria and does not persist a passing code-validity result.
- Given no criterion judgments for a feature with required criteria, when completion evaluates the result, then it blocks naming the omitted criteria.
- Given both an omitted criterion and a valid blocking finding, when completion evaluates them, then neither defect hides the other.
- Given a resolved PRD requirement without story coverage, when traceability is evaluated, then the gap blocks unless valid existing criterion PLAN_GAP evidence accounts for it under the current policy; no fabricated criterion or new repair authority is created.

### Done When
- [ ] Typed coverage validation names missing criteria and applicable requirement traceability gaps; complete clean evidence passes.
- [ ] Incomplete evidence cannot write a passing gate stamp, even alongside accepted or otherwise recordable findings.

## Story 2: A pass from an incomplete run is never preserved or reused

As an operator, I want completion, preservation and sweep to agree about coverage.

### Acceptance Criteria

#### Happy Path
- Given complete typed evidence with no current blocker and valid code-stamp preservation, when completion or sweep evaluates it before a new dispatch, then the verdict is preserved.

#### Negative Paths
- Given an otherwise preserving code stamp but an omitted criterion, when completion, preservation or sweep evaluates it, then none yields a reusable pass and the missing criterion is named.
- Given only a legacy Markdown audit report, when completion considers reuse, then it requires a new audit without deleting original widening-decision or legacy-clear import data.

### Done When
- [ ] The same incomplete typed fixture is rejected at completion, preservation and sweep through the shared validation reader.
- [ ] A complete code-valid fixture is preserved; a legacy report alone cannot satisfy the gate.

## Story 3: Coverage inputs are feature-scoped and required sources cannot disappear

As the gate, I want this feature's own stories and applicable PRD intent to supply its obligations.

### Acceptance Criteria

#### Happy Path
- Given many unrelated specs and stories, when the active feature is resolved, then only its active plan-linked sealed stories and applicable requirements contribute obligations.
- Given technical work with no applicable PRD, when preparation runs, then no-PRD is explicit and the full story-criterion denominator remains required.
- Given multiple applicable approved PRDs, when requirements are resolved, then their path-qualified requirement sets are all checked for traceability.
- Given a superseded PRD excluded by existing feature resolution, when inputs are prepared, then it does not contribute current obligations.

#### Negative Paths
- Given unreadable or unresolved required stories, plan or applicable PRD, when preparation runs, then the named source blocks invocation; another feature's input cannot substitute for it.
- Given a present required input that cannot be parsed, when obligations are extracted, then it cannot silently become an empty denominator.

### Done When
- [ ] Existing feature-resolution and shared requirement parsing supply the active input set; unrelated feature fixtures contribute no obligations.
- [ ] No-PRD technical fixtures retain every criterion; unreadable, unresolved and unparseable required-source fixtures name the source and record zero reviewer invocations.
