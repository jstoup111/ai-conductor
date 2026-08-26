**Status:** Accepted

# Stories: as-built invalid-verdict halt diagnostics (#1911)

Technical track. Intent: `classifyAsBuiltReviewOutcome`'s `invalid` arm carries a typed
`cause`, and the `checkStepCompletion` halt reason for `architecture_review_as_built`
renders a distinct, self-explanatory message per cause, so an operator reading only the
halt marker can tell which defect occurred.

## Story 1: Missing verdict line is named as such

As an operator, I want a halt caused by an absent/unparseable `Verdict:` line to say so
and show what was found, so that I fix the report shape instead of chasing PLAN_GAP.

### Acceptance Criteria

#### Happy Path
- Given an as-built report whose verdict is written as a `## Verdict` heading with `**BLOCKED**` on the next line (no `Verdict:` colon line), when `classifyAsBuiltReviewOutcome` runs, then it returns `{ kind: 'invalid', cause: 'no-verdict-line' }` and the halt reason states no parseable `Verdict:` line was found and names the expected form (`Verdict: <value>` on one line)
- Given that same report, when `checkStepCompletion` builds the halt reason, then the reason does not mention PLAN_GAP or `Outcome delivered`

#### Negative Paths
- Given a report with no verdict content at all (empty file), when classified, then the cause is `no-verdict-line` and the halt reason still renders without throwing and names the expected form

### Done When
- [ ] Unit test: heading-style `## Verdict` + `**BLOCKED**` report classifies as `{ kind: 'invalid', cause: 'no-verdict-line' }`
- [ ] Unit test: the rendered halt reason for `no-verdict-line` contains the expected-form text and contains neither `PLAN_GAP` nor `Outcome delivered`

## Story 2: Unrecognized verdict value names the value and the accepted set

As an operator, I want a halt caused by an unrecognized verdict value to quote the value
it read and list the accepted values, so that I correct the value without reading engine
source.

### Acceptance Criteria

#### Happy Path
- Given a report with `Verdict: REJECTED`, when `classifyAsBuiltReviewOutcome` runs, then it returns `{ kind: 'invalid', cause: 'unrecognized-verdict', value: 'REJECTED' }` and the halt reason quotes `REJECTED` and lists `APPROVED`, `APPROVED WITH DRIFT NOTES`, `PLAN_GAP`, `BLOCKED`
- Given a report with `Verdict: approved with drift notes` (any case, optional bold markers), when classified, then it still parses as a recognized verdict and is not treated as unrecognized

#### Negative Paths
- Given a report with `Verdict:` followed by only whitespace or stray `**` markers, when classified, then the outcome is invalid with a cause distinguishable from a recognized-verdict path and the halt reason does not claim a PLAN_GAP defect

### Done When
- [ ] Unit test: `Verdict: REJECTED` classifies with cause `unrecognized-verdict` carrying the read value
- [ ] Unit test: the rendered halt reason for `unrecognized-verdict` contains the read value and all four accepted values
- [ ] Unit test: existing recognized-verdict classifications (`approved`, `plan-gap-delivered`, `plan-gap-undelivered`, `blocked-remediable`, `blocked-design`) are unchanged

## Story 3: Genuine PLAN_GAP missing `Outcome delivered` keeps its exact wording

As an operator, I want the real PLAN_GAP-missing-`Outcome delivered` defect to keep its
current, accurate message, so that the fix does not regress the one case the old string
described correctly.

### Acceptance Criteria

#### Happy Path
- Given a report with `Verdict: PLAN_GAP` and no `Outcome delivered:` line, when classified, then the outcome is `{ kind: 'invalid', cause: 'plan-gap-missing-outcome' }` and the halt reason states a PLAN_GAP report must record `Outcome delivered: yes|no` and says to re-run the as-built review

#### Negative Paths
- Given a report with `Verdict: PLAN_GAP` and `Outcome delivered: maybe`, when classified, then the cause is `plan-gap-missing-outcome` (malformed stays fail-closed) and the halt reason names the accepted `yes|no` forms
- Given a report with `Verdict: PLAN_GAP` and `Outcome delivered: yes`, when classified, then the outcome remains `{ kind: 'plan-gap-delivered' }` — not invalid

### Done When
- [ ] Unit test: PLAN_GAP without `Outcome delivered` classifies with cause `plan-gap-missing-outcome` and its rendered reason mentions PLAN_GAP and `Outcome delivered: yes|no`
- [ ] Unit test: PLAN_GAP with `Outcome delivered: yes`/`no` still classify as `plan-gap-delivered`/`plan-gap-undelivered`

## Story 4: BLOCKED with unparseable findings block is named as such

As an operator, I want a halt caused by a BLOCKED verdict whose findings block cannot be
parsed to say the findings block is the defect, so that I fix the findings table instead
of the verdict line.

### Acceptance Criteria

#### Happy Path
- Given a report with `Verdict: BLOCKED` whose findings block fails `parseAsBuiltBlockedFindings`, when classified, then the outcome is `{ kind: 'invalid', cause: 'unparseable-blocked-findings' }` with the parse error detail carried on the arm, and the halt reason says the BLOCKED findings block could not be parsed and includes that detail

#### Negative Paths
- Given a report with `Verdict: BLOCKED` and a well-formed findings block, when classified, then the outcome remains `blocked-remediable` or `blocked-design` — not invalid — and the conductor consumers at their `classifyAsBuiltReviewOutcome` call sites branch on `kind` exactly as before

### Done When
- [ ] Unit test: BLOCKED with a malformed findings block classifies with cause `unparseable-blocked-findings` and its rendered reason names the findings block and carries the parser's error detail
- [ ] Unit test: BLOCKED with a valid findings block still classifies `blocked-remediable`/`blocked-design`
- [ ] Type check passes with the widened `AsBuiltReviewOutcome` union across all consumers with no behavior change outside the invalid arm
