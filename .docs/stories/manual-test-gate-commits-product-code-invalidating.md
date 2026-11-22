# SHIP validator protection and recovery

## Story 1: Keep validation running across hosts

As an operator, I want validators to use available write protection and tell me when it is unavailable so that work keeps moving.

#### Happy Path
- Given a host with verified protection, when any of the three SHIP validators runs alone or in a group, then it can inspect product code, exercise its required tools and write its own evidence under .pipeline/.
- Given a protected validator or its child attempts a product edit or Git mutation, when that operation is attempted, then it is refused before a sibling can see a change.

#### Negative Paths
- Given missing protection or an inconclusive protection check, when the engine dispatches the validator, then the operator sees a prominent warning naming the validator and reason before execution, and execution continues without acknowledgment.

### Done When
- [ ] A protected-run fixture retains its original product bytes and Git revision while producing validator evidence.
- [ ] A fallback-run trace shows the warning followed by validator execution and its evidence in the same attempt.

## Story 2: Repair defects through BUILD

As an operator, I want every product fix to pass the normal build and review gates.

#### Happy Path
- Given a validator reports a current product defect, when the engine routes the finding, then the normal repair path takes the fix through BUILD, test_suite and build_review before shipping.

#### Negative Paths
- Given unprotected validation runs after the last build review, when a product edit remains uncommitted or a product change has been committed, then the engine preserves the change and routes unverified code through those gates automatically.
- Given the repair belongs to another BUILD worktree, when the engine hands over fallback edits, then it verifies a recoverable copy before cleanup, keeps pre-existing operator edits separate, and resumes an interrupted delivery without applying it twice.
- Given only harness-owned evidence changed, when validation finishes, then evidence writes alone do not trigger a product rebuild.

### Done When
- [ ] Run history for an unreviewed change shows completed build verification and review of the changed code before SHIP can finish.
- [ ] An evidence-only run can finish with its prior build proof.

## Story 3: Recover from stale verdicts

As an operator, I want validation to repeat only the work invalidated by a code change.

#### Happy Path
- Given sibling verdicts in a parallel round, when code changes invalidate only some verdicts, then the engine automatically reruns affected validators against current code after any required build verification and preserves valid sibling evidence.

#### Negative Paths
- Given an obsolete passing verdict or defect finding, when the join evaluates it, then it cannot advance SHIP or route a repair based on that obsolete result.
- Given malformed evidence or evidence from the wrong run without established code drift, when the join checks it, then the existing evidence failure handling applies.

### Done When
- [ ] A run with one stale audit and one valid sibling dispatches the stale audit again and reaches a verdict without operator intervention for staleness.
- [ ] A stale FAIL row cannot start a repair on the new revision.

**Status:** Accepted
