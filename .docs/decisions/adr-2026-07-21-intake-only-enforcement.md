# ADR: Enforce intake criteria at capture/file time only — never downstream

**Status:** APPROVED
**Date:** 2026-07-21
**Issue:** #695 · **Stem:** `intake-only-enforcement`
**Supersedes:** the enforcement-location decision embedded in PR #696 (`intake-criteria-enforcement`)

## Context

Issue #695: 100 of 107 open issues have no `size:` label, 3 have no `priority:`
label, and dependency-linking is only set when hand-added. The `/intake` skill
already *prescribes* these in prose (§7 GATE, §8 File), but prose discipline drifts
— exactly the failure CLAUDE.md's "deterministic where possible" principle warns
against.

Two designs were on the table for *where* completeness is enforced:

- **(A) Claim-time gate** (PR #696): `claimUnblocked` defers any Envelope whose
  issue lacks a `priority:`/`size:` label via a new `needs-criteria` outcome, and
  `poll()` stamps an `intake:needs-triage` flag. The backfill HALTs / requires
  per-issue operator confirmation.
- **(B) Capture-time stamp** (this ADR): every capture surface (issue form + a
  label-sync Action, the `/intake` filing helper, and a one-shot backfill) applies
  `priority:` + `size:` + linking at the moment the issue is filed. Nothing
  downstream re-checks them.

## Operator directive (binding)

> **"No failures — enforce requirements at intake ONLY."** The requirements are
> satisfied at intake capture time so every entry is born complete. **NO new
> downstream failure modes** — no pipeline gates, HALTs, build/dispatch rejections,
> or CI failures for missing priority/size/links. Sensible defaults where inference
> fails — never a downstream error.

## Decision

Adopt **(B)**. Enforce at capture/file time only; reject the claim-time gate.

- Completeness is stamped at every intake surface; issues are **born complete**.
- `claimUnblocked` and its `ClaimOutcome` union remain **byte-identical to `main`**
  — no `needs-criteria` variant, no criteria deferral.
- `poll()` gains **no** blocking flag and never withholds enqueue.
- The daemon build/dispatch, pipeline gates, and `ci.yml` add **zero** criteria
  checks.
- Where a field is absent/unparsable, apply a deterministic **default**
  (`size: M`, `priority: medium`) — never an error.
- The ~100-issue backlog is made complete by a one-shot backfill that stamps
  labels directly (infer ▸ default) and **reports** for later operator adjustment;
  it does **not** HALT or require per-issue confirmation.

## Rationale

- **Directive compliance:** (A) introduces a new `needs-criteria` dispatch stall —
  a downstream failure mode the directive forbids. (B) has none by construction.
- **Fail at the point of violation (CLAUDE.md):** for "issue lacks a size label,"
  the point of violation is *filing*, not *dispatch*. Stamping at filing fixes it
  where it happens; a claim-time gate reports it minutes-to-days later, detached
  from the fix, and (per #681-class history) any new deferral state is a new place
  the loop can wedge.
- **Determinism:** the issue-form + label-sync Action is machine-enforced for the
  web/mobile/phone path that produced most of the 100 unsized issues — no reliance
  on prompt discipline.
- **No judgment lost:** defaults are visible labels the operator can re-band any
  time; the backfill report surfaces every defaulted issue. This trades #696's
  hard confirmation gate for a soft, always-adjustable default — which the
  directive explicitly favors ("sensible defaults … never a downstream error").

## Consequences

- **Positive:** no new stall/HALT/CI failure class; the backlog self-heals in one
  pass; enforcement is deterministic on the dominant capture path.
- **Trade-off:** an auto-defaulted `size: M` may misestimate until an operator
  adjusts it. Accepted: a wrong-but-present default is strictly better than a
  missing label that (under #696) would have stalled dispatch. The backfill report
  and the form's required fields keep the default rate low going forward.
- **Linking:** captured as an explicit at-intake decision (a `Depends on` field /
  `--depends-on` arg, or an explicit "no dependencies" acknowledgement), not
  derived from a downstream blocker verdict. "No dependencies" and "not yet
  triaged" are disambiguated at filing, not at claim.

## Alternatives rejected

- **(A) claim-time gate** — forbidden by the directive (new downstream stall).
- **Prose-only tightening of `/intake`** — drifts (the very cause of #695).
- **Backfill HALT/confirmation** (#696) — a downstream failure for the operator to
  clear on ~100 issues; replaced by default-and-report.
