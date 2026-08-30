**Status:** Accepted

# Stories: cumulative kickback budget recovery

**Issue:** jstoup111/ai-conductor#1760
**Track:** product
**Tier:** M — full per-criterion negative-path coverage applies.
**Approved design:** `adr-2026-08-29-operator-authorized-kickback-budget-recovery`

Documentation work is intentionally absent from these stories. It accompanies the functional
change but is not acceptance behavior.

## Story 1: An operator can inspect one feature's current review budget

**Requirement:** FR-1, FR-2

As a daemon operator, I want a read-only budget view for one named feature so that I can tell whether
semantic review laps, rather than harness-side faults, exhausted its allowance.

### Acceptance Criteria

#### Happy Path

- Given a named feature with three counted semantic laps against an effective allowance of five, when the operator inspects its budget in human-readable form, then the result identifies the feature and `build_review`, shows count 3, limit 5, remaining 2, exhausted false, and the latest counted semantic reason.
- Given that feature also has separately counted mechanical review faults, when the operator inspects it, then those faults appear in a distinct section and are explicitly excluded from the semantic count and remaining allowance.
- Given the same feature is inspected in machine-readable form, when its fields are compared with the human-readable result, then feature, gate, count, limit, remaining, exhaustion, latest reason, and mechanical-fault separation agree.

#### Negative Paths

- Given a named feature whose semantic count or effective allowance cannot be read reliably, when inspection runs, then it reports the budget as unavailable and does not present guessed numeric values or mutate the feature.
- Given mechanical fault data is absent, when inspection runs, then it reports no recorded mechanical faults without subtracting or adding anything to the semantic figures.
- Given an unknown output format or an unresolved feature name, when inspection is requested, then the command refuses with a non-success result and emits no partial budget document.

### Done When

- [ ] `ai-conductor kickback-budget inspect --feature <slug>` reports the seven required semantic
      fields for a fixture with count 3 and limit 5.
- [ ] The equivalent JSON invocation yields values identical to the human-readable view.
- [ ] A fixture containing mechanical faults proves they are labelled separately and do not change
      semantic count, limit, or remaining allowance.
- [ ] Inspection leaves the selected worktree's persisted state byte-for-byte unchanged.

## Story 2: Inspection explains adjustment history without inventing legacy history

**Requirement:** FR-3, FR-14

As a maintainer investigating convergence, I want the complete recorded adjustment history and an
honest legacy view so that I can explain why the current count and allowance differ from defaults.

### Acceptance Criteria

#### Happy Path

- Given a feature with an earlier reset followed by two allowance extensions, when it is inspected, then every adjustment appears in chronological order with kind, before and after count, before and after allowance, operator identity, rationale, and time.
- Given a legacy feature with a valid cumulative count but no adjustment history, when it is inspected, then its current count and default effective allowance remain available and historical adjustment detail is explicitly labelled unavailable.

#### Negative Paths

- Given one stored adjustment lacks required attribution or before/after data, when inspection runs, then it does not silently omit or fabricate that entry; it marks adjustment history unavailable while preserving any independently trustworthy current budget values.
- Given legacy state contains only a latest semantic reason, when inspection runs, then it does not infer earlier laps, operators, rationales, or timestamps from that reason.

### Done When

- [ ] A three-adjustment fixture renders all required fields in stable chronological order in human
      and JSON output.
- [ ] A pre-adjustment-schema fixture remains inspectable and labels missing history unavailable.
- [ ] No displayed legacy field is derived from reason prose or a guessed timestamp.

## Story 3: An authorized reset starts a fresh semantic episode

**Requirement:** FR-4, FR-10

As an operator who judges earlier semantic laps obsolete, I want to reset their consumed count so
that the feature gets a fresh bounded episode without changing its allowance.

### Acceptance Criteria

#### Happy Path

- Given a matching cumulative-cap halt with count 6 and effective allowance 5, when an authorized operator resets it with a rationale, then inspection shows count 0, limit 5, remaining 5, and one attributed reset record with before and after values.
- Given a matching halted feature whose effective allowance was previously raised to 8, when it is reset, then inspection shows count 0 and limit 8; the earlier raise remains in history.
- Given a reset feature resumes and next receives one semantic `build_review` failure, when it is inspected again, then its consumed count is 1 and its effective allowance is unchanged.

