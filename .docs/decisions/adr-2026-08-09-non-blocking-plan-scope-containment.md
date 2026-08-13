# ADR: Plan-scope containment widens its floor and records rationale instead of refusing commits

**Date:** 2026-08-09
**Status:** APPROVED (operator, 2026-08-09)
**Deciders:** Operator (directions given during DECIDE for intake jstoup111/ai-conductor#1390)
**Source:** intake `jstoup111/ai-conductor#1390`
**Builds on:** `adr-2026-08-02` era work landed as PR #1349 (`plan-scope-containment.ts`,
`scope-trailer.ts`, the report-only `scope-check` CLI, the `Scope:` widening channel)

## Context

PR #1349 (merged 2026-08-08) landed the complete plan-scope containment path in report-only mode.
Four features were subsequently kicked back by `build_review` for scope — the highest-frequency
plan-related kickback in the current worktree set, 4 of 6 features carrying a `build_review`
entry — and two remain stuck. The kickback lands at the *end* of BUILD, after every task's work is
done, so the whole rework budget is spent before the operator learns a task-3 commit was out of
bounds.

The generated `commit-msg` hook carries a comment anticipating an "enforcement flip"
(`git-hook-assets.ts:176-192`), and intake #1390's first desired outcome asks for exactly that:
refuse the commit at the moment it is written.

### Verified facts (read from source at `3faeca78f`, 2026-08-09)

| Claim | Basis | Confidence |
|---|---|---|
| `fileMatchesPlanPath` matches exact or `/`-boundary suffix only — no adjacency (`autoheal.ts:41-45`) | verified | 98% |
| The auto-allow set is `MACHINERY_AUTHORED_PATHS = ['.docs/shipped/', '.pipeline/']` (`build-review-inputs.ts:63`) | verified | 98% |
| `runScopeCheck` returns `1` for four distinct conditions — no `Task:` trailer, task not `in_progress`, no declared `files[]`, and **any thrown exception** (`scope-check-cli.ts:65-99`) | verified | 98% |
| The hook treats every non-0/non-2 exit as abstention and allows the commit (`git-hook-assets.ts:176-192`) | verified | 98% |
| `per-task-commit-floor.ts` already harvests `Scope:` trailers into `acceptedWidenings`, rendered by `build-review-prompt.ts` under `## Engine-accepted scope widenings` | verified | 95% |
| PR #1349 merged from `feat/daemon-pipeline-commits-files-outside-the-active-plan-bef` on 2026-08-08; that branch's apparent diff against main is a squash-merge ancestry artifact, not live contention | verified via `gh pr list` | 95% |

**The decisive consequence of rows 1–2:** a task declaring `src/foo.ts` would, under an enforcing
flip, have its commit **refused** for also touching `src/foo.test.ts`, a same-directory helper, or
`CHANGELOG.md`. All three are routine and necessary. The flip the hook comment anticipates would
convert an end-of-build kickback into constant commit-time friction on the common path.

### Binding operator directions (DECIDE, 2026-08-09)

1. **Never refuse.** Kickbacks are already a friction source; a blocking commit gate on a floor
   this tight would be worse than the problem it solves. The feature must be "helpful without
   being obtrusive and frustrating."
2. **The floor must be generous** — test siblings, same-directory neighbors, and docs/generated
   artifacts are all auto-allowed with zero ceremony.
3. **The recorded widening must carry a "why"**, so `build_review` does not cycle on unexplained
   paths.
4. **Blast radius is contained** — consumers keep today's behavior by default; this repository
   opts itself in and proves the design on self-host first.

## Options Considered

### Option A: Flip `DEFAULT_SCOPE_CHECK_ENFORCEMENT` to `true` — REJECTED
The move the hook comment anticipates, and intake #1390's hypothesis (a).
- **Pros:** one-line change; satisfies desired outcome 1 literally.
- **Cons:** on the current floor it refuses commits for adjacent test files, same-directory
  helpers, and `CHANGELOG.md`. Violates operator direction 1 outright. Refusal also arrives with
  the working tree already staged, so the agent must re-compose the commit message to proceed —
  friction on a path that is usually legitimate.

### Option B: Widen the floor, then flip enforcement — REJECTED
- **Pros:** satisfies outcome 1 while removing most false refusals.
- **Cons:** still violates direction 1. More importantly, the residual false-refusal rate is
  unknown and unmeasurable before the widened floor has run in anger; shipping a blocking gate on
  an unmeasured floor is exactly the sequence that produced the current kickback pain. Enforcement
  remains available later — the config key is retained precisely so this option stays open once
  recorded-widening data exists.

