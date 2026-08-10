# ADR: Declared pattern replication — the copy is a plan task, and TDD pays only for the deltas

**Date:** 2026-08-09
**Status:** APPROVED
**Deciders:** jstoup111 (operator), engineer DECIDE session 2026-08-09

## Context

When a feature adds the Nth instance of an established in-repo pattern — another gate, another
step, another provider adapter — BUILD derives every acceptance spec and every task test from
first principles, even though a near-identical and already-tested source sits beside it in the
tree. The expensive half of each RED phase is authoring tests that already exist in near-identical
form at the source site.

Nothing in the artifact set can express "this is a replication of that," so nothing can act on it.

**Forces.**

1. `adr-2026-07-21-s-tier-pipeline-knobs` (APPROVED) frames the constraint: "Small work stays on
   the **one** pipeline… No new step types, no new artifact type, no new land primitive, no
   parallel flow," and its D4 adds the hard invariant that "RED-first, the SHIP tail, and the
   finish gate are identical across tiers." Its rejected-alternatives list explicitly kills "a new
   `size: S` build-time skip list… that would weaken the evidence tail."
2. `CLAUDE.md`'s first Design Principle: deterministic where possible, LLM only where necessary.
3. **Per-task RED is not enforced by any machinery.** Verified: the only mechanical RED is
   feature-level (`validateAcceptanceRedEvidence`, `artifacts.ts:1238-1300`). The per-task floors
   in `per-task-commit-floor.ts:54-105` and `:113-184` are advisory — they prepend WARNING lines
   and never change `success` (`step-runners.ts:1742-1783`). `hooks/claude/tdd-commit-gate.sh`
   exists but is inert: nothing in `src/` or `bin/` ever writes `.pipeline/tdd-phase`. This cuts
   both ways — a cheaper RED breaks no gate, and precisely because of that, a degraded RED would
   be invisible.
4. `skills/simplify/SKILL.md:43` reads "Copy-paste with tweaks | Same method with 1-2 param
   differences | **Extract with parameters**" — the harness's standing answer to the Nth copy is
   to parameterize it.

## Options Considered

### Option A: `**Type:** replicate <source>` per-task marker; RED satisfied by a copied test
- **Pros:** Largest theoretical turn saving — no test authoring at all. The `**Type:**` line is an
  already-plumbed channel (`autoheal.ts:613-676`).
- **Cons:** A copied test asserts the *source's* behavior; renaming it green is trivial and nearly
  worthless as a check. Because per-task RED is unenforced (force 3), that degradation would never
  surface. Prose-level collision with the D4 invariant. The channel is also not value-carrying —
  it returns `Map<string, boolean>` and lowercases, so it would corrupt a real path.
- **Rejected.**

### Option B: a `conduct-ts replicate` deterministic CLI primitive
- **Pros:** Purest reading of the deterministic-first principle.
- **Cons:** Nth-of-a-kind work is rarely a pure rename — the Nth gate has genuinely different
  logic, so the tool emits something still needing substantial LLM editing. New `bin/conduct` CLI
  surface, which this repository's release gate treats as a breaking surface requiring a migration
  block. Poor effort-to-benefit.
- **Rejected.**

### Option C: exemplar priming — keep full RED everywhere, seed the generator with the source test
- **Pros:** Weakens nothing; no collision with D4 at all; smallest build.
- **Cons:** Still pays to author every test. Option D pays only for the deltas, which on an
  80%-identical replication is the difference between authoring ten tests and authoring two.
- **Rejected as primary; retained as the documented fallback** if measurement shows derivation is
  not the cost driver (see Assumption 1).

### Option D: the copy is Task 1, and TDD pays only for the deltas — **CHOSEN**
- **Pros:** Attacks the actual cost. Resolves rather than dodges the RED problem: after Task 1 the
  copied tests pass *legitimately*, because the behavior genuinely exists — the case
  `Evidence: satisfied-by <sha>` was built for (`skills/tdd/SKILL.md:200-242`). RED stays real and
  unmodified for every task that adds new behavior.
- **Cons:** Produces one large copy commit. Requires net-new content-comparison machinery, of
  which the engine has none.

### Option E: a feature-level `.docs/pattern-source/<stem>.md` sibling artifact
- **Pros:** Mirrors the `.docs/complexity/<stem>.md` shape, which has a working parser and two
  consumers.
- **Cons:** A second channel for something the plan already carries. Both consumers read the plan
  off disk already; the plan must describe the copy work regardless, so the sibling would restate
  a relationship the plan states anyway.
- **Rejected** on the event-spine principle's schema-not-file test.

### Option F: a persistent pattern registry with a source-to-replica drift gate
- **Pros:** Would catch the real long-term failure — the source gains a case its replicas never
  get.
- **Cons:** Needs a registry artifact plus substantial net-new content-comparison machinery.
- **Rejected as out of scope** by explicit operator decision, 2026-08-09: the link is one-time and
  consumed during the build.

## Decision

**Adopt Option D.** A plan declares its source pattern and rename map in the plan **header**; the
BUILD phase consumes that declaration at two points.

