# PRD: Daemon Owner-Gating for Autonomous Spec Builds

**Date:** 2026-06-30
**Status:** Draft

## Problem / Background

The autonomous spec-build daemon discovers work by scanning specs that have been **merged onto
the base branch** and builds every one that passes its content-eligibility checks (plan present,
stories accepted, dependency graph present, not already processed). It has **no notion of who
authored or owns a spec** — a merged spec is a merged spec.

This was fine while every spec in a watched repo came from a single operator. It breaks down the
moment a **collaborator** contributes to a daemon-watched repo: once their spec PR is merged, the
operator's daemon will pick it up and build it autonomously, even though the operator never
sanctioned that work and may not want it built on their machine, under their identity, consuming
their build budget.

The operator needs the daemon to build **only specs that are theirs**, and to leave a
collaborator's specs for the collaborator's own daemon. This matters now because at least one
repo has moved from single-operator to multi-contributor, and the daemon currently has no way to
tell the two apart.

## Goals & Non-Goals

**Goals**
- The daemon builds a merged spec **only when that spec is owned by the daemon's operator**.
- A spec owned by someone else is **not built**, and the operator can **see** that it was passed
  over (visible log line), not silently dropped.
- Two operators sharing one repo can each run a daemon that builds **only their own** specs, with
  no coordination beyond each configuring their own identity.
- Work already merged before this feature activates **keeps building** with no manual
  intervention (no flag day for in-flight work).

**Non-Goals**
- **Forgery resistance.** Ownership is a cooperative coordination signal, not an authentication
  mechanism. A contributor who records the operator's identity onto their own spec will still be
  built. Defending against a deliberately impersonated owner is out of scope.
- **Changing the GitHub-issue intake queue.** Issue intake already filters to the operator
  (assignee-based) and is a separate surface; this feature does not touch it.
- **Team / shared ownership.** Each daemon builds for exactly one owner identity. Group ownership,
  multiple owners per daemon, or rotating ownership are out of scope.
- **Gating non-autonomous builds.** Manual or interactive builds the operator runs directly are
  unaffected — this gate applies only to the daemon's autonomous discovery.

## Users / Personas

- **The operator** — runs a daemon against one or more repos and wants it to act only on work
  that is theirs, especially in a repo they now share with others.
- **The collaborator** — contributes specs to a shared repo and runs (or will run) their own
  daemon; they expect their specs to be built by *their* daemon, not the operator's.

## Functional Requirements

- **FR-1:** The operator can declare a single **owner identity** that a daemon builds for.
- **FR-2:** If no owner identity is explicitly configured, the daemon resolves its owner from the
  **authenticated GitHub user** at runtime (gh fallback).
- **FR-3:** If the owner cannot be resolved by either means (no configured identity and no
  available GitHub authentication), the daemon **preserves today's behavior** — it builds all
  content-eligible specs — and emits a warning that owner-gating is inactive.
- **FR-4:** When a spec is authored through the engineer flow, the resulting spec **records the
  author's owner identity** as part of its committed artifacts, so ownership travels with the spec
  on the base branch independent of who later merges it.
- **FR-5:** When evaluating a merged, content-eligible spec for autonomous build, the daemon
  **compares the spec's recorded owner to its own resolved owner**.
- **FR-6:** A spec whose recorded owner **matches** the daemon's owner is eligible to build
  (subject to all existing content-eligibility filters).
- **FR-7:** A spec whose recorded owner is a **different identity** is **not built**; the daemon
  emits a visible log line naming the spec and the other owner.
- **FR-8:** A spec with **no recorded owner** that was merged **on or after** the configured
  activation point is **not built** (strict gate); the daemon emits a visible skip log line.
- **FR-9:** A spec with **no recorded owner** that was merged **before** the configured activation
  point is treated as **owned by the operator** and is eligible to build (grandfather clause).
- **FR-10:** The **activation point** (the cutover before which un-owned specs are grandfathered)
  is operator-configurable.
