# Architecture Review: prd_audit passes on a partial report

**Date:** 2026-08-09
**Mode:** lightweight (Medium tier — §2 Feasibility + §4 Alignment; §3, §5 skipped per Lightweight Mode)
**Input reviewed:** `.docs/track/prd-audit-partial-report-false-pass.md`,
`.docs/complexity/prd-audit-partial-report-false-pass.md`,
`.docs/architecture/sequences/prd-audit-partial-report-false-pass.md`,
explore output. Technical track — no PRD, so acceptance criteria will live in the stories.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | Yes. No new dependencies. JSON gate evidence is established idiom — `.pipeline/build-review.json` and `.pipeline/remediation.json` already exist, and `build_review` is registered in `ARTIFACT_PATTERNS` exactly as the new manifest will be. **Verified** at `artifacts.ts:279`. |
| **Prerequisites** | None external. `.pipeline/` is already gitignored (**verified**, `.gitignore:4`), so the manifest inherits run-evidence semantics with no ignore change. |
| **Integration surface** | Contained but non-trivial: one engine module (`artifacts.ts`), one conductor routing site (`conductor.ts`), one skill (`skills/prd-audit/SKILL.md`). Does not cross domain boundaries. |
| **Data implications** | None. No schema, no migration, no persistence beyond gitignored run evidence. |
| **Performance risk** | Negligible. Replaces a line-scan of one markdown file with a JSON parse of one small file, plus an FR-id grep over `.docs/specs/` bounded by spec count (48 today). |
| **Worktree isolation** | Unaffected. All artifacts are per-worktree `.pipeline/` paths already; no ports, services, or shared state introduced. |

**Feasibility risk that required checking, and its resolution.** The design needs the engine to tell
the skill which FRs still lack a verdict. `renderSkillInvocation` (`skill-invocation.ts:56-66`)
joins a **static** `arguments` array from the descriptor table — there is no dynamic per-dispatch
argument path, so threading a missing-FR list through the invocation would mean new plumbing on a
contended surface. **Verified** by reading the function. Resolved by inverting the flow: the
surviving manifest on disk carries the missing set, the skill reads its own, and the engine verifies
coverage deterministically afterward. No invocation plumbing is required. This is why the design is
feasible at Medium rather than Large.

## Alignment

**Convention over precedent — checked against `CLAUDE.md`:**

- **"Deterministic where possible; LLM only where necessary."** Satisfied, and this change moves in
  the correct direction. The current fail-open behavior is the exact failure `CLAUDE.md` describes:
  a rule enforced only by prompt discipline, drifting under a long run. The fix puts the acceptance
  decision in machinery that "fails at the point of violation". The skill still decides *which* FRs
  to re-audit — judgement — but the engine decides whether the result is acceptable.
- **"Extend the existing event spine; never add a parallel channel."** Satisfied, and formally
  checked before the design was written. The manifest is durable gate state read by name
  (exception C), not an occurrence; the per-FR dispatch/return telemetry that *would* be an
  occurrence is explicitly deferred to #1398 rather than smuggled into a sidecar counter. Recorded
  in the ADR's Event spine block.
- **Documentation upkeep.** A new gate artifact and a changed gate contract are reader-visible.
  `docs/explanation/gates.md` and `docs/reference/steps.md` are the affected canonical pages and
  must be updated in the same PR. Carried as a condition below.
- **Test isolation policy.** No third-party boundary is involved; unit tests over the predicate and
  acceptance coverage of the four sites need no live LLM.

**Pattern consistency:** the design follows the existing gate-evidence shape rather than inventing
one — structured JSON as the machine-read signal, markdown retained as the human view, `run`-scoped
`ARTIFACT_PATTERNS` registration, `#817` code stamp for preservation. No new pattern is introduced,
so no additional ADR beyond the one recorded is required.

**State management:** the change removes an implicit-state problem rather than adding one. Today
"complete" is inferred from the *absence* of blocking rows — an unrepresentable-state bug, since
"no FRs audited" and "all FRs clean" are the same observation. The manifest makes the roster
explicit, so those two states become distinguishable.

**Security boundaries:** not applicable. No endpoints, no user input, no sensitive fields.

**Production DI defaults:** not applicable. No DI registration, no in-memory store for stateful
data.

**Diagram accuracy:** `.docs/architecture/sequences/prd-audit-partial-report-false-pass.md` was
authored for this change and render-checked (`conduct-ts render-diagrams --check`, exit 0). It
reflects the decided design including the four sites and the preserve/invalidate fork.

## Wiring Surface

Design-time commitments for each new production surface (no `file:line` yet — the code does not
exist):

