# ADR: Owner-Gate Identity Resolution and Fail-Open Posture

**Date:** 2026-06-30
**Status:** APPROVED
**Deciders:** James Stoup (operator)

## Context

The autonomous spec-build daemon must answer "**who is this daemon building for?**" before it can
gate specs by owner. Constraints:

- The daemon is intended to run **headless in an isolated remote environment (EKS)**, not only on a
  trusted local machine — so identity cannot depend solely on ambient local `gh` auth.
- Behavior must stay **backward-compatible**: a daemon that cannot determine an owner must not
  silently halt all builds.
- The word **`owner` is already used in the daemon engine** — `daemon-lock.ts` calls the process
  holding the 1-per-repo pidfile lock the "owner" (`PidRecord owner`). A second, unrelated `owner`
  concept in the same engine invites confusion and accidental coupling (conflict-check finding).

## Options Considered

### Option A: gh-authed user only
- **Pros:** zero config.
- **Cons:** breaks headless/cron (gh may be absent); silently changes if gh re-auths; not
  deterministic. Wrong trust root for EKS.

### Option B: configured owner only
- **Pros:** deterministic, headless-safe.
- **Cons:** forces config on every existing solo setup before anything builds.

### Option C: ordered resolution config → gh → unresolved, behind a seam (chosen)
- **Pros:** deterministic when configured; zero-config still works via gh; an **unresolved** state
  is explicit and handled; the resolver is an interface, so a future EKS platform identity replaces
  the chain without touching the gate.
- **Cons:** three code paths to specify and test; the fail-open choice (below) has a security cost.

### Fail-open vs fail-closed when unresolved (sub-decision)
- **Fail-open** (build all + warn): preserves today's behavior; never halts builds on missing
  identity. Cost: a misconfigured headless daemon builds everything, including others' specs.
- **Fail-closed** (build nothing): safest against building others' work, but a single identity
  hiccup silently stops all work — a worse operational failure for the common case.

## Decision

Introduce an **`IdentityResolver` seam** with ordered resolution: **configured owner wins; else the
gh-authed login; else `unresolved`.** Configured always beats gh so behavior never changes silently
when gh re-auths. `unresolved` is **fail-open** — the gate is inactive, every content-eligible spec
builds exactly as today, and a single **warn-once** "gate inactive" line is emitted per pass.

Fail-open is chosen because the immediate goal is "don't *accidentally* build a collaborator's
work," not "defend against an adversary," and halting all builds on a transient identity failure is
a worse operational outcome than the current (already-shipped) behavior. In the EKS deployment the
recommended posture is an **explicit configured owner** (or, later, a platform identity), which
makes the gate active and deterministic; fail-open is the safety net for the un-configured case,
not the intended steady state.

**Vocabulary:** the new concept is the **operator / spec owner**. It MUST be named distinctly in
code (e.g. `specOwner` / `ownerIdentity` / `operatorId`) and MUST NOT be named bare `owner` in the
neighborhood of `daemon-lock.ts`, whose `owner` means the lock-holding process. The lock's `owner`
is left unchanged (renaming stable lock code carries risk for no functional gain).

## Consequences

### Positive
- Backward-compatible: un-configured daemons behave exactly as today (plus one warning).
- Deterministic and headless-safe when an owner is configured — the EKS-ready posture.
- Forward-compatible: a `PlatformIdentity` (OIDC) implementation of `IdentityResolver` can become
  the trust root later without changing the gate's build/skip behavior.
- No naming collision with the lock's `owner`.

### Negative
- Fail-open means a misconfigured **headless** daemon silently builds everything, including others'
  specs. Mitigated by the warn-once line and by documenting "configure an explicit owner in EKS."
  Revisit as fail-closed only once platform identity is the norm (tracked as a PRD Open Question).
- Three resolution paths increase test surface (covered by stories FR-1/FR-2/FR-3).

### Follow-up Actions
- [ ] Implement `IdentityResolver` as an interface with `ConfiguredOwner` + `GhLoginOwner`.
- [ ] Emit exactly one warn-once "gate inactive" line when unresolved.
- [ ] Enforce the naming boundary in review — no bare `owner` for the operator concept.
- [ ] Leave a documented seam for a future `PlatformIdentity` (EKS OIDC) implementation.