1. **Grammar.** `**Pattern-source:**` and `**Rename-map:**` are plan-header lines, parsed by a new
   sibling of `plan-stories-reference.ts` — the one existing plan-header parser, which already
   does fail-closed path resolution (traversal refused, non-`.docs/` refused, absent-line
   fallback). The rename map parses into a discriminated union with a `malformed` branch that
   lists the accepted forms, modeled on `wired-into.ts:19,100,167`. A declared source path that
   does not resolve on disk fails closed, following `resolveWaiverRef`
   (`wiring-probe.ts:655-667`).

2. **`acceptance_specs` copies rather than derives.** The source feature's acceptance specs are
   copied and renamed. They fail because the target does not yet exist, so
   `validateAcceptanceRedEvidence` is satisfied **honestly** — RED is earned, not stamped. This is
   strictly better than the alternative orderings: at this point in the flow a copied spec
   *cannot* pass trivially, because there is nothing for it to pass against.

3. **`build` Task 1 is the declared copy.** Mechanical, zero LLM, with its own `**Files:**`
   declaration. A deterministic copy-equivalence check asserts the result equals the source modulo
   the declared rename map, so the large diff is machine-verifiable instead of requiring the
   `build_review` grader to read it.

4. **Tasks 2..N are deltas only.** Tasks whose criteria Task 1 already satisfies close through the
   existing `Evidence: satisfied-by <sha>` empty-commit form, whose sha must exist and be an
   ancestor of HEAD. Every task that adds behavior the source does not have runs the full,
   unmodified cycle: RED → DOMAIN → GREEN → DOMAIN → COMMIT.

5. **`simplify` is informed, not silenced.** A declared replication suppresses the reflex
   duplication flag at `SKILL.md:43`; simplify's extraction judgement is explicitly retained and
   it may still propose or perform extraction where genuinely warranted (operator decision,
   2026-08-09).

**Why D over the others.** Option A buys speed by degrading the one check that would catch a bad
copy, in a system where that degradation is structurally invisible. Option C preserves everything
but keeps paying for work the source already did. D is the only option that spends the LLM
exclusively on what is genuinely new — which is the same trade the repository already made when it
replaced an Opus reasoning pass with the superseded-symbol grep (`.docs/retros/2026-06-26-phase-9.3-engineer-redesign.md`
C-2, shipped as `skills/pipeline/SKILL.md:135`).

**Relationship to `adr-2026-07-21-s-tier-pipeline-knobs`.** This ADR does not amend or supersede
it. Nothing here is tier-conditional; nothing is added to any `skippableForTiers` list; no gate is
disabled; `build_review`, `wiring_check`, `test_suite`, and `manual_test` are untouched. D4's
locked tests (companion plan T4/T6) assert step-level skip and disabled sets and are unaffected.
The RED-first invariant is preserved in substance: every task that introduces new behavior still
writes a failing test first.

## Assumptions

Recorded per the `verify-claims` protocol. Neither is load-bearing enough to block, because under
Option D no gate is weakened and the fallback (Option C) is documented above.

| # | Assumption | Confidence | Basis | Impact if wrong | How to confirm |
|---|---|---|---|---|---|
| 1 | RED cost is dominated by test *derivation*, not by running the scoped suite | ~70% | inferred from the RED contract's test-files-only isolation (`skills/tdd/SKILL.md:296`) and the pasted-failure requirement | Savings are materially smaller than projected; the right response is to fall back to Option C rather than to weaken RED | Turn/duration breakdown from `.pipeline/events.jsonl` across a past Nth-of-a-kind build |
| 2 | D4 binds tier-conditional weakening, not task-type-conditional | ~65% | inferred; its locked tests are step-level, and its prose is framed entirely around tiers | Low under D, which weakens nothing either way — the question only bit Option A | Operator reading of D4's intent; the tests themselves do not discriminate |

## Consequences

### Positive
- Replication builds spend LLM turns only on genuinely new behavior.
- The copy becomes an explicit, reviewable, declared unit of work rather than an implicit smear
  across N tasks.
- Acceptance RED for replications becomes *more* trustworthy than today's derived specs, because a
  copied spec is checked against a target that provably does not exist yet.
- The engine gains its first content-comparison primitive, which later work (Option F, drift
  detection) can build on.

### Negative
- One large copy commit per replication feature. Mitigated by the equivalence check, not by
  splitting the commit.
- A declared source that exists but is the wrong analogue degrades output quality without
  halting. Fail-closed resolution catches only nonexistent paths; the delta tasks' RED is the
  backstop. Accepted.
- `skills/simplify` gains a conditional branch, which is a small increase in the judgement asked
  of it at every batch boundary.
- The plan author acquires a new obligation — naming the source and the rename map correctly.

### Follow-up Actions
- [ ] Add `**Pattern-source:**` / `**Rename-map:**` to the plan header contract in `skills/plan/SKILL.md`
- [ ] Implement `plan-pattern-source.ts` with fail-closed resolution and a `malformed` branch
- [ ] Implement the copy-equivalence check
- [ ] Amend `skills/writing-system-tests`, `skills/pipeline`, `skills/tdd`, `skills/simplify`
- [ ] Update `docs/reference/skills.md`, `docs/reference/artifacts.md`, `docs/reference/steps.md`, `docs/explanation/gates.md`
- [ ] File the Option F registry/drift idea as intake for later consideration
