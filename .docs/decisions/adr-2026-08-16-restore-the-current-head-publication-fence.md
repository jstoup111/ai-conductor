---
status: APPROVED
date: 2026-08-16
conforms-to: adr-2026-07-26-rebase-tail-current-branch-before-publication (decisions 3-5)
deciders: James Stoup
approved: 2026-08-16
issues: "jstoup111/ai-conductor#1613"
---

# ADR: Restore the current-HEAD publication fence on the coordinator path

## Context

Issue jstoup111/ai-conductor#1613. FINISH halts an otherwise-shippable feature with:

    ✋ loop halted: FINISH evidence-invalid disposition requires its dedicated BUILD routing rule:
      ship_evidence_invalid

Observed twice:

| # | Date | Feature | What went stale |
|---|---|---|---|
| 1 | 2026-08-15 23:49 | `rubric-cache-identity` | `manual_test` evidence predated 8 review-lap fix commits |
| 2 | 2026-08-16 16:24, 16:33 | `remediation-repairs-are-blind-to-the-plan-contract` | ship-tail `rebase` (onto #1633) + `maintain_documentation` commits changed the tree after `test_suite` stamped its fingerprint |

**This is not a missing feature. It is a regression against an APPROVED decision, and one commit
caused it.**

`adr-2026-07-26-rebase-tail-current-branch-before-publication` — **APPROVED, operator-approved
2026-07-26** — already mandates the mechanism that prevents both occurrences:

> 3. Immediately before any `finish` dispatch or publication side effect, the engine resolves
>    validation membership with the existing tier, track, upstream-skip, bootstrap-mode, and
>    configuration predicates. Validly skipped members are excluded.
> 4. For every applicable member, the fence requires both a `done` state and a freshly recomputed,
>    satisfied objective verdict at the current HEAD. `manual_test` must additionally contain no
>    FAIL rows. **A `failed`, `stale`, pending, or objectively incomplete member is non-green even
>    when an older artifact remains on disk.**
> 5. When the fence is non-green, finish is not marked `in_progress` and is not dispatched. The
>    engine writes the fresh gate verdicts, marks only the non-green applicable members `stale`,
>    emits one observable `kickback` from `finish` to the earliest such member, and redirects
>    there. If several members need work, the existing validation group reruns them concurrently;
>    green siblings remain complete.

That fence exists in the code as `nonGreenFinishValidators` (`conductor.ts:1602-1640`). It is
**disabled in production**:

```ts
if (this.finishPublication || (!this.verifyArtifacts && !this.daemon)) return [];
```

`this.finishPublication` is the production publication coordinator, installed on every real path
(`index.ts:1338`, `daemon-cli.ts:1023`). The method's own comment justifies only the second
disjunct — the mocked-dispatch unit-test mode. The `this.finishPublication ||` clause carries no
recorded rationale.

**Both halves came from the same commit.** `git log -L` on the two lines resolves to
`9a6005e6104c8dc0ce6a61206f021e2bb01b7138` (2026-08-04, "feat:
unattended-finish-spends-minutes-before-determinis", #1295), which in one change:

- added `this.finishPublication ||`, removing the **prevention**; and
- added the `'FINISH evidence-invalid disposition requires its dedicated BUILD routing rule: '`
  placeholder halt (`finish-publication.ts:657-670`), leaving the **cure** unwritten.

With the fence gone, FINISH dispatches over a stale validator; its own observer then reads that
validator as absent, because `observeShipEvidence` (`finish-publication-production.ts:261-264`)
uses `stepDone` (`state.ts:192-198`, `done | skipped`) while the walk uses `stepSatisfied`
(`state.ts:200-205`, `done | skipped | stale`); preflight maps the result to
`ship_evidence_invalid`; and the router has only the placeholder. The halt is written
`needs-human` (`conductor.ts:6313-6322`), which `daemon-rekick.ts:178-194` refuses to re-kick.

## Decision

### D1 — Restore the fence for the coordinator path

Remove the `this.finishPublication ||` disjunct so the current-HEAD fence runs before every
`finish` dispatch and publication side effect, as decisions 3-5 of the governing ADR require. The
mocked-dispatch exemption (`!this.verifyArtifacts && !this.daemon`) is preserved unchanged — it is
the only clause the code documents and the only one with a stated reason.

Restoring it makes both observed occurrences unreachable rather than recoverable: a `stale`
`manual_test`, and evidence invalidated by ship-tail commits, are both exactly what decision 4
calls non-green, and decision 5 already specifies the response — write the fresh verdicts, mark
only the non-green members `stale`, emit one `kickback` from `finish` to the earliest such member,
and redirect there.

### D2 — The redirect target is the earliest non-green validator, not BUILD

The governing ADR's decision 5 routes to the earliest non-green member. This ADR does **not** add a
FINISH→BUILD route for invalid SHIP evidence, and deliberately declines to implement
`adr-2026-08-01-engine-owned-resumable-finish-publication` D5's "route to BUILD with that evidence"
for the SHIP half. Two APPROVED decisions forbid it here:

- `adr-2026-07-13-kickback-build-no-op-escalation`: *"If build is **already satisfied** … the
  engine must not route into a guaranteed no-op. Return a HALT outcome … never re-kick."* A stale
  SHIP validator over a complete BUILD is precisely that shape.
- `adr-2026-07-26` decision 5 names the correct target, and it is a SHIP-tail redirect rather than
  a BUILD kickback.

The two ADRs are complementary once the fence is live: `adr-2026-08-01` D5 governs what FINISH's
observer does when it *reaches* invalid evidence; `adr-2026-07-26` prevents FINISH from being
dispatched over it in the first place. Restoring the prevention is the smaller and better-grounded
change, and it leaves D5's disposition semantics untouched.

### D3 — The fence recomputes verdicts; it does not force-invalidate them

`nonGreenFinishValidators` already calls `computeAndWriteVerdict` per member and marks only the
non-green ones `stale`. That is the behavior
`adr-2026-07-22-gate-evidence-code-validity-on-redispatch` and
`adr-2026-07-20-post-rebase-delta-aware-invalidation` require — a verdict is preserved when the
gate's surface is unchanged and re-derived when it is not. No unconditional `satisfied: false`
write is introduced, and no evidence artifact is deleted, so
`adr-2026-07-25-content-addressed-full-suite-proof`'s content-addressed reuse identity keeps its
meaning: an unchanged fingerprint legitimately stays green.

This also removes the oscillation hazard. A tail lap that changes only documentation leaves every
validator's surface untouched, so the recomputed verdicts stay satisfied and the fence passes —
rather than re-staling validators every lap.

### D4 — The placeholder halt is retired and the condition routing made total

With the fence restored, the evidence-invalid conditions stop being the routine outcome, but the
router must still not claim a routing rule is missing. Replace the four-code `if`
(`finish-publication.ts:657-670`) with a mapping total over `PublicationCondition['code']`, so a
condition added later without a declared route is a compile error, and give the evidence conditions
a halt reason describing the unreadable or unresolved observation instead of the placeholder text.
The five FINISH-local conditions keep `retry_finish` unchanged.

### D5 — Bounding is inherited, not invented

No new counter, allowance, or cap is introduced. The fence's redirect is an ordinary `kickback`
from `finish`, already bounded by `MAX_KICKBACKS_PER_GATE` through the durable ledger
(`adr-2026-07-26-cross-dispatch-kickback-livelock-bound`), and exhaustion already halts
`needs-human` naming the gate and lap count. Because D3 preserves verdicts whose surface is
unchanged, a converging tail stops re-triggering the fence on its own rather than relying on the
cap.

## Consequences

- Both observed occurrences of ai-conductor#1613 become unreachable; the feature ships unattended.
- The engine returns to conformance with an APPROVED decision it has violated since 2026-08-04.
- FINISH may now be redirected before dispatch on runs that previously dispatched it, which is the
  governing ADR's intent and the point of the fence.
- `adr-2026-08-01` D5's SHIP clause remains unimplemented by design; D2 records why, so a future
  reader does not "fix" it back into a BUILD route.
- Out of scope, deliberately: unifying `stepDone` with `stepSatisfied`
  (jstoup111/ai-conductor#1587), the publication advance fixed-point guard
  (jstoup111/ai-conductor#1487), and `findResumeIndex`'s last-done-wins entry rule.

## Assumptions surfaced (per `/verify-claims`)

| Assumption | Confidence | Basis | Impact if wrong |
|---|---|---|---|
| `adr-2026-07-26` is APPROVED and its decisions 3-5 govern this seam | 99% | verified — read the status line and decisions verbatim | The conformance framing collapses and a new decision would be needed |
| The fence is disabled on every production path | 97% | verified — read `conductor.ts:1609` and both coordinator installation sites | If some production path still runs it, the fix narrows but does not change direction |
| One commit caused both halves | 95% | verified — `git log -L` on both lines resolves to `9a6005e61` | Only the narrative changes; the fix is unaffected |
| Restoring the fence does not break the coordinator | 70% | inferred — the disjunct carries no recorded rationale, but #1295 added it deliberately and its reason may be unrecorded rather than absent | The plan's first task discharges this before any other task depends on it; if a real incompatibility exists, it is a genuine design fork and must halt for the operator rather than be worked around |

The last row is the one load-bearing unknown. It is discharged by plan Task 1, and it is the only
condition under which this decision would need revisiting.
