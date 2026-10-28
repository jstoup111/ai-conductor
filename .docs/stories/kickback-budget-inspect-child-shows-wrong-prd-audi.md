**Status:** Accepted

# Stories: kickback-budget inspect --child shows wrong prd_audit/as-built budgets (#3364)

This is a technical-track change, so there is no PRD. The acceptance criteria come from the desired
outcomes of jstoup111/ai-conductor#3364 and from the existing decisions that keep feature-wide
budgets in the flat ledger: `adr-2026-10-12-routed-whole-feature-repair` D10 and
`adr-2026-10-07-per-child-build-region` D10. Terms used below:
- **The flat ledger** is the feature's `.pipeline/kickback-ledger.json`.
- **The child-2 ledger** is `.pipeline/children/2/kickback-ledger.json`.
- **A child view** is `kickback-budget inspect` with `--child 2`, or without `--child` on a feature
  whose execution child is 2.
- **The feature-wide budgets** are the `prd_audit` and `architecture_review_as_built` gates, and the
  plan-growth budget.

`manual_test` is not a `kickback-budget` gate. `inspect` does not render it and `raise` refuses it,
so this change adds no behavior for it.

## Story 1: A child view reports the feature-wide budgets the halt and raise use

As an operator deciding whether to raise a budget on a halted multi-child feature, I want the child
view to show the same feature-wide consumed counts, limits, adjustment history and resume
authorization that the live halt reports and `raise` updates, so that I neither skip a needed raise
nor miss one already given.

### Acceptance Criteria

#### Happy Path
- Given the flat ledger has an `architecture_review_as_built` entry with 3 consumed laps, an effective lap cap of 4, one raise adjustment and a resume authorization bound to the live halt generation, and the child-2 ledger has an `architecture_review_as_built` entry with 0 laps and no adjustments, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then the `architecture_review_as_built` block prints `Kickback budget (architecture_review_as_built): 3/4 consumed; 1 remaining`, lists that raise's id in `Adjustment history:`, and prints `Resume authorization: awaiting daemon sweep`.
- Given the flat ledger has a `prd_audit` entry with 5 laps, an effective lap cap of 5 and two raise adjustments, and the child-2 ledger has a `prd_audit` entry with count 0, when the operator runs `kickback-budget inspect --feature <slug> --child 2 --format json`, then the JSON keeps `"child": 2` and its `prd_audit` gate reports `consumed` 5, `limit` 5, `laps` 5, `lapCap` 5 and both adjustment ids.
- Given the flat ledger records an effective plan-growth cap of 15, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then every gate block's `Plan growth:` line reports cap 15 as a `raised cap`, with the added count from the feature's growth accounting.
- Given the flat ledger's pending repair charges 1 `prd_audit` lap, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then the `prd_audit` block prints `Pending charge: 1 lap (charged when build dispatches)` and its remaining count excludes that lap.
- Given a `kickback-cap` halt written for child 2 on an exhausted `architecture_review_as_built` lap cap, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then that block's `Kickback budget (architecture_review_as_built):` line is identical to the corresponding line in the halt.
- Given that halt is live, when the operator runs `kickback-budget raise --feature <slug> --gate architecture_review_as_built --by 1 --rationale "<why>" --child 2` and then `kickback-budget inspect --feature <slug> --child 2`, then the inspected block shows the raised limit and lists the new adjustment's id.
- Given a feature whose execution child is 2 and whose flat ledger holds the `architecture_review_as_built` entry above, when the operator runs `kickback-budget inspect --feature <slug>` without `--child`, then the `architecture_review_as_built` block reports the same consumed count, limit and adjustment history as with `--child 2`.
- Given the flat ledger holds a staged `prd_audit` adjustment whose authorization event was recorded before an interrupted `raise`, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then the adjustment is applied to the flat ledger exactly once and the `prd_audit` block shows its raised limit.

#### Negative Paths
- Given an unparseable flat ledger and a readable child-2 ledger, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then it prints `kickback-budget: ledger is unreadable.` and exits 1.
- Given the flat ledger's `prd_audit` entry fails validation while its other entries are valid, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then it prints `prd_audit: budget unavailable (durable entry failed validation)`, still renders the other gates, and exits 1, and the JSON form lists `prd_audit` in `unavailableGates`.
- Given the child-2 ledger's `prd_audit` entry fails validation while the flat ledger's `prd_audit` entry is valid, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then the `prd_audit` block renders the flat ledger's values and the command exits 0.
- Given neither ledger holds a pending adjustment, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then the bytes of the flat ledger and the child-2 ledger are unchanged.
- Given a feature with no child state, when the operator runs `kickback-budget inspect --feature <slug>` in human or JSON form, then its output is unchanged by the child-view behavior of this story: identical to the flat-feature inspect output, whose remediation-gate lines carry only the tier-and-allowance suffix and whose JSON carries only the `tier` and `allowanceSource` fields that #2413 adds.

### Done When
- [ ] CLI inspect tests on a stacked fixture show the flat ledger's laps, cap, adjustment history, resume authorization and pending charge for both remediation gates, in human and JSON form, while the child-2 ledger holds stale copies.
- [ ] A CLI test shows the plan-growth line in a child view reporting the flat ledger's raised cap.
- [ ] A test drives a `raise --child 2` on `architecture_review_as_built` and then `inspect --child 2`, and sees the new limit and adjustment.
- [ ] CLI tests cover the unreadable flat ledger, a malformed flat gate, a malformed child copy, unchanged ledger bytes, and the unchanged childless output.

## Story 2: Child-scoped budgets keep their child ledger

As an operator recovering one child's region, I want `build_review` and `restack` to keep reading
and writing that child's ledger, so that fixing the feature-wide view does not move per-child
accounting.

### Acceptance Criteria

#### Happy Path
- Given the child-2 ledger has a `build_review` entry with cumulative 4 and an effective limit of 6, and the flat ledger has a `build_review` entry with cumulative 1, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then the `build_review` block prints `Kickback budget (build_review): 4/6 consumed; 2 remaining`.
- Given child 2 is selected, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then a `restack` block is rendered from the child-2 ledger's `restack` entry as before this change.
- Given a live `needs-human` `build_review` cap halt for child 2, when the operator runs `kickback-budget raise --feature <slug> --gate build_review --by 1 --rationale "<why>" --child 2`, then the adjustment is written to the child-2 ledger, the flat ledger's `build_review` entry is unchanged, and the printed `Plan growth:` line reports the flat ledger's plan-growth cap.

#### Negative Paths
- Given an unparseable child-2 ledger and a readable flat ledger, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then it prints `kickback-budget: ledger is unreadable.` and exits 1.
- Given the child-2 ledger's `build_review` entry fails validation, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then it prints `build_review: budget unavailable (durable entry failed validation)`, still renders `prd_audit` from the flat ledger, and exits 1.
- Given no `.pipeline/children/3/`, when the operator runs `kickback-budget inspect --feature <slug> --child 3`, then it prints `kickback-budget: child 3 has no child state.`, exits 1, and leaves the flat ledger's bytes unchanged.

### Done When
- [ ] CLI inspect tests show `build_review` and `restack` rendered from the child-2 ledger while the flat ledger holds different values.
- [ ] A CLI test shows a `build_review` raise with `--child 2` changing only the child-2 ledger and printing the flat plan-growth cap.
- [ ] CLI tests cover the unreadable child ledger, the malformed child `build_review` entry, and the missing child state.
