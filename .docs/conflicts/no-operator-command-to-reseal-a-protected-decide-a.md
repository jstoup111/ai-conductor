# Conflict Check: Operator-audited reseal of a protected DECIDE artifact (#1281)

**Date:** 2026-08-09
**Stories checked:** `.docs/stories/no-operator-command-to-reseal-a-protected-decide-a.md`
(Stories 1-8, `Status: Accepted`)
**Corpus checked:** all `.docs/stories/`, the five APPROVED seal-related ADRs, prior
`.docs/conflicts/` reports on the seal, and the open `spec/*` branches surfaced by the
architecture review's overlap scan.
**Result:** **PASSED — zero blocking conflicts.** One degrading conflict accepted; one story
amended for an unstated interaction.

---

## Scope of the pairwise scan

All 28 internal story pairs (8 choose 2) were considered; the 9 pairs sharing a behavior, entity,
field, or gate were tested in **both** directions per the oscillation heuristic — "if A is fully
satisfied, does B still hold?", then the reverse. Pairs sharing no surface (e.g. Story 4's argument
parsing vs Story 7's halt markers) are recorded as trivially independent rather than silently
skipped.

| Pair | Shared surface | A⇒B holds | B⇒A holds | Verdict |
|---|---|---|---|---|
| 1 ↔ 2 | the seal file writer | yes | yes | clean — one writer, two heads; neither constrains the other's head |
| 1 ↔ 6 | observer notification | yes | yes | clean — the reseal event is an added union member, not a replacement |
| 2 ↔ 3 | which entries change | yes | yes | clean — 3 gates 2; a refusal means 2 never runs |
| 2 ↔ 8 | seal tolerance | yes | yes | clean — 2 narrows to named paths, 8 asserts everything else still halts |
| 3 ↔ 7 | success/refusal branching | yes | yes | clean — 7's negative path explicitly requires no halt clearing on refusal |
| 3 ↔ 8 | violation detection | yes | yes | clean — mutually reinforcing; both defer to one classification routine |
| 5 ↔ 7 | who may invoke | yes | yes | clean — clearing is downstream of the interactivity gate |
| 5 ↔ 6 | refusal side effects | yes | yes | clean — 6 requires refusals to be audited, including 5's |
| 2 ↔ 1 (rotation) | `baselineCommit` | yes | yes | clean — see "Examined and cleared" #1 |

Remaining 19 pairs share no behavior, entity, field, or gate.

---

## Examined and cleared

### 1. `baselineCommit` advance (Story 2) vs automatic rotation (Story 1) — not an oscillation

The candidate oscillation: a reseal advances `baselineCommit`, and automatic rotation also rewrites
it. Tested both directions against `adr-2026-07-26-protected-artifact-seal-rebaseline` §1, which
makes non-ancestry the rotation trigger:

- **Reseal ⇒ rotation still holds.** After a reseal, `baselineCommit` is a commit on the current
  history, so `merge-base --is-ancestor` remains true and rotation stays correctly un-triggered.
- **Rotation ⇒ reseal still holds.** After a rebase makes the baseline a non-ancestor, rotation
  recomputes every fingerprint from the new HEAD, correctly superseding the scoped state; a
  subsequent reseal starts from that seal and behaves identically.

Neither satisfies-then-breaks the other. Confidence 90% (verified against the ADR text and the
rotation predicate at `protected-artifact-seal.ts:292`).

### 2. `adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts` — complementary, not contradictory

That ADR states: *"Nothing for the seal to detect, nothing to rotate, no reseal command needed —
which is why this does not depend on #1281."*

Read closely, this is a **scope disclaimer, not a prohibition**. It covers amendments made *during
DECIDE*, which land inside the baseline before the seal is created at first BUILD entry. #1281
covers the disjoint case: an artifact already sealed, discovered mid-BUILD to need correction, with
the feature already halted. The two do not overlap and neither forbids the other. Confidence 90%.

### 3. `spec/protected-artifact-seal-cannot-distinguish-legitim` — not live contention

The overlap scan flagged this branch as touching the same `inspectSeal` classification surface that
Story 3 must reuse. Verified: it is the spec branch for **#1047, already shipped** — its ADR
(`adr-2026-07-27-...-self-amendment-visibility`) is APPROVED on main and
`.docs/shipped/2026-07-27-protected-artifact-seal-self-amendment-1047.md` records the ship. The
branch is a stale leftover, not pending work. Its *shipped* semantics are accounted for in the
amendment below. Confidence 95% (verified via `git show --stat` and the shipped record).

