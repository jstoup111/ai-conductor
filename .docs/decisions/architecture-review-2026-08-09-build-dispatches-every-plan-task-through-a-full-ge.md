# Architecture Review: declared pattern replication for Nth-of-a-kind BUILD work

**Date:** 2026-08-09
**Stem:** `build-dispatches-every-plan-task-through-a-full-ge`
**Tier:** M — lightweight mode (§2 Feasibility and §4 Alignment in full; §3 Complexity already
done by the complexity step; §5 Domain Integrity pre-check handled per-cycle by the TDD domain
reviewer)
**Track:** technical (no PRD; acceptance criteria live in the stories)
**Input reviewed:** `.docs/architecture/build-dispatches-every-plan-task-through-a-full-ge.md`,
`.docs/track/…`, `.docs/complexity/…`. Stories and plan do not exist yet at this point.
**Verdict:** APPROVED WITH CONDITIONS

## Scope check

```
A. Audience:  consumer-facing — no repo-only signal fired. The mechanism this change
              describes (plan artifacts, acceptance_specs, pipeline, tdd, simplify)
              exists in every repository that installs the harness, which is the
              deciding test per AGENT_INSTRUCTIONS.md → Scope Decisions.
B. Catalog:   n/a — no new skill is created.
C. Provider:  agnostic — skill prose plus engine TypeScript. The copy and its
              equivalence check are mechanical; no provider-specific path, environment
              variable, settings file, or subagent facility is involved.
Registration: HARNESS.md only if a behavioral rule lands (see Conditions);
              docs/reference/skills.md, docs/reference/artifacts.md,
              docs/reference/steps.md, docs/explanation/gates.md for the new gate.
```

The scope-check verdict and the deciding test agree. No conflict to surface.

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | Clear. TypeScript in the existing engine plus Markdown skill prose. No new dependency, service, or infrastructure. |
| **Prerequisites** | None. `acceptance_specs` already declares `prerequisites: ['plan']` (`steps.ts:132-141`), so the plan is on disk and readable when the spec copy runs — verified, not assumed. |
| **Integration surface** | Five skills (`plan`, `writing-system-tests`, `pipeline`, `tdd`, `simplify`) and two steps. Above the 3-boundary flag threshold, which is why this is M and not S. No external API. |
| **Data implications** | None. No schema, no migration, no persisted state beyond the plan artifact itself. |
| **Performance risk** | Net negative cost — the feature removes LLM turns. The one new cost is the copy-equivalence check, a bounded content comparison over a declared file set. |
| **Worktree isolation** | No new port, service, database, queue, or shared path. The copy happens inside the feature's own worktree against paths already in that checkout. |
| **Dispatch feasibility** | Verified: neither `acceptance_specs` nor `build` receives artifact text — both get a bare `/«skill»` prompt with a `[Conduct step N/M] Feature: «desc»` system prompt (`step-runners.ts:550-554`, `:2019-2040`). Both skills read artifacts off disk themselves, so reaching a new plan header line is a prose change, not a dispatch change. |

**Early overlap scan** (advisory, run over the Wiring Surface paths below):
`No overlap detected; no open blockers.` No unmerged dependent work touches these files.

## Complexity

Assessed as **M** by the complexity step; not re-derived here per lightweight mode. The rating
holds against §3's criteria: cross-module logic across five skills and two steps, with one piece of
net-new engine machinery, and no external API or state machine that would push it to High.

## Alignment

**Pattern consistency — strong.** Every component except one has a direct in-repo precedent:

| New component | Precedent it follows |
|---|---|
| `Pattern-source` / `Rename-map` header lines | `**Stories:**` header contract, `skills/plan/SKILL.md:311-326` |
| `resolvePatternSource` | `plan-stories-reference.ts:25-60` — the only existing plan-header parser; traversal refused, non-`.docs/` refused, absent-line fallback |
| Rename-map `malformed` branch | `wired-into.ts:19,100,167` — a discriminated union whose malformed branch enumerates accepted forms |
| Declared-path-must-resolve gate | `wiring-probe.ts:655-667` `resolveWaiverRef` — `fileExists` → `waived` / typed `gap` |
| Copy-equivalence check | **No precedent.** The engine compares paths, never contents: no diff, no similarity, no edit distance; `copyFile` appears twice and both are scaffolds. `full-suite-fingerprint.ts` is the nearest content-hashing shape. |

The single net-new pattern is covered by the ADR, satisfying §7's gate.

**Domain boundaries — respected.** The declaration rides the plan artifact, which every consumer
already reads. No sidecar file, no second telemetry path, no new artifact type. This passes the
event-spine skill's schema-not-file test: the concern is a property of the plan, and the plan is
the channel that already carries the work description.

**Alignment with `adr-2026-07-21-s-tier-pipeline-knobs` — no violation.** Its D4 hard invariant
and its companion plan's locked tests (T4 pins the exact S skip set; T6 pins the tier-invariant
gate set) are step-level assertions about `getSkippableSteps` and `shouldSkipForTier`. This change
is not tier-conditional, adds nothing to any `skippableForTiers` list, and disables no gate, so
neither test is touched. The substantive invariant — RED-first — is preserved: every task that
introduces behavior the source lacks still writes a failing test first. The ADR records this
relationship explicitly and does not amend or supersede.

