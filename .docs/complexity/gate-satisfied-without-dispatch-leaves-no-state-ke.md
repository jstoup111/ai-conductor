# Complexity: Gate satisfied without dispatch leaves no state key, so FINISH invalidates forever

Tier: M

## Rationale

The narrowed change is small in lines — one observer call site and one typed facet threaded from
the publication condition through the route to the kickback evidence. It is nonetheless Medium,
not Small, because the constraint surface is unusually dense and the decisions are load-bearing:

- **A publication evidence contract changes.** `observeImplementationEvidence` moves from a
  state-key read to the verdict-authoritative `gateSatisfied`. That interacts with
  `adr-2026-08-01-engine-owned-resumable-finish-publication` D1 (snapshot derives from
  authoritative evidence) and `adr-2026-07-11-verdict-aware-resume-entry` D5 (one authority, no
  new predicate). Getting this wrong re-opens a previously closed regression.
- **The diagnostic is a typed-union change, not a string edit.**
  `adr-2026-09-05` D5 and `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` D1 forbid
  deriving the step name by matching message text; `adr-2026-07-11-finish-step-engine-completion-machinery`
  D4's machine-readable facet code is the seam to extend, and
  `adr-2026-08-08-finish-human-required-halt-rendering` requires a closed reason union plus a
  guidance row rather than free text.
- **An adjacent ADR conflict must be adjudicated, not silently inherited.**
  `adr-2026-08-16` D2 and `adr-2026-07-26-rebase-tail-current-branch-before-publication` D5 say the
  redirect targets the earliest non-green validator and marks only non-green members stale, while
  the current code routes to BUILD and marks `test_suite`/`build_review` stale unconditionally.
  Whether this spec corrects that is an architecture-review decision.

Medium therefore buys the architecture-review that adjudicates those points before stories are
written. It is not Large: no new subsystem, no new durable state, no new counter, no config key,
and the excluded work (write-through, cumulative bound) is where the blast radius would have been.