#### Negative Paths

- Given a reset is accepted, when persisted state is compared before and after, then the effective allowance, mechanical-fault accounting, non-cumulative per-tree count, and every sibling feature are unchanged.
- Given a feature has a prior raised limit, when reset runs, then the limit does not fall back to the repository default and the prior adjustment history is not erased.
- Given the first post-reset review result is a mechanical fault rather than a semantic failure, when inspection runs, then semantic count remains 0 and the fault remains separately accounted.

### Done When

- [ ] A count-6/limit-5 fixture resets to count 0/limit 5 with an attributed history entry.
- [ ] A count-6/limit-8 fixture resets to count 0/limit 8 and retains its earlier raise record.
- [ ] The next semantic failure consumes exactly lap 1 while mechanical and sibling state remain
      unchanged.

## Story 4: An authorized extension preserves consumed laps and raises one feature's bound

**Requirement:** FR-5, FR-10, FR-11

As an operator who wants more attempts without erasing history, I want to extend one feature's
effective allowance by a positive amount so that counting continues from the consumed total against
the higher bound.

### Acceptance Criteria

#### Happy Path

- Given a matching cumulative-cap halt with count 6 and effective allowance 5, when an authorized operator raises it by 3 with a rationale, then inspection shows count 6, limit 8, remaining 2, and an attributed extension from 5 to 8.
- Given that feature resumes, when two more semantic failures occur, then counts 7 and 8 are allowed; when the next semantic failure raises the count to 9, then the feature halts again under the cumulative-cap rule.
- Given the feature later halts at its raised limit, when another authorized raise is applied, then the new positive amount is added to the existing effective limit and the earlier extension remains in history.

#### Negative Paths

- Given an extension succeeds, when persisted state is compared, then its consumed count, mechanical-fault accounting, repository-wide default, and every sibling feature are unchanged.
- Given the post-extension count is exactly the new effective allowance, when review fails at that count, then the run remains eligible for the normal remediation lap; it halts only when the count exceeds the effective allowance.
- Given a requested amount is zero, negative, fractional, non-numeric, or larger than the supported safe integer range, when extension is attempted, then it is refused and count, limit, history, and halt state remain unchanged.

### Done When

- [ ] Raising a count-6/limit-5 fixture by 3 yields count 6/limit 8/remaining 2.
- [ ] A driven sequence proves count 8 is allowed and count 9 creates the matching cap halt.
- [ ] Repeated extensions accumulate visibly while invalid numeric inputs change no state.

## Story 5: Mutation requires an attributable human and an exact current halt

**Requirement:** FR-6, FR-7

As the system owner, I want recovery authority restricted to a verified interactive operator and an
exact current cumulative-cap halt so that automation or stale commands cannot weaken convergence.

### Acceptance Criteria

#### Happy Path

- Given an interactive terminal, a resolvable approved operator identity, a non-empty rationale, one exact named feature, and its current cumulative `build_review` cap halt, when reset or extension is requested, then the mutation is accepted and the resolved identity and rationale are recorded.
- Given inspection is requested by a non-interactive caller for one resolvable feature, when the state is readable, then inspection succeeds because read-only access does not require mutation authority.

#### Negative Paths

- Given a non-interactive caller attempts reset or extension, when the command runs, then it refuses, records no adjustment, and leaves budget and halt state unchanged.
- Given operator identity cannot be resolved or is not approved, when mutation is attempted, then it refuses without recording an anonymous or fallback identity.
- Given the rationale is empty, whitespace-only, or exceeds its supported bound, when mutation is attempted, then it refuses without truncating or inventing a rationale.
- Given the feature is missing, ambiguous, not halted, halted for another class, halted at another gate, or no longer matches the inspected budget generation, when mutation is attempted, then it refuses and changes neither that target nor any similarly named feature.
- Given a syntactically valid request names another repository's feature, when run from this repository, then it does not cross the repository boundary to find or mutate it.
- Given a non-interactive caller requests inspection, when it runs, then no operator-only mutation becomes reachable through output format, environment, or configuration options.