| New surface | Where it is called from in production |
|---|---|
| `.pipeline/prd-audit.json` artifact pattern | Registered in `ARTIFACT_PATTERNS.prd_audit` (`artifacts.ts:284`) beside the existing markdown entry; consumed by the existing `findArtifactFiles` and stale-artifact sweep, so no new reader is introduced. |
| Coverage-completeness predicate (new exported helper in `artifacts.ts`) | Called from all four existing sites: `sweptArtifactStillValid` (`:681`), the `#817` preserve pre-check (`:2257`), the main completion path (`:2300`), and `classifyPrdAuditGaps` (`:3267`). |
| PRD FR-id enumerator (new helper) | Called only by the coverage predicate above; reads non-`SUPERSEDED-` files under `.docs/specs/`. |

> **Amended 2026-08-09 by #1398:** this row is wrong — the enumerator already exists and must be
> **reused, not rewritten**. `extractPrdFrIds` (`src/conductor/src/engine/engineer/coherence-validator.ts:184`)
> already parses `FR-N` ids and is consumed by `checkFrCoverage` (`:508`). It is currently
> module-private (`function`, not `export function`), so the work is to lift or export it, not to
> author a second parser. Writing a second one would be a resource-contention defect: two parsers
> for one concept, free to drift, with `prd_audit` and the coherence gate silently disagreeing
> about what a PRD requires.
>
> Two properties were verified before adopting the reuse:
> - **Coverage is identical.** `extractPrdFrIds` is scoped to the `## Functional Requirements`
>   section, which is narrower than the whole-file grep used for this review's original 43/48
>   figure. Measured 2026-08-09 across the 48 non-`SUPERSEDED-` specs, both approaches enumerate
>   the same **43**, so reuse costs no coverage.
> - **The non-enumerable carve-out already has precedent.** `checkFrCoverage:509` returns a pass
>   when the id set is empty — the same fail-safe Story 5 specifies — so this design follows an
>   established convention rather than introducing one.
| Incomplete-audit classification | Consumed by the conductor's existing `prd_audit` kickback routing (`conductor.ts:4884-4940`) so incompleteness re-dispatches `prd_audit` instead of building a BUILD-targeted remediation work order. |
| Manifest write obligation | `skills/prd-audit/SKILL.md` §3/§4 — a skill contract, not a code seam. Enforced by the predicate above rather than by prose. |

Note for `/plan`: the finish-time validation fence (`conductor.ts:1574`) recomputes member verdicts
via `computeAndWriteVerdict` and therefore inherits the new predicate automatically. It needs no
separate wiring, but it does need a test proving the inheritance holds.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A read site is migrated but another is missed, leaving the fail-open path alive | Technical | Medium | **High** | One shared predicate called four times, never reimplemented per site; an acceptance test per site asserting a partial manifest blocks there |
| Incompleteness routes to BUILD and the daemon churns on work BUILD cannot close | Integration | Medium | **High** | Classify incompleteness distinctly from a gap verdict (ADR decision 2); assert routing in tests for both the group and serial paths |
| In-flight feature with a markdown report but no manifest blocks at rollout | Data | High | Low | Correct fail-closed behavior; self-heals via one re-audit. Call it out in the release note |
| Rebase pain — `artifacts.ts` touched by 29 unmerged spec branches (advisory `overlap-scan`, 2026-08-09) | Knowledge | High | Medium | Keep the diff narrow and additive; prefer a new exported helper over restructuring existing functions |
| Regression to `#655` delta-aware rebase preservation of `prd_audit` | Technical | Low | Medium | Explicit regression test that an unchanged-runtime rebase still preserves a *complete* audit |
| Agent under-declares the roster, so a short manifest passes | Technical | Medium | Medium | Option A cross-check against enumerable `FR-N` ids blocks a roster that understates the PRD; residual exposure limited to the 5 non-enumerable specs |

## ADRs Created

- `adr-2026-08-09-prd-audit-coverage-complete-manifest` — pass signal moves from a markdown
  blocking-row scan to a coverage-complete manifest, cross-checked against enumerable FR ids;
  one shared predicate for four sites; incompleteness re-dispatches `prd_audit`; partial resume
  rides the `#817` code stamp.

No existing ADR is superseded. No existing APPROVED ADR is violated by this design.

## Conditions

1. The completeness question is implemented **once** and consumed by all four sites; each site
   carries a test proving a partial manifest does not read as clean there.
2. Incompleteness is classified distinctly from a blocking-verdict gap and re-dispatches
   `prd_audit`; no path routes it to BUILD.
3. `docs/explanation/gates.md` and `docs/reference/steps.md` are updated in the same PR
   (`CLAUDE.md` Documentation Upkeep — a PR is not complete while its canonical docs are stale).
4. A regression test confirms `#655`'s delta-aware rebase preservation of a **complete**
   `prd_audit` still holds.
5. The rollout cost — one re-audit for in-flight features carrying only the old markdown report —
   is stated in the PR's release note.
