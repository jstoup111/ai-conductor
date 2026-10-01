**Status:** Accepted

# Stories: PRD-audit no-owner OVER_SCOPE findings

Technical track. Source: jstoup111/ai-conductor#1848. Existing grading and durable decision semantics apply to validated typed evidence.

## Story 1: Typed no-owner findings retain their distinct meaning

As the conductor, I want no-owner observations distinct from criterion judgments.

### Acceptance Criteria

#### Happy Path
- Given a supported typed result containing one no-owner OVER_SCOPE observation with outside-visible relation and evidence, when validated and rendered, then that finding appears alongside criterion findings with an engine-assigned NC.1 presentation ordinal.
- Given two valid no-owner observations, when rendered, then they receive distinct presentation ordinals without those ordinals becoming semantic decision identity.

#### Negative Paths
- Given a no-owner entry graded PASS or lacking a valid intent relation, when validated, then that entry is rejected with its index and field named while valid siblings remain available.
- Given a criterion entry naming an invented NC criterion, when validated, then it is rejected with the reference defect named.
- Given a supported result with no no-owner observations, when validated, then its criterion judgments retain their existing meanings.

### Done When
- [ ] Typed fixtures distinguish criterion judgments and no-owner OVER_SCOPE findings, with deterministic unique presentation ordinals.
- [ ] Invalid no-owner grade/relation and invented criterion fixtures retain valid siblings and named rejection diagnostics.

## Story 2: Duplicate normalized criterion references reject every carrier

### Acceptance Criteria

#### Happy Path
- Given unique normalized active criterion references, when validated, then no duplicate-reference diagnostic is produced.

#### Negative Paths
- Given two entries naming the same normalized criterion, when validated, then both are rejected with the criterion named and valid siblings retained.
- Given a reviewer-supplied no-owner presentation identity or decision claim, when validated, then that unsupported field produces a named diagnostic and grants no authority.

### Done When
- [ ] Duplicate S1.3 and S4.1 fixtures reject all four carriers and preserve unrelated findings.
- [ ] Engine-assigned NC ordinals are unique and unsupported reviewer authority fields cannot create identity or acceptance.

## Story 3: Independent entry defects remain visible and blocking

### Acceptance Criteria

#### Happy Path
- Given a supported readable envelope with 55 valid entries and two invented criterion references, when validated, then all 55 valid findings survive alongside diagnostics naming the two rejected references.

#### Negative Paths
- Given one or more rejected entries and otherwise PASS findings, when completion evaluates the typed result, then it remains incomplete and blocks naming each entry defect.
- Given missing, malformed or unsupported root output, when settlement runs, then there is no new usable judgment and neither Markdown nor chat is scraped to replace it.

### Done When
- [ ] Mixed-entry fixtures preserve valid findings and named diagnostics without permitting a gate pass or inferred acceptance.
- [ ] Missing/malformed/unsupported root fixtures produce no new usable judgment.

## Story 4: NC decisions retain authority across equivalent findings

As the operator, I want my explicit decision on a no-owner finding preserved and applied to the same behavior on later laps, so that wording and report-local keys cannot discard it or authorize a different behavior.

### Acceptance Criteria

#### Happy Path
- Given an accepted decision on an NC finding, when a later report repeats its source and current validated binding, then it remains accepted without another operator decision
- Given the same widening reworded or renumbered, when reconciliation validates its relationship to the original decided case, then the original accept or refuse remains authoritative
- Given a criterion-keyed decision for S4.1, when a later report changes its summary, then its criterion-based decision remains applicable
- Given a valid cleared decision about an original finding that no longer uses the same current-report key, when capture runs, then it preserves the original decision before reconciling the current report

#### Negative Paths
- Given a materially different widening sharing an NC ordinal or similar summary, when reconciliation runs, then it does not inherit the earlier approval
- Given uncertain equivalence or stale reconciliation evidence, when completion is checked, then no automatic acceptance occurs and the original decision remains preserved
- Given an altered immutable offer reference or missing rationale, when capture runs, then the entry produces a named defect and cannot grant authority
- Given an old cleared acceptance replayed after an explicit refusal, when capture runs again, then the replay does not override the later refusal

### Done When
- [ ] The persisted original decision and later current-source relationship remain separately attributable after restart
- [ ] Routing and artifact completion agree on accepted, refused, and unresolved current findings
- [ ] Capture and reconciliation expose distinct defect results, retaining valid historical authority when current matching fails

## Story 5: No-owner findings route uniformly and never become work

As the conductor, I want NC findings to flow through the same relation, classification,
decision-block, and recording machinery as criterion findings so that an outside-visible
unplanned change is decided by the operator and any other unplanned change is recorded
without blocking.

### Acceptance Criteria

#### Happy Path
- Given a validated NC.1 finding with intent relation outside-visible and no recorded decision, when the prd_audit gate evaluates the report, then the halt's over-scope-decisions block contains an entry for NC.1 with its summary and relation, pending decision
- Given a validated NC.1 finding with relation within or outside-harmless, when the prd_audit gate evaluates the report, then NC.1 is recorded and does not block

#### Negative Paths
- Given a refused decision for NC.1, when the next lap re-reports NC.1 with matching summary, then the halt names NC.1 as refused — rework required, and does not re-offer a pending entry for it
- Given a validated NC finding of any relation, when routing computes follow-up work, then no plan task is appended and no kickback names the NC finding as work — it routes only to the operator decision block

### Done When
- [ ] `overScopeRelations` and `classifyOverScopeCriterion` accept NC keys with unchanged semantics for criterion keys
- [ ] An end-to-end fixture drives typed result → validate → gate → halt block → cleared decision → recorded → next-lap non-blocking for an NC finding
- [ ] No code path appends plan tasks or emits kickback work for an NC finding

## Story 6: The engine contract and reviewer responsibilities agree

As a maintainer, I want machine-output shape owned by the engine while the skill supplies judgment guidance.

### Acceptance Criteria

#### Happy Path
- Given managed PRD audit, when its role is assembled, then the engine supplies the typed schema and the skill explains no-owner judgment without teaching a machine table grammar.
- Given standalone human review, when the skill presents its judgment, then human presentation remains available without creating managed gate authority.

#### Negative Paths
- Given machine-output table grammar or reviewer-owned NC identity reintroduced into the migrated skill contract, when the contract audit runs, then it rejects that conflict.

### Done When
- [ ] Managed-role fixtures show an engine-owned output schema and compatible no-owner judgment guidance.
- [ ] Contract-audit fixtures reject machine grammar while allowing standalone human presentation.
