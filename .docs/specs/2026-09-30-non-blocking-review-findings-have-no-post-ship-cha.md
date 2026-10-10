# PRD: Operator action inbox for non-blocking review findings

**Date:** 2026-09-30
**Status:** Approved
**Approved by:** Operator, 2026-09-30 ("yes" to the requirements and explicit product decisions)
**Source:** jstoup111/ai-conductor#1810
**Track:** Product

## Problem / Background

Review can discover a legitimate concern that does not prevent the current feature from shipping.
The operator still needs to decide what to do about it. Today some such findings survive only in
review evidence or the shipped feature's record; others already have a deferred intake issue.
There is no unified operator workflow for seeing the outstanding actions across those sources and
recording whether each was acted on or dismissed.

The prerequisites have evolved since the issue was filed. Requirements audit and as-built review
already retain certain non-blocking findings, and build review already supports deferral. Historical
records also include findings that were repaired before shipping. Treating every retained finding
as new work would recreate completed work and ignore existing operator decisions.

A separate part of the confirmed request concerns issue closure: one implementation can resolve
several issues, but its spec currently carries only one originating issue. The operator needs to
declare the additional issues resolved by that implementation so they close when it merges.

## Goals & Non-Goals

**Goals**

- Give every outstanding non-blocking review concern an operator-visible action associated with
  its feature, including concerns recorded before this capability existed.
- Let the operator review actions together, act on or dismiss them, and choose when a new intake
  issue is warranted.
- Let an otherwise shippable feature proceed while its non-blocking actions remain outstanding.
- Close the explicitly declared related issues when the implementation merges.

**Non-Goals**

- Perform the follow-up fix as additional work on the originating feature.
- Rejudge historical reviews or turn genuine blockers into non-blocking findings.
- Automatically create an intake issue for every action.
- Infer that related issues should close merely because they appear similar.

## Users / Personas

- **Operator:** runs features through review and shipping, then triages outstanding concerns across
  the repository without reopening each build session.
- **Spec author:** records the additional issues a planned implementation will resolve.
- **Maintainer:** needs the original evidence and prior operator decisions to remain available when
  acting on an older finding.

## Functional Requirements

- **FR-1 — Capture:** An outstanding concern classified as non-blocking by build review,
  requirements audit, or as-built architecture review becomes a retained action associated with
  the originating feature. Review classification remains the authority on whether it blocks.

- **FR-2 — Visibility:** The operator can list open actions for one feature and across the
  repository's features, and inspect acted-on and dismissed actions separately. Actions remain
  discoverable after the feature ships and its temporary working environment is removed.

- **FR-3 — Context:** Each action shows the concern, originating feature and review source,
  supporting evidence, prior risk or scope decisions when present, and any existing follow-up
  issue. Unavailable historical evidence is identified as unavailable rather than invented.

- **FR-4 — Operator resolution:** The operator can mark an individual open action acted-on or
  dismissed and record a reason or follow-up reference. The resulting decision remains visible
  with the action after restart. Merely viewing an action does not resolve it.

- **FR-5 — Repeat handling:** Reprocessing the same captured finding through retry, recovery, or
  historical import does not create a duplicate action or reopen one already acted-on or
  dismissed. Distinct findings are not combined solely because their summaries look alike.

- **FR-6 — Optional intake:** The operator can request an intake issue for an action. Successful
  filing retains the issue reference on the action; an already linked issue is reused instead of
  creating another. Capturing an action alone does not request publication or mark it acted-on.

- **FR-7 — Publication failure:** If requested intake publication fails or its outcome is
  uncertain, the operator sees that condition and can recover without duplicate publication.
  The action remains available; an unconfirmed publication is never reported as successful.

- **FR-8 — Non-blocking lifecycle:** Capturing, retaining, resolving, or publishing a non-blocking
  action does not append plan work, consume a remediation attempt, or halt the originating feature.
  In particular, an otherwise satisfied review does not wait for optional intake publication.
  Genuine blocking findings still follow their existing review authority.

- **FR-9 — Historical recovery:** Findings explicitly retained in historical review evidence or
  shipped-feature records become available through the same action workflow without rerunning
  review, rebuilding the feature, or requiring its temporary working environment to exist when
  its retained records provide sufficient evidence. Repeating recovery preserves existing actions
  and operator resolutions.

- **FR-10 — Prior outcomes:** A finding explicitly recorded as repaired, refuted, or dismissed is
  not introduced as an open action. A prior decision to accept a risk or allow shipping remains
  visible and does not by itself mean that the follow-up was completed. Existing follow-up issues
  remain associated with their concerns.

- **FR-11 — Incomplete evidence:** Missing, unreadable, malformed, or conflicting source evidence
  is reported with the affected feature or source. The operator can distinguish an incomplete
  action listing or recovery from a complete result with no open actions. Valid independent
  findings remain usable, and unavailable evidence never authorizes an invented resolution.

- **FR-12 — Durable decisions:** Captured actions and confirmed operator resolutions survive
  process restart and normal feature cleanup. Repeated or concurrent operations must not silently
  lose a confirmed decision, report an unpersisted decision as successful, or attach it to a
  different feature's finding.

- **FR-13 — Additional closure targets:** A spec author can explicitly declare additional issues
  that the implementation will resolve while preserving its originating issue. These declarations
  are reviewable with the spec and remain associated with the feature through implementation.

- **FR-14 — Closure validation:** Invalid additional issue references are refused with a diagnostic
  naming the invalid entry before they can become closing instructions. Repeating a valid target,
  including the originating issue, results in only one closing instruction for that target.

- **FR-15 — Merge-linked closure:** The implementation pull request carries closing instructions
  for the originating issue and every valid, explicitly declared additional target. Opening or
  merging the specification alone does not close those issues. Retrying implementation publication
  preserves unrelated pull-request content and does not duplicate closing instructions.

