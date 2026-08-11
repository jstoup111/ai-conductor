# ADR: seal rotation permission is authorship, not base-identity

**Status: APPROVED**
**Date:** 2026-08-09
**Issue:** jstoup111/ai-conductor#1229
**Stem:** `manual-rebase-strands-protected-artifact-seal`
**Amends:** `adr-2026-07-26-protected-artifact-seal-rebaseline` (Decision item 2 only; that ADR
remains APPROVED and its items 1, 3, and 4 stand unchanged)

## Context

`adr-2026-07-26-protected-artifact-seal-rebaseline` established that a protected-artifact seal may
rotate only on **provable inheritance from the base branch**. That decision is correct and is not in
question here.

Its Decision item 2 encoded the permission gate as two byte-equality tests, for every protected path
whose fingerprint no longer matches:

- the workspace bytes equal the committed blob at HEAD, and
- that blob is byte-identical to the same path's blob at the base-branch tip — "i.e. the new content
  was **inherited from the base**, not authored by this feature."

The clause after "i.e." is the intent. The clause before it is the implementation. #1229 shows they
are not the same predicate.

Byte-identity with the base tip answers *"is HEAD level with base?"* Authorship asks *"did this
feature change this path?"* The two coincide only when the feature is fully up to date. A feature
that is merely **behind** base — the base branch added a protected artifact after the feature's
merge-base — fails byte-identity while having authored nothing.

Observed on `park-in-flight-features-at-step-boundaries-after-p` (2026-08-01). The feature's
merge-base was `d7b12f006`; main added `.docs/architecture/browsable-documentation-site.md` in the
immediately following commit `74ce83c06`. The feature HEAD did not contain the file, main did, and
the daemon logged:

```text
seal rebaseline refused .docs/architecture/browsable-documentation-site.md — head-differs-from-base (feature-authored:head-differs-from-base)
Protected artifact rotation refused: condition=feature-authored:head-differs-from-base
✋ halted — Feature-authored protected artifact change cannot rotate seal
```

Git history confirmed the feature never authored that file. Recovery required forensic inspection
plus an operator-approved manual reseal from `12429e75a` to `c7951c52f`, then clearing `HALT` and
`HALT.class`.

Two independent defects produced that halt:

1. **The refusal is misclassified.** `head-differs-from-base` never asks who authored the
   divergence, and `emitRotationRefusal` stamps every such refusal `feature-authored:` — the exact
   string daemon triage reads.
2. **The refusal escalates.** `inspectSeal` *passed*: the file is in neither the workspace nor the
   seal, so no add/change/delete branch fires. A refusal to perform an opportunistic *repair*
   converted a passing verification into a halt.

The authorship question is already answered correctly elsewhere in the same module.
`branchUntouchedInheritance` uses `git diff --name-only <baseRef>...HEAD -- <path>` — three-dot,
merge-base relative — and is already trusted on the inspection path.

## Decision

**1. Rotation permission asks authorship.** For each path where the sealed, workspace, HEAD, and
base-tip views disagree, after the existing `workspace-differs-from-head` check:

- If HEAD changed the path since the merge-base with the base branch, the divergence is
  **feature-authored**. Refuse, escalate, and halt — exactly as today.
- If HEAD did not change the path, the divergence is **base-ahead**: the base branch alone advanced
  it. This is not a violation. The path is excluded from the blocking set entirely and rotation
  proceeds, resealing at HEAD.

`base-ahead` is an *exclusion*, not a new refusal condition. The state cannot be constructed, so no
consumer can mishandle it, and the `feature-authored:` label on
`protected_artifact_rebaseline_refused` becomes accurate by construction rather than by convention.

**2. The probe fails closed.** An indeterminate provenance answer — no merge-base between HEAD and
the base branch, a failed `git diff`, or an unresolvable base ref — classifies the path as
feature-authored. Uncertainty never yields `base-ahead`.

