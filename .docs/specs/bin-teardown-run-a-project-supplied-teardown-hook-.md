# PRD: Release worktree-provisioned resources before a worktree is removed

**Date:** 2026-08-07
**Status:** Approved

## Problem / Background

Every feature worktree the daemon creates is prepared by running the project's own
conventional setup entrypoint with a per-worktree identity exported into its environment.
That identity exists precisely so a project can provision **worktree-scoped resources** —
a namespaced database, a schema, a message-queue prefix, a reserved port — without
concurrent worktrees colliding on shared infrastructure. Provisioning is the documented,
intended use of the per-worktree identity.

Nothing releases those resources. Every path that removes a worktree removes only the
directory: the git checkout disappears, and the database, schema, or port it provisioned
remains allocated with no owner and no record. The resources accumulate monotonically —
one leaked set per build, per rebase reclaim, per operator cleanup — for as long as the
project runs the daemon. Nothing in the harness ever reclaims them, and nothing surfaces
that they leaked, so the failure is silent until the operator hits a disk, connection, or
port-range limit and has to reconstruct by hand which of hundreds of orphaned resources
are safe to drop.

The asymmetry is the defect: the harness gives a project a documented hook to **acquire**
worktree-scoped resources and no hook at all to **release** them. A project cannot fix
this itself — by the time removal happens there is no project code left running, and no
point at which the project is invited to act.

This matters now because the daemon is the normal way work gets built in this harness.
Leak rate scales directly with throughput, so the cost of the gap grows with exactly the
usage the harness is designed to encourage.

## Goals & Non-Goals

**Goals**

- A project can release whatever its setup step acquired, at the moment its worktree stops
  existing, using the same per-worktree identity it acquired under.
- Projects that provision nothing are unaffected and unaware — no new obligation, no new
  output, no new failure mode.
- A project's release step can never damage the harness: no failure, hang, or crash in
  project-supplied code may wedge the daemon, strand a worktree, or block a cleanup an
  operator invoked.
- A worktree-removal path added in the future cannot silently skip the release step; the
  omission must surface at development time rather than as an unexplained leak in
  production.

**Non-Goals**

- Reclaiming resources whose worktree is already gone — a worktree lost to a crash, a
  manual directory deletion, or an interrupted run is out of scope. The release step is
  invited only where the harness itself performs the removal.
- Releasing resources for rebase-conflict-resolution worktrees. These are known to
  provision and leak identically; excluding them is a deliberate, recorded deferral to
  separate work, not an oversight. See **Scope — Out**.
- Any form of resource tracking, ledger, inventory, or reconciliation of what a project
  provisioned. The harness stays infrastructure-agnostic: it invites the project to act
  and never models what the project owns.
- Changing what the setup step does, when it runs, or what identity it receives.
- Removing or replacing worktree removal itself, or altering the conditions under which a
  worktree is retained rather than removed.
- Retroactively releasing resources leaked by builds that already ran.

## Users / Personas

- **The project maintainer** using this harness in a repository whose test environment
  needs real provisioned infrastructure. They already author the setup step that acquires
  it. They want the release to be as ordinary and as unremarkable as the acquisition, and
  they want it to run without their having to think about daemon internals.
- **The operator** running the daemon day to day, and running cleanup commands by hand
  when a feature is parked or reclaimed. They want cleanup to actually be cleanup, and
  when a project's release step misbehaves they want to see it in the log rather than
  discover a wedged daemon.
- **The harness contributor** adding or changing a worktree-removal path. They want the
  system to tell them a release obligation exists on the path they are touching, rather
  than relying on their having read this document.

## Functional Requirements

- **FR-1:** When the harness removes a worktree on an in-scope path, the project's
  release step runs to completion **before** the worktree directory is removed, so the
  project's own code and configuration are still present and readable while it runs.

- **FR-2:** The release step receives the **same execution environment the setup step
  received** for that same worktree: the same per-worktree identity value, and the same
  non-interactive-execution signal. A project can therefore address exactly the resources
  it provisioned, using the identical identity it provisioned them under, with no
  additional bookkeeping on either side.

- **FR-3:** The per-worktree identity supplied to the release step is derived from the
  worktree itself and requires no state persisted at setup time. A worktree that was
  recreated from its branch, or whose transient working state was lost, still receives the
  correct identity.

