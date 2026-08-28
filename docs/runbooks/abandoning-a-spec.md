---
title: Abandoning a spec
parent: Runbooks
nav_order: 7
---

# Abandoning a spec

Remove a DECIDE artifact that the operator has decided will not be delivered. For operators who
need to take a no-longer-wanted spec out of daemon discovery without losing the decision trail.

> **Not sure this is the right runbook?** A blocked spec that is still wanted is not abandoned.
> Repair its DECIDE artifact and let it proceed; use [stalled or stuck feature](stalled-or-stuck-feature.md)
> to diagnose the block.

## When to use this runbook

Use this procedure only after the operator decides that the described work will **not** be done.
The decision is intentional abandonment, not a temporary pause, an implementation failure, or an
unclear requirement.

**Shipped work is never abandoned.** If implementation already shipped, record or repair its
shipment through [shipped record reconciliation](shipped-record-reconciliation.md). A shipped
record is the durable delivery fact; deleting the DECIDE artifacts would not undo that delivery.

## Procedure

The order is deliberate: **record and close the issue first, then delete the artifacts.** Do not
delete a plan before there is a closed issue that preserves why it was removed.

### 1. Record the decision in GitHub

Find the existing GitHub issue for the work. If none exists, create one before changing the
repository. Record all of the following in the issue:

- The operator's decision to abandon the spec.
- The rationale for that decision.
- Delivery evidence, if any work was delivered, or abandonment evidence explaining why no delivery
  will occur.
- The DECIDE artifact paths that will be removed.

Close the issue after recording that evidence. The closed issue is the durable tracker record;
the repository commit carries out the resulting cleanup.

### 2. Delete the DECIDE artifacts in one commit

After the issue is closed, remove the spec's DECIDE artifacts from the repository in one commit.
Name each path explicitly; do not use a recursive or globbed deletion. Include the issue number in
the commit message, for example:

```text
docs: abandon <slug> (#1234)
```

The commit must remove the plan and its associated DECIDE artifacts together, so the repository
does not retain an orphaned plan, story, or other decision record that still advertises work the
operator has rejected.

### 3. Verify the spec no longer surfaces

Confirm the deletion commit contains exactly the intended DECIDE-artifact removals and references
the closed issue. On the next daemon discovery scan, the spec must no longer be eligible.

## Why deletion stops discovery

Daemon backlog discovery lists `.docs/plans` **non-recursively**. It treats a plan still present in
that directory as work still wanted; it does not infer abandonment from a halt, a park marker, or
an inactive branch. Deleting the plan therefore removes it from the next scan while keeping the
rationale and delivery-or-abandonment evidence in the closed GitHub issue.

Do not create a nested archival directory under `.docs/plans` as an abandonment workaround. It is
outside the non-recursive discovery set, but it leaves a second, misleading backlog convention in
the repository. The issue is the abandonment record; the plan directory is the active backlog.

## Counter-case: blocked but still wanted

If the operator still wants the work, it is **not** abandoned even when daemon discovery or a
DECIDE gate is blocked. Fix the invalid, incomplete, or stale DECIDE artifact instead, then verify
that discovery admits the repaired spec. Do not close the issue as abandoned or delete the plan to
work around a block.

## Verification

- The GitHub issue is closed and records the decision, rationale, and delivery-or-abandonment
  evidence.
- The issue was created or updated before any DECIDE artifact was deleted.
- One commit removes the intended DECIDE artifacts and references the closed issue.
- `.docs/plans/<slug>.md` no longer exists, and the next discovery scan does not list the slug.