**Alignment with `CLAUDE.md` Design Principles — this is the principle applied.** The copy and its
verification are mechanical; the LLM is spent only on the deltas, which is the judgement part.
Same shape as the retro C-2 precedent that replaced an Opus reasoning pass with a static grep
(`skills/pipeline/SKILL.md:135`).

**State management.** The declaration is one-time and consumed within the build; no persistent
state, no flags, no representable invalid intermediate. The parse result is a discriminated union
rather than a boolean pair, so "declared but malformed" cannot be confused with "not declared."

**Security boundaries.** No new endpoint, no new user input crossing a trust boundary. The one
input is a plan-declared path, and it is confined by the same fail-closed resolution the Stories
resolver already applies (traversal refused, non-`.docs/` refused) — extended here to the source
path being copied from.

**Diagram accuracy.** `.docs/architecture/…` was authored in this pass and renders (3 diagrams,
`render-diagrams --check` passes). It reflects the design as decided.

## Domain Integrity

Skipped per lightweight mode (§5 is handled per-cycle by the TDD domain reviewer). One design-time
note carried forward rather than deferred: the rename map must be a parsed domain type with an
explicit malformed state, not a raw string or a bare `Map<string, string>` built from a permissive
split. The existing `**Type:**` channel is the cautionary case — it returns `Map<string, boolean>`,
lowercases its input, and silently ignores unknown tokens (`autoheal.ts:638-676`), which is exactly
why it cannot carry a path today.

## Wiring Surface

Design-time commitments for each new production surface. No `file:line` is required yet; the
as-built gate verifies real callers after implementation.

| New surface | Where it will be called from in production |
|---|---|
| `resolvePatternSource(planRepoPath, planContent)` — new module `src/conductor/src/engine/plan-pattern-source.ts` | Invoked by the copy-equivalence gate's runner in the BUILD path, and exported for the plan-validation surface alongside the existing `validate-wired-into` command family in `src/conductor/src/cli.ts` |
| Rename-map parser (same module) | Called by `resolvePatternSource`; its `malformed` branch surfaces through the same gate's diagnostic |
| Copy-equivalence check — new engine module | Wired into the BUILD-phase gate sequence that already runs alongside `per-task-commit-floor` in `step-runners.ts`, reading the resolved pattern source and the declared copy task's `**Files:**` set |
| `**Pattern-source:** / **Rename-map:**` plan-header grammar | Consumed by `skills/plan` (authoring contract), `skills/writing-system-tests` (spec copy at `acceptance_specs`), and `skills/pipeline` (Task 1 copy at `build`) — all three read the plan off disk today |
| Declared-replication awareness in `skills/simplify` | Read at the existing batch-boundary invocation; no new dispatch point |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Copy-equivalence check ships advisory, leaving a large unverified copy diff | Technical | Medium | High | **Condition 1** — the check must block Task 1 on failure. Every existing per-task floor in this repo is advisory (`per-task-commit-floor.ts`), so advisory is the path of least resistance and must be explicitly ruled out |
| Declared source exists but is the wrong analogue | Knowledge | Medium | Medium | Fail-closed resolution catches only nonexistent paths. Delta-task RED is the backstop. Accepted, recorded in the ADR |
| `Evidence: satisfied-by` becomes a rubber stamp for real delta work | Technical | Low | High | Sha must exist and be an ancestor of HEAD (existing derivation); `build_review`'s plan-vs-diff rubric judges completeness independently and remains the final authority |
| `simplify` stops catching genuine accidental duplication | Technical | Low | Medium | **Condition 2** — suppression scoped to the declared replication only; extraction judgement explicitly retained |
| Projected savings do not materialize (Assumption 1, ~70%) | Knowledge | Medium | Medium | **Condition 3** — measure from `.pipeline/events.jsonl`; Option C is documented in the ADR as the fallback, and the grammar is unchanged between D and C |
| Large copy commit swamps the `build_review` grader | Technical | Medium | Medium | The copy is a declared task with its own `**Files:**`; the equivalence check makes the diff machine-verifiable rather than requiring the grader to read it |

## ADRs Created

- `adr-2026-08-09-declared-pattern-replication-in-build.md` — **APPROVED**. Records the decision,
  all five rejected alternatives (per-task `Type:` marker, `conduct-ts replicate` CLI primitive,
  exemplar priming, sibling `.docs/pattern-source/` artifact, persistent registry with drift gate),
  and the two carried assumptions with confidence and impact.

No existing ADR is superseded.

## Conditions

1. **The copy-equivalence check blocks.** On failure it must fail the task, not warn. An advisory
   implementation leaves the feature's central safety claim unenforced, and advisory is this
   repository's default shape for per-task checks — so it must be ruled out deliberately. Verified
   at code review and at `/finish`.
2. **`simplify` suppression is scoped to the declared replication only.** Undeclared duplication
   elsewhere in the same diff must still be flagged, and simplify retains authority to propose or
   perform extraction on the declared replication where warranted.
3. **Assumption 1 is measured, not assumed.** Before or during BUILD, take a turn/duration
   breakdown from `.pipeline/events.jsonl` for a past Nth-of-a-kind build. If derivation is not
   the dominant RED cost, fall back to Option C (exemplar priming) rather than compensating by
   weakening RED further. The plan-header grammar is identical under both, so the fallback costs
   no re-cutting.
4. **No `**Type:**` channel reuse.** The path must travel on its own header line. Reusing
   `autoheal.ts`'s `**Type:**` parse would lowercase the path and split it on `+`.

## Blocking Issues

None.