**3. A rotation refusal does not escalate a passing inspection, except where it evidences tampering.**
`inspectSeal`'s verdict is authoritative. A refusal to rotate means "the seal stays where it is," not
"the workspace is compromised." Non-escalation therefore covers the environmental refusal classes
(`base-tip-unresolved`, `head-unresolvable`, `same-history-ancestor`) and, vacuously, `base-ahead`.

It deliberately does **not** cover `workspace-differs-from-head` or a provenance-confirmed
feature-authored refusal. Those keep escalating exactly as today. This extends the existing
`rotationRefusalPreservesInspection` mechanism rather than introducing a new one.

**4. Refusal telemetry carries its classifying evidence.** The existing
`protected_artifact_rebaseline_refused` variant gains the merge-base commit and whether HEAD touched
the path; the existing `protected_artifact_rebaseline` variant gains the paths classified
`base-ahead`. Additive fields on existing `ConductorEvent` variants — no new variant, no sibling
ledger, no sidecar file. Per this repository's event-spine principle, the spine already carries this
concern; only its payload was too thin for triage to classify.

## Alternatives considered

**Hook seal rotation into manual/direct rebase completion** (the filer's first hypothesis). Real as a
description — a manual rebase does bypass `performRebase`/`translateAfterRebase` — but wrong as a
location. A manual rebase happens in an operator's shell with no lifecycle hook to attach to, only
after-the-fact inference. More decisively, the same false halt occurs with **no rebase at all**
whenever a feature is behind base, so this would close one trigger and leave the class open. The
defensive rotation already exists to cover unhooked rewrites; it is the broken part. Rejected.

**Non-escalation alone**, leaving byte-identity as the rotation permission gate. Smallest possible
diff and it does stop the reported halt. Rejected: it leaves the `feature-authored:` mislabel in the
telemetry triage reads, and leaves seals stranded on stale baselines indefinitely, since a
behind-base feature would never rotate. Meets neither outcome (1) nor outcome (4).

**Blanket non-escalation** — any rotation refusal never fails a passing inspection. Simpler rule with
no classification to get wrong. Rejected: `workspace-differs-from-head` is a genuine uncommitted-edit
signal that `inspectSeal` cannot always reproduce, because `inspectSeal` compares the workspace
against the *seal* rather than against HEAD. A workspace edit that happens to restore sealed content
while HEAD holds different content would pass inspection and lose its only detector.

**Rotate whenever the baseline is a non-ancestor.** Already rejected by
`adr-2026-07-26-protected-artifact-seal-rebaseline` and rejected again for the same reason: an agent
that commits a tampered artifact and then rebases would have the tampering adopted as the new
baseline.

**Widen the base-inheritance tolerance in `inspectSeal` instead.** Wrong layer. `inspectSeal` already
handles this case correctly and passed during the incident. The defect is entirely in the rotation
verdict.

## Consequences

- One additional read-only `git diff --name-only` per *diverging* path. Diverging paths exist only
  once the ancestry check has already failed, so the common path — baseline is an ancestor of HEAD —
  adds nothing; it still short-circuits at `same-history-ancestor`.
- The tamper-detection boundary is unchanged for every case that halts today. A committed
  feature-authored edit is caught twice over: by `inspectSeal`'s fingerprint mismatch before rotation
  is consulted, and by the provenance-confirmed refusal. An uncommitted edit is caught by
  `workspace-differs-from-head`, which still escalates.
- Features already halted by this bug recover on their next resumed attempt with no operator
  intervention, no manual JSON edit, and no reseal.
- `conduct reseal` (#1281) remains necessary and complementary: it is the audited human decision for
  genuine violations. This change removes the class of halts that never needed a human.
- `.docs/decisions` is added to `translateAfterRebase`'s rotation path diff, so the `rebaselines[]`
  audit entry covers every protected directory. Pre-existing gap, load-bearing once triage reads the
  audit trail.