- **FR-16 — Closure failure visibility:** Failure to attach the declared closure targets is
  reported as incomplete publication of those targets, never as successful closure coverage. The
  operator can recover the linkage without losing the declarations or closing unrelated issues.

## Non-Functional Requirements

- **Provider parity:** The same operator outcomes apply to all supported host providers and to
  attended and daemon-driven review flows.
- **Local availability:** Reviewing retained actions and recording operator resolutions must not
  require the external issue tracker to be reachable. Publishing an issue remains dependent on it.
- **Observability:** Action capture, resolution, publication results, and recovery failures are
  visible through the harness's existing operator observability surfaces.
- **Authority:** Tracker-supplied text and review summaries are evidence, not authorization to
  close issues, dismiss actions, or change the originating feature's approved work.
- **Compatibility:** Existing features with no additional closure declarations retain their
  existing originating-issue behavior. Existing explicit risk decisions and review outcomes retain
  their meaning.

## Acceptance Criteria / Success Metrics

- One example from each of the three review sources appears in the feature and repository action
  views with its evidence and provenance; an otherwise satisfied feature ships with those actions
  still open and no additional plan work or remediation charge.
- After an operator resolves one action, restart and repeated source processing preserve exactly
  that resolution. A different concern remains open.
- An operator-requested intake publication succeeds once; retry after an uncertain or failed
  attempt neither duplicates the issue nor prevents the originating feature from shipping.
- Historical retained findings are recovered without review dispatch. An explicitly repaired
  historical finding is not an open action; a missing or malformed source yields a named
  incomplete-recovery result while valid sources remain available.
- After normal feature cleanup, the operator can still inspect and resolve its outstanding actions.
- A spec declaring an originating issue and two distinct additional targets reaches an
  implementation pull request with three closing instructions. A repeated target adds no duplicate;
  an invalid target is reported; the spec pull request carries no closing instructions for them.
- Every functional requirement has an explicit behavioral coverage disposition at the lowest
  sufficient test layer. Publication checks use controlled tracker substitutes; production issue
  closure is not performed as part of automated validation.

## Scope

### In Scope

- An operator action inbox extending the existing review-case workflow, covering build review,
  requirements audit, and as-built architecture review.
- Per-feature and repository-wide visibility; acted-on and dismissed decisions; optional intake;
  repeat handling, durability, and failure visibility.
- Recovery of retained historical findings, preserving their evidence and prior outcomes.
- Explicit additional issue declarations and implementation-merge closure linkage.
- Documentation of the operator workflow and recovery behavior alongside its implementation.

### Out of Scope

- New review questions, new blocking criteria, automatic remediation of inbox actions, or
  reassessment of historical findings.
- Automatic issue creation merely because an action was captured.
- Automatic discovery of extra issues to close, automatic merging, or issue-assignee changes.
- Reconstructing evidence that was never retained or has been lost; such gaps must be reported.

## Key Decisions & Rationale

- **Confirmed — action inbox, product track:** The operator selected approach A and product track
  on 2026-09-30. A unified triage workflow avoids mandatory issue volume while preserving the option
  to create follow-up work.
- **Confirmed — full requested scope:** The operator confirmed historical recovery and additional
  merge-linked issue closures as part of this feature, not deferred work.
- **Confirmed — risk acceptance differs from follow-up completion:** Preserve the
  earlier decision to ship while requiring an explicit acted-on or dismissed outcome to clear an
  outstanding action. Already repaired or refuted concerns do not become new open actions.
- **Confirmed — optional publication never holds shipping:** The inbox is useful
  even while the tracker is unavailable; issue-publication recovery belongs to the action, not to
  the originating feature's remediation loop.

## Dependencies

- The existing review-classification and operator-risk-decision authorities remain the source of
  eligibility; this feature does not replace their judgement.
- Earlier review consolidation delivered retained non-blocking findings. Current build review
  also supports deferred issues; those existing links must be preserved during adoption.
- Existing GitHub issue and pull-request integration supplies optional intake publication and
  merge-linked issue closure. Repository access and the hosting service's merge/closure rules
  continue to apply.

## Open Questions

These are architecture trade-offs, not unresolved product goals:

- How should the existing cases retain action state beyond normal worktree cleanup while exposing
  one authoritative operator view, rather than a second source of review decisions?
- How should stable source identity and semantic case reconciliation preserve prior resolutions
  across review retries and heterogeneous historical evidence without merging distinct concerns?
- How should current build-review deferral obligations transition to optional action publication
  without losing existing issues or allowing a true blocking finding to bypass its owner?
- Where should historical normalization and incomplete-recovery reporting occur so retained
  evidence stays authoritative and review is never rerun?
- How should additional closure declarations survive existing spec-authoring and implementation
  publication paths, including retries and edits to unrelated pull-request content?

## Verify-Claims Ledger

- **Verified:** Current review evidence distinguishes non-blocking findings, accepted scope/risk,
  and completed repairs; historical examples of these records were read during exploration.
- **Verified:** Current cases already support build-review deferral and requirements-audit scope
  reconciliation. They do not yet supply the requested durable post-ship action workflow.
- **Verified:** Current implementation publication takes one originating issue reference; the
  confirmed added scope requires support for explicitly declared additional targets.
- **Approved inputs:** Full issue scope and ai-conductor routing, followed by approach A and product
  track, were explicitly confirmed by the operator on 2026-09-30.
- **Approved product requirements:** The operator approved FR-1 through FR-16 and the two explicit
  product decisions on 2026-09-30. Architecture, stories, and the implementation plan remain gated
  separately before BUILD.

Verdict: CLEAR. Product requirements are approved. No new internal mechanism is selected by this PRD.