- **FR-11:** Owner-gating skips are surfaced in the daemon log **distinctly** from existing
  content-eligibility skips, so "skipped: not yours" is distinguishable from "skipped: stories not
  accepted."
- **FR-12:** Owner comparison **tolerates trivial formatting differences** (case, surrounding
  whitespace) so an operator is never falsely locked out of their own spec by a cosmetic mismatch.

## Non-Functional Requirements

- **Backward compatibility:** A pre-existing solo setup needs zero manual action — pre-cutover
  specs are grandfathered (FR-9) and the operator's own newly-authored specs carry their identity
  (FR-4), so they continue to build.
- **Determinism:** With an explicitly configured owner, owner resolution is **stable across
  headless and cron runs** (it does not depend on ambient GitHub auth).
- **Observability:** **Every** gating decision (build / skip-other-owner / skip-unowned /
  gate-inactive) is visible in the daemon log.

## Acceptance Criteria / Success Metrics

- A collaborator's spec (recorded with the collaborator's identity), merged after the cutover, is
  **not** built by the operator's daemon and is logged as skipped with the other owner named.
- The operator's own spec (recorded with the operator's identity), merged after the cutover, **is**
  built.
- An un-owned spec merged **before** the cutover **still builds** (grandfather).
- An un-owned spec merged **after** the cutover is **skipped** and logged.
- With no owner resolvable, daemon behavior is **identical to today** (all content-eligible specs
  build) plus a one-line "gate inactive" warning.
- All FRs covered by passing tests, including the negative paths (FR-3, FR-7, FR-8, FR-12).

## Scope

### In Scope
- Owner identity for a daemon (configured, with gh fallback).
- Recording an owner onto specs authored via the engineer flow.
- The gating decision inside the daemon's autonomous spec discovery, with grandfather cutover.
- Distinct, visible logging of every gating outcome.

### Out of Scope
- The GitHub-issue intake queue (already operator-filtered).
- Any anti-forgery / cryptographic ownership.
- Team / multi-owner ownership.
- Gating manual or interactive builds.
- Retroactively stamping (backfilling) historical specs — the grandfather cutover replaces the
  need for a backfill.

## Key Decisions & Rationale

- **Skip + log, not silent skip.** The operator wants visibility into what their daemon declined
  to build, on the assumption the collaborator's own daemon will build it. Silent dropping hides
  coordination failures.
- **Strict gate for un-owned specs (post-cutover).** "No proven owner" is treated as "not yours."
  This is the safe default against a collaborator's un-stamped merge; the grandfather clause keeps
  it from disrupting work merged before the feature existed.
- **Explicit configured owner with gh fallback.** A configured owner is deterministic and survives
  headless runs; the gh fallback keeps zero-config setups working without an extra step. Configured
  always wins so behavior never silently changes when gh re-auths.
- **Grandfather a cutover, not a backfill.** Avoids a migration that rewrites historical specs;
  pre-cutover work is trusted as the operator's by construction, since before this feature there
  was only one operator.
- **Coordination, not authentication.** The owner signal is committed text the contributor writes
  honestly. This matches the actual threat ("don't accidentally build their real work"), not an
  adversarial one, and keeps the design small.

## Dependencies

- The **engineer authoring flow**, which must record the owner identity onto each spec it creates.
- The **daemon's autonomous discovery path**, where the gating decision is inserted.
- The **daemon configuration surface**, which must carry the owner identity and the activation
  point.

## Open Questions

- **How is a spec's "merge time" determined** for the grandfather comparison (FR-8/FR-9) from the
  committed state the daemon reads? (Resolution belongs to architecture-review — e.g. spec
  introduction time from history vs. a recorded timestamp.)
- **Unresolvable-owner default (FR-3):** is "warn and build everything (today's behavior)" the
  right fail-open, or should an unresolvable owner fail *closed* (build nothing) in a headless
  context? Current PRD assumes fail-open for backward compatibility — confirm acceptable.
- **Where the owner is recorded** on a spec (reuse the existing per-spec intake marker vs. a
  dedicated field/artifact) is an implementation detail deferred to architecture-review.
