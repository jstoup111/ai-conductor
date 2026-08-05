# ADR: A protected artifact this branch never touched is inherited, whatever revision it is

**Date:** 2026-08-05
**Status:** APPROVED
**Feature:** build-halts-when-a-branch-inherits-an-older-revisi (jstoup111/ai-conductor#1315)
**Related:** `adr-2026-07-26-protected-artifact-seal-rebaseline` (introduced the base-inheritance
tolerance this widens), `adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts` (#1293 —
adjacent, unbuilt, and deliberately untouched by this decision)

## Context

On 2026-08-05 the daemon halted `tests-leak-fixture-slugs-into-the-parked-feature-l` mid-BUILD with:

```text
✋ loop halted: Protected artifact added: .docs/plans/build-tasks-can-amend-protected-docs-artifacts-ame.md
```

The named plan belongs to a different feature. The branch never authored or edited it: relative to
its own merge-base it adds no plan files at all. It arrived through main, and main then amended it
(#1303) after this branch's merge-base (#1304). The branch therefore held revision A while the base
tip held revision B, and the two differed by two `**Wired-into:**` documentation lines.

The seal already carries a tolerance for exactly this situation — the "arrived through the front
door" test at `protected-artifact-seal.ts:580-610`. It was reached and it returned false, because
the only content it accepts is content byte-identical to the base **tip**
(`matchesBaseTip`, `:551-563`). An inherited revision that is merely *behind* fails that equality.

Recovery was a rebase onto `origin/main` with zero conflicts, then a hand-cleared HALT. The branch
was never tampering with anything. It was only behind.

This is not a one-off. Any branch whose base moves while another feature amends an already-landed
protected artifact hits it, and #1303 was itself such an amendment. The failure also costs the
in-flight BUILD step's work, and is silent until an operator reads the daemon log.

### Why the existing test is shaped the way it is

Byte-equality against the base tip is trivially unforgeable: the base ref is an independent
authority that a build agent does not write to. That property is worth preserving, and it is the
reason the tolerance was written narrowly in #976 rather than as a general provenance question.

The narrowness is also why the defect went unnoticed. The unit fixture that covers this block
(`protected-artifact-seal.test.ts:544`, helper `advanceBase` at `:545`) commits base advances onto
the *currently checked-out* branch, so base tip and HEAD are always the same commit. No existing
test can produce a branch holding an older revision than the base tip — the exact case that halts.

## Decision

**Treat a protected artifact as inherited when this branch demonstrably did not modify it**, in
addition to the existing byte-equality case. Concretely, `inheritedFromBase(path)` becomes the union
of two independent accepting tests:

1. **Base-tip equality (existing, unchanged).** The workspace copy is byte-identical to
   `<baseRef>:<path>`.
2. **Untouched inheritance (new).** All of:
   - `git diff --name-only <baseRef>...HEAD -- <path>` is empty — this branch's own commits, taken
     against its merge-base with the base branch, contain no change to that path; and
   - the workspace copy is byte-identical to `HEAD:<path>` — there is no uncommitted edit; and
   - both probes exited zero.

Either test accepting is sufficient. A path that passes neither is refused exactly as today.

### Union, not replacement

Test 2 does not subsume test 1. A workspace copy that differs from `HEAD` but equals the base tip
passes today and would fail test 2. Replacing the tip test would convert those passes into halts —
a regression this decision explicitly declines to buy. Adding beside it makes the change **strictly
widening**: every path tolerated before this change is still tolerated after it.

### The refusal names its cause

The seal's `reason` is the entire operator-visible halt message on the BUILD path — it is written
verbatim into `.pipeline/HALT` with no recovery note appended, and its first non-empty line is what
the daemon dashboard surfaces. So the refusal carries its cause in the text, with the terse
classification first and the recovery after it:

| Cause | First line | Recovery named |
|---|---|---|
| Branch committed a change to an artifact it does not own | `Protected artifact changed: <path>` | Revert to the committed DECIDE content; route amendments to DECIDE |
| Uncommitted edit in the worktree | `Protected artifact edited in worktree: <path>` | Restore from `HEAD` |
| Provenance undeterminable | `Protected artifact provenance undeterminable: <path>` | States which probe failed (no base ref, no merge-base, git error) and that a rebase onto the base is the fix |

Undeterminable is a reachable state, not a theoretical one: interactive `conduct` runs construct the
`Conductor` without `baseBranch` (`index.ts:1167-1185`), so no base ref resolves and no tolerance
applies. Those runs halt today with a message that does not explain why; after this change they say
so. The halt itself is unchanged — fail-closed remains fail-closed.

## Alternatives considered

**Accept any revision of the path reachable from the base ref.** Walk `git rev-list <baseRef> -- <path>`
and accept the workspace copy if it matches any historical blob. Rejected: it accepts content the
branch could have written by hand as long as that content ever existed on the base branch — including
a deliberate revert of a *later* amendment, which is a real tamper vector. It also answers a question
about the artifact's history rather than about this branch's behavior, which is the thing the seal
actually cares about.

**Accept the merge-base copy specifically.** Compare the workspace copy to `<merge-base>:<path>`.
Nearly equivalent to the chosen test for the observed case, and cheaper by one probe. Rejected as the
primary formulation because it silently accepts an agent edit that happens to restore the merge-base
bytes after the branch legitimately amended its own artifact, and because "did this branch change the
file" is the question worth asking directly — `git diff` answers it without the engine reasoning about
which revision *should* be there.

**Fix it upstream by keeping branches current with the base.** The divergence would not arise if the
branch were rebased. Rejected as the fix for *this* issue: it makes correctness depend on rebase
scheduling, it does not help a branch that is legitimately behind mid-build, and the seal would still
be wrong about what constitutes tampering. It also overlaps `mergeable_skip`
(`adr-2026-07-30-finish-only-mergeability-gate`, shipped), where a cleanly-mergeable branch skips the
rebase and seal rotation entirely — so an upstream fix would have to re-open a decision that was made
deliberately. Worth tracking separately; not a substitute here.

**Rotate the seal automatically on this drift.** Rejected: rotation rebaselines what the seal
considers authoritative. Inheritance is a question about one path's provenance and should not
re-authorize every other artifact in the seal as a side effect.

## Consequences

**The trust assumption is unchanged, and it is an inherited one.** Both accepting tests rest on the
build agent being unable to advance the base ref. Test 1 trusts `origin/<base>`'s content; test 2
trusts the merge-base derived from that same ref. An agent that could rewrite
`refs/remotes/origin/main` defeats both equally. This decision adds no new exposure — it inherits an
existing one, and records it here rather than leaving it implicit.

**Tamper detection is unweakened.** Anything the agent writes appears either in the branch's own
commits (caught by the `git diff` probe) or in the working tree (caught by the `HEAD` comparison).
Laundering a modification requires moving the merge-base, which requires writing the base ref.

**Cost is bounded and small.** Two extra read-only git invocations, on the refusal path only, for
paths that already failed both the fingerprint check and base-tip equality. The clean path still
shells out to git zero times (`baseRef()` stays lazy). Path histories here are short — the plan in
the observed halt has two commits total.

**Blast radius is one module.** `inspectSeal` and its helpers. Discovery, the `protected-artifact`
HALT class, retry budget, step topology, seal creation, seal rotation, and the `deleted` refusal
branch are all untouched.

**Tests and docs move with it.** No production code pattern-matches the `reason` string — the
machine-readable discriminator is `.pipeline/HALT.class` — so the wording change lands in tests and
documentation only. The `advanceBase` fixture must gain the ability to advance the base branch
*without* moving HEAD, or the new behavior cannot be tested at all.

**#1293 is unaffected.** `adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts` states its
design needs "no new tolerance". That is a statement about what *that* feature requires, not a
constraint on what the seal may tolerate. It reuses `namesOwnFeature` and the sealed-directory list;
this decision changes neither. The two touch the same file and will need an ordinary rebase,
nothing more.