### Option C: Widen the floor, never refuse, always record the rationale — CHOSEN
The check becomes a recorder, not a gate. Out-of-floor paths are recorded as accepted widenings
with a rationale and surfaced to the existing `build_review` scope rubric.
- **Pros:** satisfies all four operator directions. Adds **zero** blocking surface, so the common
  path gains no friction whatsoever. Reuses machinery already merged end-to-end — the evaluator,
  the trailer grammar, the harvest, and the prompt section all exist. Attacks the actual cause of
  the four kickbacks, which was not that out-of-plan paths existed but that they reached the
  grader **unexplained**. Keeps the option of a later enforcement flip alive and better-informed.
- **Cons:** a genuinely unrelated bundled fix still lands and is still judged by an LLM rather than
  refused deterministically — this is a deliberate weakening of intake outcome 1 (see below). The
  derived-rationale path makes widening quality track commit-message quality.

### Option D: Delete commit-time containment; make `build_review` scope-aware from plan + commits — REJECTED
- **Pros:** smallest diff; one place to reason about.
- **Cons:** replaces deterministic machinery with LLM judgment, contrary to this repository's
  "deterministic where possible; LLM only where necessary" principle. Leaves the check-failure
  ambiguity of desired outcome 4 with nowhere to go.

## Decision

**Adopt Option C.** Four sub-decisions.

**D1 — The floor is widened; enforcement is not flipped.** Three additions to the allowed set
beyond the task's declared `files[]`, all operator-selected:

- **test siblings** of a declared file (a task declaring `src/foo.ts` allows `src/foo.test.ts` and
  its fixtures),
- **same-directory neighbors** of a declared file,
- **docs and generated artifacts**, joining `.docs/shipped/` and `.pipeline/` in
  `MACHINERY_AUTHORED_PATHS`.

Floor widening is **unconditional** — it only ever makes the check quieter, so gating it would add
a config axis with no failure mode to protect against. After this widening, a path outside the
floor is genuinely unrelated to the task, which is what makes recording it informative rather than
noise.

**D2 — Rationale is trailer-first, message-fallback, never absent.** An explicit
`Scope: <path> — <rationale>` trailer is recorded verbatim. With no trailer, the commit's own
subject and body are recorded as a **derived** rationale, flagged as derived so the grader can
weigh it differently from an authored one. There is no "unexplained" state: an unexplained widening
is precisely what makes `build_review` kick back, and a design that produced them would reintroduce
the cycling this ADR exists to stop.

**D3 — The check never blocks a commit.** `runScopeCheck` returns 0 on the in-floor path (silent)
and 0 on the out-of-floor path (advisory stderr naming the task, each offending path, and the exact
`Scope:` line to paste next time). `renderScopeRefusal` is reworded from refusal to advisory.
The hook gains no new exit-1 branch. The gate remains `build_review`'s semantic scope rubric — now
supplied with a rationale for every out-of-floor path.

**D4 — `build_review.scopeContainmentEnforced` is retained and redefined.** The key keeps its name
and its `false` default. Its meaning changes from "refuse on violation" (never implemented) to
"record out-of-floor paths as widenings and emit the advisory". This repository sets it `true` in
its own `config.yml`. **The key is deliberately not renamed:** `settings.json`/config schema is a
canonical breaking surface under this repository's release gate, and a rename would force a
migration block for a purely cosmetic gain. The imprecision is recorded here so it is not later
mistaken for a bug. A follow-up intake will propose flipping the default for all consumers once
self-host evidence exists.

### Explicit departure from intake #1390

Desired outcome 1 asks that an out-of-scope commit **not land** — that it be "refused at the moment
it is written". **This decision does not refuse.** Outcome 1 is met only in the weaker form
*detected at commit time, recorded durably, never silently lost*. Outcomes 2, 3, 4, and 5 are met in
full. This departure is an explicit operator direction, recorded here so the issue is not read as
unmet and so a future reader does not restore refusal believing it was an oversight.

## Consequences

**Positive**
- No new blocking surface anywhere in the build path; the common path is untouched.
- The four observed kickbacks' proximate cause — unexplained out-of-plan paths reaching the
  grader — is removed at the source.
- Reuses merged machinery; the diff is concentrated in an evaluator predicate, a rationale
  resolver, and config/docs.
- The enforcement option stays open and becomes decidable on evidence rather than on a comment.

**Negative / accepted**
- A genuinely unrelated bundled fix still lands, still judged semantically. Accepted: the operator
  judges commit-time blocking worse than the residual kickback risk.
- Derived rationales inherit commit-message quality. Mitigated by the `derived` flag, which lets
  the grader treat them with less weight than an authored trailer.
- "Same-directory neighbors" is the broadest of the three floor additions and measurably weakens
  containment for flat directories. Accepted on operator direction; the recorded-widening stream is
  the instrument that will show whether it was too broad.
- `scopeContainmentEnforced` now names a behavior that is not enforcement. Documented, not renamed.

## Related

- `adr-2026-08-09-hook-owned-containment-event-ledger` — where an unresolvable check is recorded
  (intake outcome 4).
- `.docs/architecture/out-of-plan-production-edits-reach-build-review-in.md` — component and
  sequence views.