### Done When

- [ ] Both reset and extension succeed only under the complete interactive identity/rationale/exact-
      halt precondition.
- [ ] Table-driven refusal coverage proves each missing authority or mismatched-target case leaves
      budget, history, halt state, and sibling state unchanged.
- [ ] Non-interactive human and JSON inspection remain available and mutation-free.

## Story 6: An interrupted adjustment fails closed and reconciles exactly once

**Requirement:** FR-8

As an operator, I want recovery to survive interruption so that the budget, audit evidence, and halt
cannot disagree about whether my decision took effect.

### Acceptance Criteria

#### Happy Path

- Given a valid recovery, when it completes, then its attributed adjustment is durably visible before the matching halt becomes resumable, and subsequent inspection observes one complete before/after record.
- Given a process stops after the authorization occurrence is durable but before adjusted values are visible, when the same feature is reconciled, then the original adjustment completes once with the original identity, rationale, and values; it is not counted as a second decision.
- Given two recovery attempts contend for the same halted feature, when ownership is resolved, then at most one adjustment takes effect and the other returns a conflict without overwriting it.

#### Negative Paths

- Given durable authorization recording fails, when recovery returns, then active count and limit are unchanged, no adjustment appears in history, and the feature remains halted.
- Given a process stops before authorization becomes durable, when reconciliation runs, then no adjustment is applied and the feature remains halted for a fresh operator decision.
- Given reconciliation sees duplicate occurrences for one adjustment identity, conflicting values, unreadable evidence, or ownership loss, when it runs, then it does not guess which record wins; the feature remains halted and the ambiguity is reported.

### Done When

- [ ] Fault injection at every recovery boundary yields either the complete prior state or one
      complete adjusted state, never an adjusted budget without matching attribution.
- [ ] Retrying one interrupted decision produces exactly one durable history entry and one standard
      authorization occurrence.
- [ ] A concurrent two-operator fixture proves one winner, one explicit refusal, and no lost update.

## Story 7: Recovery returns only the matching halt to normal daemon ownership

**Requirement:** FR-9

As a daemon operator, I want a successful budget decision to resume through the normal halt lifecycle
so that it cannot clear another terminal condition or skip a downstream gate.

### Acceptance Criteria

#### Happy Path

- Given a successful adjustment of the exact cumulative-cap halt and no pre-existing operator park, when recovery finishes, then the feature becomes eligible for the daemon's normal safe resume path and only that matching cap terminal condition is cleared.
- Given the feature was already operator-parked before recovery, when the adjustment finishes, then the adjustment is durable but the feature stays parked until the operator explicitly unparks it; normal safe resume occurs only afterward.
- Given normal resume succeeds, when pipeline selection continues, then the earliest legitimately unsatisfied step runs and every downstream gate remains enforceable.

#### Negative Paths

- Given the live halt disappears, changes class, changes gate, or belongs to a newer terminal generation before resume, when recovery is consumed, then no halt is cleared and the feature stays stopped with a stale-authorization refusal.
- Given clearing or presenting the matching halt fails, when resume is attempted, then the feature remains halted and is not dispatched in a partially cleared state.
- Given recovery succeeds, when its process exits, then it has not itself run a build, opened or merged a PR, marked the feature shipped, or bypassed any gate.

### Done When

- [ ] A temporary-park fixture resumes through the ordinary daemon path after one exact adjustment.
- [ ] A pre-existing-park fixture retains its park until explicit unpark, then resumes normally.
- [ ] Mismatched and clear-failure fixtures retain their halt and dispatch nothing.
- [ ] A full resumed path proves later gates retain their normal verdict and halt behavior.

## Story 8: Existing convergence accounting remains bounded after recovery

**Requirement:** FR-10, FR-11

As a maintainer, I want post-recovery counting to retain the established convergence semantics so
that operator intervention creates a new finite boundary rather than disabling the guard.

### Acceptance Criteria

#### Happy Path

