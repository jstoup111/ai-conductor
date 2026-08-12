# ADR: the Tautology rubric exempts removal maintenance, anchored to engine-computed removal evidence

**Date:** 2026-08-12
**Status:** APPROVED
**Deciders:** Engineer (DECIDE phase, #1521), operator-confirmed
**Relates to:** `adr-2026-08-09-recorded-red-exception-for-remediation.md` (the precedent this copies
— an exception is valid only when it is recorded, attributable, and observable),
`adr-2026-07-07-build-review-judgement-gate.md` (the rubric being narrowed),
`adr-2026-07-23-build-review-fresh-base-disposition.md` (the existing rebase-repair exception, the
structural model for a second one),
`adr-2026-08-12-cumulative-build-review-convergence-bound.md` (the other half of #1521)
**Supersedes:** nothing. **Does not change:** the Scope, Root cause, or Completeness rubric items,
the all-or-FAIL rule, the grader's input isolation, or the verdict schema.

## Context

Issue #1521. The `build_review` grader prompt states the Tautology rubric as a universal
(`build-review-prompt.ts:46`):

```text
1. Tautology: every new/changed test would fail without the diff.
```

The feature that churned eight laps was a **removal**. Verified diffstat against `main`:

```text
111 files changed, 2337 insertions(+), 9526 deletions(-)
  0  1590  src/conductor/src/engine/wiring-probe.ts
  0  1027  src/conductor/test/wiring-probe.test.ts
  0   648  src/conductor/test/wiring-evidence.test.ts
  0   399  src/conductor/src/engine/wired-into.ts
```

For a diff whose subject is deletion, the rule is inverted. The correct test change for removed
production code is a test that **stops asserting** — a deleted test file, or a fixture updated to
track a contract that lost a member. Such a test cannot "fail without the diff," because the whole
point is that it no longer exercises anything the diff removed. Demanding mutation-sensitivity of it
pushes the maker session toward inventing unrelated behavioral assertions purely to satisfy the
grader, which is worse code and does not converge.

The grader's own flagged finding shows the shape precisely:

```text
[tautology] src/conductor/test/engine/step-runners-copy-equivalence.test.ts changes the
default grader fixture to write a five-key verdict, but the file assertions remain green
against merge-base production and prove no behavior introduced by this diff.
```

That fixture wrote a five-key verdict because the diff **removed a member from an exported type** —
the rubric shed its wiring key. The finding is factually correct under the rule as written and
useless as a review signal. Confidence 95%, basis: verified — the diffstat above and the finding
text quoted in the issue.

### The load-bearing correction

An earlier framing of this fix scoped the evidence to *deleted files and deleted exported symbols*.
That predicate **would not have covered the incident's own flagged finding**, because
`step-runners-copy-equivalence.test.ts` tracks a changed type member, not a deleted file or a
deleted top-level export. A removals-only predicate looks sufficient and is not. This is recorded
because it is the specific way this decision was nearly got wrong.

## Decision

**The Tautology rubric gains one narrow exemption — removal maintenance — and that exemption is
available only against evidence the engine computed from the diff.**

### D1 — The engine derives removal evidence deterministically

A new engine-side deriver reads the diff the grader is already being given, anchored to the
`mergeBase` that `BuildReviewInputs` already resolves, and produces three kinds of removal fact:

1. **Deleted files** — `git diff --diff-filter=D` against the resolved merge base.
2. **Deleted exported declarations** — removed lines declaring an export in a surviving file.
3. **Removed members of exported types** — a member dropped from an exported type, interface, or
   enum declaration in a surviving file.

The third kind is what covers the incident. All three are computed by the engine from the diff, with
no LLM in the derivation path, per the repository's Deterministic-where-possible principle.

### D2 — It travels as a fourth evidence block, not as a rule change

The derived facts reach the grader as `removalContext` on `BuildReviewInputs`, rendered into the
prompt beside the three blocks that already exist — `repairContext`, `acceptedWidenings`, and
`gateInstructions`. This is a settled pattern in this file, and reusing it means the new evidence
inherits its established framing: **evidence, not an exemption.**

The wording of that framing matters and is copied deliberately. The existing blocks say "This
context is evidence, not an exemption: judge whether each apparently out-of-plan hunk directly
repairs a recorded failure." The removal block says the same thing about the same kind of judgement.

### D3 — The exemption predicate is per-test-hunk and must cite the evidence

A changed test is judged as removal maintenance **only when all three hold**:

1. The engine's `removalContext` contains a specific deleted file, deleted export, or removed type
   member; **and**
2. the test's changed lines reference that specific removal; **and**
3. the change does not add an assertion about behavior that still exists after the diff.

If the grader cannot name a specific entry from the engine-supplied list for a given changed test,
the ordinary mutation-sensitivity check applies to it unchanged.

**This is the guard against the failure mode that matters.** The predicate is per-test, not
per-diff. A diff that deletes anything at all must never become a blanket Tautology exemption for
every test it touches — that would gut the rubric on exactly the broad, high-risk changes it is most
needed for. Condition 3 is the second half of that guard: a test that both drops a removed
assertion and adds a new behavioral one is still measured on the part that claims new behavior.

### D4 — Tests claiming new or changed behavior are untouched

No test that asserts behavior this diff introduces or changes gains any relief. That is the entire
remaining surface of the rubric, and it is unchanged in wording, strength, and scope. The exemption
subtracts only the case that was always incoherent.

### D5 — Structural precedent, stated

This is the third recorded exception on this gate and it is built to the shape the first two
established, not a new mechanism:

| Exception | Evidence source | Recorded where |
|---|---|---|
| Rebase repair / stale base state | engine-recorded aggregate failures | `repairContext` |
| Scope widening | containment evaluator | `acceptedWidenings` |
| Removal maintenance (this ADR) | engine-derived diff removals | `removalContext` |

`adr-2026-08-09` states the governing principle for all of them: an exception is valid only when it
is recorded, attributable, and observable. An exemption the maker session could simply *assert*
would be worth nothing — the grader would have no way to distinguish a genuine removal from a
convenient claim about one, and this repository's Design Principle rejects exactly that substitution
of prose for machinery.

## Alternatives considered

- **Reword the rubric only, with no engine evidence** (scope the rule to tests that "claim new or
  changed behavior" and leave the grader to infer the rest). Roughly half the effort. Rejected: the
  exemption would rest entirely on grader prose, which this repository's Design Principle names as
  the thing that drifts under long builds and costs operator interventions. It also gives the grader
  no way to check a claimed removal against fact.
- **Invert the rubric universally** — "no new/changed test asserts behavior this diff does not
  introduce." Correct for removals by construction and arguably the better rule in the abstract.
  Rejected on blast radius: it changes grader judgement for every diff, not just deletion-dominant
  ones, with no evidence about how it behaves on ordinary additive work. Recorded as a future
  consolidation if the narrow exemption proves insufficient.
- **A deletion-ratio heuristic** — exempt the whole diff when deletions dominate insertions.
  Rejected outright: this is precisely the blanket exemption D3 exists to prevent, and the threshold
  would be arbitrary. A 9,526-deletion diff still contained 2,337 insertions that deserve full
  mutation-sensitivity.
- **A maker-authored waiver file**, like the release-gate waiver. Rejected: it is self-attested. The
  removal fact is computable from the diff, so computing it is strictly better than asking the
  session that wrote the diff to vouch for it.
- **Suppressing the Tautology rubric item entirely for removal-heavy diffs.** Rejected: the
  all-or-FAIL rule means the item still has to return a verdict, and suppression would hide genuine
  tautologies in the added 2,337 lines.

## Consequences

- **Positive.** Compatibility and fixture maintenance forced by a removal stops being graded as
  dishonest, so cleanup work no longer pays a review tax that pushes the maker toward writing
  pointless assertions. The exemption is grounded in engine-computed fact, so it cannot be talked
  into existence by a maker session, and it is visible in the prompt as recorded evidence.
- **Preserved invariants.** Scope, Root cause, and Completeness are untouched. The all-or-FAIL rule
  is untouched. The grader's input isolation is preserved — `removalContext` is derived from the
  diff the grader already sees, never from the maker's transcript, summary, or task status. The
  verdict schema is unchanged.
- **Negative / watch.** A genuinely tautological test that happens to touch a removed symbol could
  slip through if the grader applies D3 loosely; the per-test citation requirement is what bounds
  this, and it is the thing to check if Tautology false-negatives start appearing. The deriver adds
  one more parse of a diff the engine has already computed — cheap, and no new git invocation is
  needed beyond the existing diff.
- **Provider neutrality.** The new prompt block is host-neutral text. It names no host, no
  host-specific tool, and no provider path, so a Codex grader session reads it identically to a
  Claude one.
