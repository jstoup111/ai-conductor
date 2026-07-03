# PRD: Dependency-Ordered Intake and Dispatch

**Date:** 2026-07-03
**Status:** Approved
**Source:** jstoup111/ai-conductor#229

## Problem / Background

The harness has no notion of dependency order between pieces of work. The build daemon
dispatches merged specs in discovery order, and engineer intake claims pending ideas
oldest-first — even when the work items themselves declare ordering constraints ("Gated on
#217", phased task-lists in umbrella issues). The declarations exist only as prose, so
nothing enforces them.

The motivating case is the v1.0 cutover program (#228): a dependency DAG where the cutover
is gated on six parallel work items, the changelog condense must precede the release fix,
and the release fix must precede the upgrade-path verification. If those issues are intaken
and built in whatever order the system discovers them, prerequisites won't have merged and
builds produce wrong results or churn. This capability is Phase 0 of that program: it must
exist before the program's issues can be safely handed to autonomous intake and build.

## Goals & Non-Goals

**Goals**
- Work items are never built before the work they are declared to depend on is finished.
- Work items are never *authored* (spec'd) before their prerequisites are finished, so specs
  always describe a codebase state that actually exists.
- Blocked work is always visible to the operator, with the reason — never silently skipped.
- Existing prose dependency declarations are converted into enforceable declarations once,
  so the v1.0 program is protected without re-authoring its issues.

**Non-Goals**
- Priority ordering of unblocked work (#200) — dependencies are a correctness constraint,
  priority is a preference; priority is explicitly sequenced after this feature and will
  reorder whatever survives the dependency filter.
- Continuous parsing of prose declarations going forward — after the one-time migration,
  native platform relationships are the only recognized declaration form.
- Changing what qualifies as buildable work (merged spec + accepted stories gates unchanged).

## Users / Personas

- **The operator** (solo developer) — declares ordering between issues on the tracking
  platform, expects the autonomous loops to honor it, and needs to see at a glance why a
  piece of work isn't moving.
- **The autonomous loops** (engineer intake and build daemon) — consume the declarations;
  they must make the safe choice without a human in the loop.

## Functional Requirements

**Declaration & resolution**

- **FR-1:** The system reads a work item's dependencies exclusively from GitHub's native
  "blocked by" issue relationships on the work item's originating issue, resolved live at
  decision time. There is no second, locally stored declaration to drift out of sync.
- **FR-2:** A blocking dependency counts as satisfied when its issue is closed, regardless
  of close reason. (Closing a dependency — including as not-planned — is the operator's
  deliberate unblock.)
- **FR-3:** Work that has no originating issue is never dependency-blocked and flows exactly
  as it does today.

**Build dispatch (daemon)**

- **FR-4:** The daemon does not start building a spec while its originating issue has one or
  more open blocking issues; the spec is skipped for that cycle, not dropped.
- **FR-5:** Blocked specs are re-evaluated on every scan cycle; once every blocker is
  closed, the spec becomes eligible on the next cycle with no operator action.
- **FR-6:** Specs waiting on dependencies appear in a dedicated WAITING section of the
  daemon's startup dashboard and status output, each listing the open blocker(s) holding it.
  Every known spec appears in exactly one dashboard bucket — blocked work is never invisible.
- **FR-7:** If dependency state cannot be determined (tracking platform unreachable or the
  originating issue unresolvable), the spec is treated as blocked — not built — and is shown
  in the WAITING section with an "indeterminate" reason. Fail closed, visibly.

**Intake (engineer)**

- **FR-8:** Intake claiming returns the oldest pending idea whose originating issue has no
  open blockers. Blocked ideas remain pending — they are deferred, not dropped — and become
  claimable once their blockers close.
- **FR-9:** When ideas are pending but every one of them is blocked, a claim attempt reports
  that state distinctly from an empty queue, listing what each pending idea is waiting on.

**Migration**

- **FR-10:** A one-time migration scans the repository's existing open issues for prose
  dependency declarations (e.g. "Gated on #N", "Depends on #N", phased task-lists in
  umbrella issues), proposes the equivalent native "blocked by" relationships, and creates
  them after operator review. The v1.0 program's declared ordering (#217–#229 per #228) must
  come out fully linked.
- **FR-11:** The migration is idempotent and additive: re-running it never duplicates or
  removes existing relationships, and it never closes, edits, or relabels issues.

**Degenerate declarations**

- **FR-12:** If dependency relationships form a cycle, every work item in the cycle is
  surfaced to the operator as an error state (visible in the same waiting/blocked surfaces,
  identified as a cycle) rather than being built, claimed, or silently stuck.

## Non-Functional Requirements

- Dependency checks must not meaningfully slow scan cycles or exhaust the tracking
  platform's rate limits, even with many pending specs re-checked every cycle.
- Repeated identical "still blocked" notices must not spam logs or the originating issue —
  a block is announced once per state change, while remaining continuously visible in
  status surfaces.
- Dependency enforcement must degrade safely offline: no build proceeds on stale or missing
  dependency knowledge (see FR-7).

## Acceptance Criteria / Success Metrics

- With the v1.0 program's DAG expressed as native relationships: the daemon builds only
  Phase-1 items first; the cutover, release-sequence, and verification specs sit in WAITING
  with their blockers listed; each becomes eligible within one scan cycle of its last
  blocker closing; intake never hands the engineer a blocked program issue while its
  prerequisites are open.
- A spec with no originating issue builds exactly as before the feature existed.
- Killing connectivity to the tracking platform causes dependent specs to hold (visible,
  indeterminate) rather than build.
- The migration, run against the real repository, produces the #228 ordering as native
  links with zero duplicate or destructive edits on re-run.
- All FRs covered by passing tests; docs and changelog updated per harness convention.

## Scope

### In Scope
- Dependency gating of daemon build dispatch, with WAITING visibility in dashboard/status.
- Dependency-aware deferral in engineer intake claiming, with all-blocked reporting.
- One-time prose→native-relationship migration for this repository's open issues.
- Cycle detection and indeterminate-state (fail-closed) handling.

### Out of Scope
- Priority ordering among unblocked specs (#200).
- Dependencies between issues in different repositories (declarations, if present, that
  cross repositories are out of scope for enforcement in this iteration — see Open
  Questions).
- Retroactive gating of specs already built or in flight.
- Any change to build steps, gates, or what constitutes a buildable spec.

## Key Decisions & Rationale

- **Issue graph is the single source of truth, resolved live** — avoids a committed copy of
  the graph drifting from reality; the platform's own UI becomes the operator's editing
  surface. (Operator-confirmed in explore.)
- **Closed-for-any-reason unblocks** — matches the platform's own semantics; a wontfix'd
  prerequisite shouldn't require link surgery to release its dependents.
- **Defer blocked ideas at intake, not just at build** — authoring a spec before its
  prerequisites ship produces a spec describing a codebase that doesn't exist yet (a drift
  hazard this project has been burned by); deferral wastes no authoring effort.
- **Fail closed on indeterminate state** — a correctness gate that silently fails open is
  not a gate; visibility requirements (FR-6/FR-7) keep fail-closed from becoming
  fail-invisible.
- **Priority (#200) explicitly sequenced after** — the dependency gate *filters* the
  backlog; a future priority chooser *reorders* what survives. They compose cleanly.

## Dependencies

- GitHub's native issue-dependency ("blocked by") relationships — the pre-existing external
  platform capability this feature reads and (in migration) writes.
- Existing spec→issue provenance: intaken specs already record their originating issue;
  dependency resolution keys off that existing linkage.
- Existing daemon dashboard/status surfaces and the intake queue (extended, not replaced).

## Open Questions

- Which platform API surface for reading/writing "blocked by" relationships (availability
  on personal repos, rate limits, pagination) — for architecture-review to verify and pin.
- Whether/how dependency state is cached within or across scan cycles versus queried fresh
  per spec — freshness vs. rate-limit trade-off.
- Cross-repository blockers: reject at migration time, ignore with a warning, or enforce —
  needs a call once the platform's cross-repo relationship semantics are verified.
- Migration parsing confidence: which prose patterns are auto-proposed vs. flagged for
  manual review (umbrella task-list phase inference is heuristic).
- Behavior when an originating issue is deleted or transferred after landing.