- **FR-4:** A project that supplies **no** release step is a silent no-op. Removal
  proceeds exactly as it does today, with no error, no warning, and no additional output —
  the same contract a project already gets when it supplies no setup step.

- **FR-5:** The release step is invited on **every** removal path where the harness itself
  removes a worktree that its own preparation provisioned: the daemon's post-ship reap,
  the operator's retained-worktree reclaim, and parked-feature reconciliation cleanup.

- **FR-6:** A release step that exits with a failure status does **not** prevent worktree
  removal. Removal proceeds, and the removal path's own outcome — reap, reclaim, or
  reconciliation — is unchanged from what it would have been.

- **FR-7:** A release step that hangs does not hang the harness. It is bounded in time;
  once the bound elapses the step is abandoned and removal proceeds. An unbounded or
  wedged project script can never stall the daemon, block an operator's cleanup command,
  or leave a worktree stranded.

- **FR-8:** A release step that fails or exceeds its time bound is reported in the
  operator-visible log, identifying the affected worktree and carrying a trailing excerpt
  of the step's own output — enough to diagnose without re-running it. A leak caused by a
  broken release step is therefore visible at the moment it happens rather than
  discovered later.

- **FR-9:** A release step that succeeds does not flood the operator log. Its routine
  output is summarized rather than echoed in full, consistent with how the setup step's
  successful output is already handled, and remains available in full when the operator has
  asked for verbose daemon output.

- **FR-10:** Every worktree-removal path in the harness either invites the release step or
  is recorded in an explicit, human-readable exemption list stating why it does not. A
  newly added removal path that does neither **fails the project's own validation** until
  it is classified — the omission cannot reach production silently.

- **FR-11:** The exemption list is accurate at the time of delivery: it records the
  rebase-conflict-resolution path as a known, deliberately deferred leak, and records the
  specification-authoring and legacy-cleanup paths as provisioning nothing and therefore
  having nothing to release.

- **FR-12:** The release-step capability is documented for project maintainers wherever the
  existing setup-step capability and the per-worktree identity are already documented,
  including its execution environment, its absent-step behavior, its time bound, and its
  failure semantics. A maintainer can author a correct release step from the documentation
  alone, without reading harness source.

## Non-Functional Requirements

- **Reliability:** No project-supplied code executed by this feature may propagate a
  failure into harness control flow. Failure, non-zero exit, timeout, and spawn error are
  all contained at the invocation boundary.
- **Observability:** Every abnormal outcome of a release step is attributable from the
  operator log alone — which worktree, which outcome, and what the step emitted.
- **Compatibility:** Projects that do not adopt the release step observe no behavioral
  change whatsoever, including in log volume.
- **Host-agnostic:** The capability is available identically regardless of which supported
  host agent the operator is running; it depends on no host-specific facility.

## Acceptance Criteria / Success Metrics

- A project that provisions a namespaced resource in its setup step and releases it in its
  release step ends a full daemon build-and-reap cycle with zero orphaned resources.
- The same project ends an operator-invoked retained-worktree reclaim, and a parked-feature
  reconciliation cleanup, with zero orphaned resources.
- A project with no release step produces byte-identical daemon log output across a build
  compared to before this change.
- A release step that exits non-zero leaves the worktree removed, the removal path's
  outcome unchanged, and one operator-visible log entry naming the worktree and carrying
  the step's output tail.
- A release step that never returns leaves the worktree removed within the stated time
  bound, the daemon still dispatching, and one operator-visible timeout entry.
- Adding a new worktree-removal path without classifying it fails the project's validation
  suite with a message naming the unclassified path.

## Scope

**In**

- Inviting a project-supplied release step immediately before worktree removal on the
  daemon post-ship reap, the operator retained-worktree reclaim, and parked-feature
  reconciliation cleanup paths.
- Containment, time-bounding, and operator-visible reporting of that step's outcome.
- Validation machinery that forces every present and future removal path to be classified.
- Maintainer-facing documentation of the capability.

**Out**

- **Rebase-conflict-resolution worktrees.** These are prepared by the same setup step and
  removed without release, so they leak identically. Their inclusion was considered and
  **deliberately deferred by the operator** to separate work, to keep this change scoped to
  the daemon and operator-cleanup paths. This PRD records the gap as known and tracked; it
  is listed in the exemption list required by FR-10 so it stays visible rather than
  becoming a silent omission.
