# Remediable as-built BLOCKED halts name their cause

**Status:** Accepted

Source: https://github.com/jstoup111/ai-conductor/issues/2195
Track: technical. Tier: S.

## Context

An as-built `BLOCKED` verdict whose findings are all `REMEDIABLE` already enters the bounded
build-remediation route (adr-2026-08-25). The halt the issue cites happened because that route's
planner output produced nothing routable and the caller fell through to the one collapsed gate
reason — "as-built review verdict is BLOCKED — shipped code violates an approved architecture
decision" — which is also the reason a DESIGN-class verdict gets. #2194 named the
all-dispositions-rejected case; the remaining silent exits are a planner that wrote no usable
`remediation.json` at all, and the gate reason itself, which cannot tell an operator whether a
decision is open or a repair failed to route. Scope is diagnostic only: no routing, budget, or
halt-class change.

## Story 1: A remediable verdict whose planner produced no usable plan halts naming the planner failure

As the operator reading a halt, I want a remediable BLOCKED verdict whose remediation planner wrote no usable plan to halt with a reason that says the planner produced nothing and why, so that I fix the planner output instead of reopening an architecture decision that was never in question.

### Acceptance Criteria

#### Happy Path
- Given a daemon-mode validation-group round whose as-built verdict is BLOCKED with every finding REMEDIABLE and no manual_test FAIL, when the remediation planner leaves no `.pipeline/remediation.json` behind, then the feature halts needs-human with a reason stating the as-built findings were REMEDIABLE, that remediation did not route because the planner wrote no remediation plan, and listing each blocking finding with its class and governing clause.
- Given the same round, when the planner's `.pipeline/remediation.json` is unparseable JSON or its `dispositions` is not an array, then the halt reason names that malformation as the cause and still lists each blocking finding.

#### Negative Paths
- Given the same round, when the planner's `.pipeline/remediation.json` exists but predates the session start, then the halt reason names the plan as stale rather than absent, and the halt text does not contain "shipped code violates an approved architecture decision".
- Given a serial (non-group) as-built step whose planner wrote no usable plan, when it halts, then its halt reason carries the same planner-failure cause and per-finding listing, so the two sites cannot disagree about why nothing routed.

### Done When
- [ ] `planRemediation`'s no-plan result carries a `reason` naming which of absent, stale, unparseable, or non-array-gaps applied, and no caller can receive a bare reason-less no-plan result.
- [ ] The validation-group as-built route halts on a no-plan result with a reason containing the planner-failure cause and the per-finding listing, and a unit test asserts the halt text for the absent-file case does not contain "shipped code violates an approved architecture decision".
- [ ] A unit test for the stale-file case asserts the halt reason contains the word "stale" and lists AB-1's class and governing clause.

## Story 2: The as-built gate reason distinguishes a DESIGN verdict from a REMEDIABLE one

As the operator reading a needs-human halt, I want the as-built gate's BLOCKED reason to say whether the verdict needs a human decision or is a repair that did not route, and for a decision to name the DESIGN finding(s), so that I know from the first line whether to amend an ADR or to look at remediation.

### Acceptance Criteria

#### Happy Path
- Given an as-built report with Verdict BLOCKED and at least one finding of class DESIGN, when the `architecture_review_as_built` completion gate evaluates it, then the gate's reason states the verdict needs a human decision and names each DESIGN finding id with its governing clause.
- Given an as-built report with Verdict BLOCKED and every finding REMEDIABLE, when the gate evaluates it, then the gate's reason states every blocking finding is REMEDIABLE and that the verdict is a repair, and does not describe it as a decision.

#### Negative Paths
- Given a BLOCKED report mixing one DESIGN and two REMEDIABLE findings, when the gate evaluates it, then the reason names only the DESIGN finding as the decision and does not list the REMEDIABLE ids as decisions.
- Given a BLOCKED report whose Blocking Findings table is unparseable, when the gate evaluates it, then the reason remains the existing invalid-findings message and neither the decision nor the repair wording appears.

### Done When
- [ ] The `architecture_review_as_built` gate returns two distinct reason strings for `blocked-design` and `blocked-remediable`, the design reason naming each DESIGN finding id and clause.
- [ ] Unit tests cover all-DESIGN, all-REMEDIABLE, mixed, and unparseable inputs and assert the exact reason wording for each.
- [ ] The existing gate test that pins the collapsed reason string is updated to the new wording rather than deleted.

## Story 3: The validation-group as-built halt lists every finding whatever its class

As the operator reading a validation-group halt on an as-built verdict, I want the halt to list every blocking finding with its class and governing clause regardless of whether the verdict was DESIGN or REMEDIABLE, so that the group halt tells me as much as the serial as-built halt already does.

### Acceptance Criteria

#### Happy Path
- Given a validation-group round whose as-built verdict is BLOCKED with every finding REMEDIABLE and remediation is disabled by `architecture_review_as_built.remediation.enabled: false`, when the group halts, then the halt reason lists each finding id, class, and governing clause and states remediation is disabled.
- Given a non-daemon run whose as-built verdict is BLOCKED with every finding REMEDIABLE, when the group halts, then the halt reason lists each finding and states remediation runs only in daemon mode.

#### Negative Paths
- Given a validation-group round whose as-built verdict is BLOCKED with a DESIGN finding, when the group halts, then the `Blocking findings:` listing block appears exactly once in the halt text, not duplicated by the gate reason and the group site both rendering it.
- Given a validation-group round whose as-built report is invalid (no Verdict line), when the group halts, then the halt reason is the existing invalid-verdict message with no finding listing and no remediation wording.

### Done When
- [ ] The validation-group as-built halt appends the per-finding listing for `blocked-remediable` as well as `blocked-design`, with a cause clause naming why remediation did not run (disabled, non-daemon, or planner failure).
- [ ] A unit test with remediation disabled asserts the halt text lists AB-1 and AB-2 with class REMEDIABLE and states remediation is disabled.
- [ ] A unit test with a DESIGN finding asserts the `Blocking findings:` listing header appears exactly once in the halt text.