- Given a reset feature, when successive semantic review failures occur, then the cumulative count advances from 1 and the feature halts on the first count greater than its preserved effective allowance.
- Given an extended feature, when successive semantic review failures occur, then counting advances from the preserved consumed total and the feature halts on the first count greater than the raised effective allowance.
- Given a qualifying rebase invalidates the review after an adjustment, when existing convergence credit applies, then lap-counting fields receive the established credit while effective limit and adjustment history remain available.

#### Negative Paths

- Given a semantic `build_review` PASS occurs after recovery without a qualifying invalidation, when the feature is inspected, then the cumulative count is not automatically reset or credited.
- Given mechanical review faults occur after recovery, when the semantic budget is inspected, then they do not consume its remaining allowance or prevent its own bound from terminating later semantic failures.
- Given an automatic dispatch, engine-version change, source edit, or differently worded finding, when no operator adjustment or qualifying rebase credit occurs, then none automatically resets or raises the budget.

### Done When

- [ ] Driven reset and extension sequences each halt exactly at `count > effective allowance`.
- [ ] Existing PASS, rebase-credit, and mechanical-fault regression fixtures retain their approved
      semantics after an adjustment.
- [ ] No autonomous input can create an unbounded or silently refreshed allowance.

## Story 9: A cumulative-cap halt carries the complete canonical budget view

**Requirement:** FR-12

As an operator encountering a renewed halt, I want its diagnostics to match inspection so that I can
make the next decision without reconstructing state from internal files.

### Acceptance Criteria

#### Happy Path

- Given a feature exceeds its effective cumulative allowance, when its cap halt is presented, then it identifies the feature and `build_review`, consumed semantic laps, effective allowance, remaining allowance, latest counted semantic reason, every prior operator adjustment, and an explicit statement that mechanical faults were not charged to the total.
- Given the same halted feature is inspected, when its canonical budget fields are compared with the halt presentation, then all shared values and adjustment records agree.

#### Negative Paths

- Given legacy state lacks earlier adjustment or lap detail, when the cap halt is presented, then it labels that detail unavailable instead of inventing an explanation while still showing trustworthy current values.
- Given another gate or halt class terminates a run, when its halt is presented, then it does not falsely claim cumulative `build_review` exhaustion or acquire unrelated adjustment history.

### Done When

- [ ] One adjusted exhaustion fixture asserts every FR-12 field in the terminal presentation.
- [ ] That fixture's halt and human/JSON inspection values are identical for their shared fields.
- [ ] Legacy and unrelated-halt fixtures prove unavailable labelling and halt-class isolation.

## Story 10: Every successful adjustment is observable once on the standard event surfaces

**Requirement:** FR-13

As a maintainer investigating a recovery, I want the standard event and operator views to carry the
same adjustment evidence so that authorization is attributable without consulting a bespoke log.

### Acceptance Criteria

#### Happy Path

- Given a successful reset or extension, when standard event history and live operator observability are read, then one adjustment occurrence identifies the feature, gate, kind, before and after count and allowance, operator, rationale, and time.
- Given the adjusted feature is later inspected, when its history entry is compared with the event, then the adjustment identity, attribution, kind, values, and time agree.
- Given the adjustment was written by a standalone operator command, when ordinary event consumers read the repository's combined history, then it appears through the same event schema and ordering contract as engine-produced occurrences.

#### Negative Paths

- Given one interrupted adjustment is retried or reconciled multiple times, when event history is read, then the same adjustment identity appears once rather than once per retry.
- Given a recovery is refused before success, when event history and inspection are read, then no successful-adjustment occurrence or durable history entry is fabricated for it.
- Given a standard event consumer encounters an older history with no adjustment occurrence, when it reads the stream, then existing event kinds remain readable and missing historical adjustment evidence is not synthesized.

### Done When

- [ ] Reset and extension fixtures each produce exactly one standard adjustment occurrence with all
      required fields.
- [ ] Durable inspection history and event evidence agree on one stable adjustment identity.
- [ ] Retry, refusal, and legacy-stream fixtures prove deduplication, no false success, and backward
      compatibility.