- **Specification-authoring worktrees and the legacy cleanup path.** Neither is prepared by
  the setup step, so neither provisions anything and neither has anything to release.
  Excluding them removes no capability.
- Resources orphaned before this feature ships.
- Any harness-side model, ledger, or inventory of project-owned resources.
- Changing worktree retention policy — which worktrees are kept for a human rather than
  removed is unchanged.

## Key Decisions & Rationale

- **The release step mirrors the setup step's contract exactly** — same identity, same
  execution signal, same absent-step-is-a-no-op behavior. A maintainer who has written one
  already knows how to write the other, and there is no second contract to drift.
  Symmetry is the product decision; it is what makes the capability learnable.

- **Failure is contained, never propagated — but always reported.** The alternative
  considered was blocking removal on a failed release step, which guarantees no silent
  leak. It was rejected: a flaky project script would then strand worktrees and stall the
  daemon, converting a resource leak into an availability failure. Reporting loudly gets
  the diagnosability without the fragility. The residual risk — a leak that occurs despite
  being logged — is accepted deliberately and is visible when it happens.

- **A time bound is mandatory, not optional.** Project-supplied code runs inside the
  daemon's critical path. Without a bound, a single hung script is indistinguishable from
  a wedged daemon, which is among the most expensive failure modes for an operator to
  diagnose.

- **Coverage is enforced by validation, not by convention.** This repository's own design
  principle holds that when correctness depends on several call sites staying in sync,
  the durable fix is machinery that fails at the point of violation rather than a rule
  someone must remember. The defect being fixed here is itself an invisible omission of
  exactly that shape, so shipping the fix without a guard against its recurrence would
  repeat the failure mode. FR-10 exists for this reason.

- **The deferred rebase path is recorded, not hidden.** Rather than quietly omitting it,
  the exemption list names it. A known gap that is written down stays actionable; one that
  is merely not implemented becomes indistinguishable from an oversight the next time
  someone reads the code.

## Dependencies

- **The existing project setup convention.** This feature is defined as the counterpart to
  the harness's pre-existing, already-documented convention of running a project-supplied
  setup entrypoint with a per-worktree identity exported into its environment
  (`docs/reference/environment.md`). That convention is external to this change and is not
  altered by it; this feature only adds its release-side counterpart.
- **The operator-visible daemon log**, which is the reporting channel FR-8 and FR-9 rely
  on, including its existing verbose-output setting.
- **This repository's validation suite**, which is the enforcement channel FR-10 relies on.
- **The operator's naming decision.** The operator has specified that the release step is
  the direct counterpart to the existing setup entrypoint and is to be named and located
  symmetrically with it. This is a fixed input to the work, not a choice this document
  makes.

## Open Questions

*(Deferred to `/architecture-review` as trade-offs, not decided here.)*

- **What time bound is right, and should it be adjustable?** A bound generous enough for a
  real database drop against a slow or remote instance may be far longer than an operator
  wants the daemon's reap path to stall. Whether a single fixed bound serves every project,
  or whether it should be configurable, is an engineering trade-off between predictability
  and fitness for slow infrastructure.

- **Where does the shared invocation logic live relative to the existing setup invocation?**
  Co-locating them keeps the symmetry the product depends on visible; separating them keeps
  a removal-time concern out of a preparation-time module. This is an internal structure
  question with real maintenance consequences and no product-visible difference.

- **How should the coverage guard identify removal paths, and how strict should it be?** A
  guard that is too broad blocks unrelated work and gets suppressed; one that is too narrow
  misses the very case it exists to catch. The detection strategy and the failure message's
  precision are architecture concerns.

- **Should the reconciliation cleanup path's fallback deletion also invite the release
  step?** That path can delete a directory git never registered as a worktree. Whether such
  a leftover should be treated as provisioned — and the risk of invoking project code from
  a partially-unknown state — needs technical judgment.

- **Should the release step's failure be surfaced anywhere more durable than the log** —
  for instance to the operator's status view — or is log visibility proportionate for a
  non-blocking condition? Weigh added surface against the cost of a leak going unread.
