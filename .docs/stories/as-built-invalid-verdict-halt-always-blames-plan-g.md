**Status:** Accepted

# Stories: as-built invalid-verdict halt diagnostics (#1911)

Technical track. Intent: a rejected as-built structured result carries a diagnostic naming the
defective field, and the needs-human halt reason written when the step's retry budget is exhausted
names the as-built step and that field, so an operator reading only the halt marker can tell which
defect occurred and is never told the defect is a PLAN_GAP one when it is not.

## Story 1: Missing verdict line is named as such

As an operator, I want a halt caused by a missing verdict in the as-built structured result to say
so and name the field, so that I fix the actual defect instead of chasing PLAN_GAP.

### Acceptance Criteria

#### Happy Path
- Given an as-built structured result that carries no `verdict` field, when the engine validates it, then it is rejected with a diagnostic naming `verdict` and its admitted values, the attempt is scored `absent`, and the step reruns in a fresh session within its existing retry budget
- Given every retry in the budget ends in that rejection, when the needs-human halt reason is built, then the reason names the as-built step and the `verdict` field and does not mention PLAN_GAP or `outcomeDelivered`

#### Negative Paths
- Given a provider result that carries no structured result at all, when the step settles, then the attempt is scored `absent` with the missing-structured-result reason, and the exhaustion halt reason renders without throwing and names the missing structured result rather than a PLAN_GAP defect

### Done When
- [ ] Unit test: a structured result without `verdict` is rejected with a diagnostic naming `verdict`
- [ ] Unit test: the exhaustion halt reason for a missing verdict names the as-built step and the field and contains neither `PLAN_GAP` nor `outcomeDelivered`

## Story 2: Unrecognized verdict value names the value and the accepted set

As an operator, I want a halt caused by an unrecognized verdict value to quote the value
it read and list the accepted values, so that I correct the value without reading engine
source.

### Acceptance Criteria

#### Happy Path
- Given an as-built structured result with `verdict` set to `REJECTED`, when the engine validates it, then it is rejected with a diagnostic naming `verdict` that quotes `REJECTED` and lists `APPROVED`, `APPROVED WITH DRIFT NOTES`, `PLAN_GAP`, `BLOCKED`, and the attempt is scored `absent` and reruns
- Given an as-built structured result with `verdict` set to `APPROVED WITH DRIFT NOTES`, when the engine validates it, then it is accepted as a recognized verdict and is not treated as unrecognized

#### Negative Paths
- Given an as-built structured result whose `verdict` is an empty or whitespace-only string, when the engine validates it, then it is rejected naming `verdict`, the attempt is scored `absent`, and neither the diagnostic nor the exhaustion halt reason claims a PLAN_GAP defect

### Done When
- [ ] Unit test: `verdict` set to `REJECTED` is rejected with a diagnostic naming `verdict` and carrying the read value
- [ ] Unit test: the rejection diagnostic for an unrecognized verdict contains the read value and all four accepted values
- [ ] Unit test: each valid typed verdict still classifies to its existing outcome (`approved`, `plan-gap-delivered`, `plan-gap-undelivered`, `blocked-remediable`, `blocked-design`)

## Story 3: Genuine PLAN_GAP missing `Outcome delivered` keeps its exact wording

As an operator, I want the real PLAN_GAP-missing-outcome defect to be the one case whose
diagnostic speaks of PLAN_GAP, so that the fix does not regress the one case the old string
described correctly.

### Acceptance Criteria

#### Happy Path
- Given an as-built structured result with verdict `PLAN_GAP` and no `outcomeDelivered` field, when the engine validates it, then it is rejected with a diagnostic naming `outcomeDelivered` and stating that a PLAN_GAP verdict must record whether the outcome was delivered as true or false, the attempt is scored `absent` and reruns, and on exhaustion the needs-human halt names the as-built step and `outcomeDelivered`

#### Negative Paths
- Given an as-built structured result with verdict `PLAN_GAP` and `outcomeDelivered` set to the string `maybe`, when the engine validates it, then it is rejected (malformed stays fail-closed) with a diagnostic naming `outcomeDelivered` and the accepted true or false forms
- Given an as-built structured result with verdict `PLAN_GAP` and `outcomeDelivered` true, when the engine validates it, then it is accepted and classified as `plan-gap-delivered`, not rejected

### Done When
- [ ] Unit test: PLAN_GAP without `outcomeDelivered` is rejected with a diagnostic naming `outcomeDelivered` that mentions PLAN_GAP and the true or false forms
- [ ] Unit test: PLAN_GAP with `outcomeDelivered` true or false still classifies as `plan-gap-delivered` or `plan-gap-undelivered`

## Story 4: BLOCKED with unparseable findings block is named as such

As an operator, I want a halt caused by a BLOCKED verdict whose findings fail validation to
name the defective finding field, so that I fix that finding instead of the verdict.

### Acceptance Criteria

#### Happy Path
- Given an as-built structured result with verdict `BLOCKED` whose `findings[1].class` is outside REMEDIABLE and DESIGN, when the engine validates it, then it is rejected with a diagnostic naming `findings[1].class` and the admitted values, the attempt is scored `absent` and reruns, and on exhaustion the needs-human halt reason names the as-built step and that field

#### Negative Paths
- Given an as-built structured result with verdict `BLOCKED` and well-formed findings whose references resolve, when the engine validates it, then it is accepted and classified `blocked-remediable` or `blocked-design`, not rejected, and the conductor consumers branch on the typed outcome kind exactly as before

### Done When
- [ ] Unit test: BLOCKED with a malformed finding is rejected with a diagnostic naming the `findings[n]` field and its requirement
- [ ] Unit test: BLOCKED with valid findings still classifies `blocked-remediable`/`blocked-design`
- [ ] Type check passes with the typed as-built verdict union across all consumers with no behavior change outside the rejection path