### 4. #1229 and #1254 — additive

#1229 wants automatic rotation on post-rebase drift and can consume the shared writer Story 1
extracts without changing its contract; a second caller of a shared writer is not contention.
#1254 removes the most common *trigger* for this recovery while leaving the recovery itself
untouched. Neither asserts anything Stories 1-8 contradict. Confidence 80% (inferred from issue
intent; neither has landed artifacts to read).

### 5. The remaining seal ADRs

`adr-2026-08-05-provenance-based-protected-artifact-inheritance` and
`adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts` govern how *inheritance* is
classified and how *commits* are gated. Story 3 reuses the former by construction rather than
competing with it, and Story 8 requires the latter's behavior to remain unchanged. No contradiction.

---

## Degrading conflict (accepted)

## Conflict: Reseal must not become the remedy for own-feature self-amendment

**Stories involved:** Story 3 (unlisted-drift guard) and Story 5 (operator-only) vs
`adr-2026-07-27-protected-artifact-seal-self-amendment-visibility` (APPROVED)
**Files:** `.docs/stories/no-operator-command-to-reseal-a-protected-decide-a.md` vs
`.docs/decisions/adr-2026-07-27-protected-artifact-seal-self-amendment-visibility.md`
**Type:** state-conflict
**Severity:** degrading

**Description:**
That ADR explicitly *rejected* the option "require an explicit re-seal / re-approval step", on the
ground that it "reintroduces a blocking checkpoint into an autonomous daemon loop — which is
precisely the stall #1047 was filed to end." Under it, an own-feature self-amendment is **tolerated
and judged by `build_review`**, and must not halt at all.

A reseal command creates a standing risk that operators come to treat reseal as the remedy for
self-amendment, pulling a human checkpoint back into a loop that ADR deliberately kept autonomous.
This is a usage-drift hazard, not a logical contradiction: nothing in Stories 1-8 requires reseal on
self-amendment, and a self-amendment never halts, so reseal is never reached by that path.

Notably, **Story 5 is what keeps this feature compliant**. Because reseal is mechanically
unreachable from inside a step, it cannot become a loop checkpoint even if someone wanted it to be
one. The operator-only enforcement is therefore not merely a security control — it is the guarantee
that this feature preserves the prior ADR's liveness property.

**Resolution Options:**
1. Accept, and record the boundary — reseal is for artifacts already sealed and already halted;
   self-amendment remains `build_review`'s business.
2. Add a story requiring reseal to detect and refuse a self-amendment-only case.
3. Supersede the 2026-07-27 ADR to fold self-amendment recovery into reseal.

**Recommendation: Option 1.** Option 2 adds a gate for a state reseal cannot reach (a self-amendment
does not halt, so nothing routes an operator to reseal). Option 3 would re-break the liveness half
of #1047 for no gain. The boundary is documented instead, in the runbook text Condition 5 already
requires.

**Selected:** Option 1 — accepted as a degrading conflict.

---

## Story amendment applied

Story 3's happy path enumerated only the base-inherited tolerance, leaving the **self-amendment**
case unstated. Since Story 3's Done When requires reusing the existing classification routine, and
that routine (per the 2026-07-27 ADR) returns tolerated self-amendments on a *success* verdict, an
implementer following Story 3 literally would have had to guess whether an unnamed self-amended path
refuses or proceeds. The correct answer is that it proceeds and its sealed entry is left untouched —
nothing is laundered, because the entry is not rewritten.

An additive amendment note was written beside the original assertion in Story 3 per the
accepted-artifact amendment convention. The original text is preserved.

---

## Recurring patterns

No prior report in `.docs/conflicts/` records a conflict of this shape. Four prior reports touch the
seal (`build-tasks-can-amend-protected-docs-artifacts-ame`,
`2026-07-26-rebased-features-stale-protected-artifact-seal-976`,
`build-halts-when-a-branch-inherits-an-older-revisi`,
`2026-08-07-codex-lacks-preventive-hook-parity-protected-artif`); all concern *detection*
semantics, none concern an operator mutation path. No recurrence.

---

## Verdict

**PASSED.** Zero blocking conflicts. One degrading conflict accepted (Option 1). One story amended.
No ADR superseded. Proceed to `/plan`.
