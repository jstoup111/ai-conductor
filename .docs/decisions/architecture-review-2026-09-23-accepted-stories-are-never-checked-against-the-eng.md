# Architecture Review: Accepted stories are never checked against the engine's own criterion extractor

**Date:** 2026-09-23
**Mode:** lightweight (Medium tier — §2 Feasibility and §4 Alignment only)
**Track:** technical (no PRD; acceptance criteria live in stories)
**Source:** intake jstoup111/ai-conductor#1744
**Stories reviewed:** none yet — this is the pre-stories pass; the review input is the explore
output and the confirmed technical intent.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | Clean. No new dependency, service, or infrastructure. The predicate is a pure function over text in an existing module that already exports its parsing primitives. |
| **Prerequisites** | None. `splitStoryBlocks`, `sectionBody`, and `listItems` already exist in `src/conductor/src/engine/story-criteria.ts` and are already imported by both target consumers' modules. |
| **Integration surface** | Three modules: `story-criteria.ts` (new export), `artifacts.ts` (`GATE_ONLY_PREDICATES.stories` rewired, `extractAuthoritativeStoryCriteria` re-routed), `engineer/land-spec.ts` (new land rung + refusal code). Below the 3-boundary flag threshold and no external API. |
| **Data implications** | None. No schema, no persisted state, no migration. The only durable artifacts read are `.docs/stories/**/*.md`, unmodified by this change. |
| **Performance risk** | Negligible. The predicate runs once per spec at land and once per `stories` gate evaluation, over one file. `listItems` is a single linear pass. |
| **Worktree isolation** | Unaffected. No ports, no services, no shared state, no `.env` surface. |

**Verified claims** (read directly from source at this HEAD, confidence 95%+ unless noted):

- `runCoherenceGate` has exactly one non-test caller, `engineer/land-spec.ts:573` — so the
  Medium/Large-only `unparseable-stories` refusal at `coherence-validator.ts:440` genuinely runs
  once per spec and never re-grades a merged spec. *Verified.*
- `GATE_ONLY_PREDICATES.stories` (`artifacts.ts:4021`) is a daemon step gate only; the `engineer`
  spec-PR path does not reach it. *Verified* by reading `land-spec.ts`'s validation sequence, which
  checks stub/DRAFT/approval/plan-reference and never criterion shape.
- `extractStoryCriterionIds` uses `listItems`; `extractAuthoritativeStoryCriteria` does not.
  *Verified* — `story-criteria.ts:99` versus `artifacts.ts:2044`.
- `criterionStorySection` (`conductor.ts:947`) indexes the authoritative list positionally with an
  ordinal derived from the `listItems` side, so a length mismatch returns `undefined` and
  `routePrdAuditPlanGaps` fails closed to a main-path gap. *Verified* by reading both functions.

**Corpus measurement** (faithful port of both parsers run over `.docs/stories/**/*.md` at this
HEAD; 519 files): 93 extract to zero authoritative criteria; 101 files carrying `## Story <id>`
headings produce different counts from the two parsers; 48 would fail the `stories` gate predicate.
135 of the affected files have no `.docs/shipped/` record. *Inferred, 80%*: "no shipped record" is a
proxy for "could still be built" and overstates the live set — some are abandoned, parked, or
shipped without a record. It is used here only as an upper bound on blast radius, which is the
direction that matters for the safety argument.

## Alignment

**Domain boundaries.** The predicate is placed in `story-criteria.ts`, the module that already owns
every primitive it needs. Placing it in `artifacts.ts` or `land-spec.ts` would put the judgement in
one consumer and make the other import from a peer, which is the coupling shape that produced the
divergence. No new coupling between domains is introduced; `artifacts.ts` and `land-spec.ts` both
already depend on `story-criteria.ts`.

**Pattern consistency.** This follows the established single-owner shape rather than departing from
it. `adr-2026-08-22-one-owner-per-review-question` D1 fixed an equivalent problem for review
questions; this applies the same principle to artifact-shape judgement. The land-side rung follows
the `adr-2026-08-21` D1 precedent for a land-only shape check, already cited as precedent inside
`adr-2026-08-23-criterion-layer-is-structural-at-land`.

**Governing-ADR check.** `adr-2026-08-23-criterion-layer-is-structural-at-land` (APPROVED) is the
closest existing decision and is **cited and applied, not superseded**: it governs the coherence
`criterion` row layer, a different artifact and a different question, but its retroactivity rule —
added strictness is admissible only where it runs at land and adds no BUILD or SHIP requirement — is
binding on this design and is carried into decision 3 of the new ADR. `adr-2026-08-09-adr-layer-gated-by-committed-adr-signal`'s
variable/invariant test also applies and points the same way: every accepted story necessarily has
criteria, so "this spec legitimately has none" is never the right answer and signal-gating would be
self-defeating. No existing ADR covers ownership of story-artifact readability, so a new one is
drafted rather than reused.

**State management.** No new state, no boolean flags, no state machine. The predicate returns a
verdict plus the failing story and the required shape; it is total over its input.

**Security boundaries.** No new endpoint, no new user input surface. The stories artifact is already
read by both consumers; this adds no new read.

**Production DI defaults.** Not applicable — no injected store, no in-memory default.

**Diagram accuracy.** `.docs/architecture/accepted-stories-are-never-checked-against-the-eng.md`
reflects this design and renders (checked with `ai-conductor render-diagrams --check`).

## Wiring Surface

| New/changed production surface | Where it is called from in production |
|---|---|
| Exported readability predicate in `src/conductor/src/engine/story-criteria.ts` | Two callers: the `landSpec` validation sequence in `src/conductor/src/engine/engineer/land-spec.ts`, reached from the `ai-conductor compose land` / `engineer land` command path; and `GATE_ONLY_PREDICATES.stories` in `src/conductor/src/engine/artifacts.ts`, reached from the daemon step-gate evaluator for the `stories` step. |
| New land-gate refusal code in `land-spec.ts` | Thrown by `landGateError` in the same validation sequence as the existing `stories-not-approved` and `plan-stories-reference` codes, surfaced to the operator through the `land` command's refusal output. |
| `extractAuthoritativeStoryCriteria` routed through `listItems` | No new caller. Existing production consumers are `artifacts.ts:1973` (`acceptance_specs` disposition evidence), `conductor.ts:961` (`criterionStorySection` → `routePrdAuditPlanGaps`), and `engineer/coherence-validator.ts:440` (`checkCriterionCoverage`, land-only). |

Early overlap scan over these paths: **no overlap detected, no open blockers.**

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Re-baselining fixtures that assert line-by-line extraction silently weakens them into asserting the new behavior without proving the parity invariant | Knowledge | Medium | Medium | Condition 1: the change must add a test pinning that both parsers return the same count for a wrapped-bullet story, not merely update expected strings |
| A merged spec whose stories file the predicate would reject stops building | Data | Low | High | Decision 3 confines strictness to land and the `stories` gate; condition 2 requires a test pinning that a merged spec with an unreadable stories file still builds |
| A spec mid-DECIDE when this ships cannot land until its stories file is fixed | Integration | Medium | Low | Accepted and recorded in the ADR's negative consequences; the refusal names the story and the required shape, so the fix is mechanical |
| The refusal message is accurate but unactionable, so authors cannot tell what to change | Knowledge | Medium | Medium | Condition 3: the refusal must name the failing story and state the required shape, and a test must assert both appear |

## ADRs Created

- `adr-2026-09-23-one-owner-for-accepted-story-readability` — APPROVED by the operator on 2026-09-23.
  Three decisions: (1) `story-criteria.ts` owns the readability judgement and both consumers call
  it; (2) both extractors list bullets through `listItems`, making the id alphabet and the criterion
  list ordinal-aligned by construction; (3) the strictness engages at land and at the DECIDE
  `stories` gate and adds no BUILD or SHIP requirement.

Cited and reused, not superseded: `adr-2026-08-23-criterion-layer-is-structural-at-land`,
`adr-2026-08-22-one-owner-per-review-question` D1, `adr-2026-08-09-adr-layer-gated-by-committed-adr-signal`.

## Conditions

1. **Parity is pinned, not assumed.** A test must assert that `extractAuthoritativeStoryCriteria`
   and `extractStoryCriterionIds` return the same count over a story with a hard-wrapped
   Given/When/Then bullet. Re-baselining an existing fixture's expected strings does not satisfy
   this.
2. **Merged-spec buildability is pinned.** A test must assert that a stories artifact the new
   predicate rejects still passes every BUILD-side consumer, so decision 3's bound is mechanical
   rather than prose.
3. **The refusal is actionable.** The land refusal must name the failing story and state the
   required shape (headed Happy Path / Negative Paths sections, one single-line Given/When/Then
   bullet per criterion), and a test must assert both are present in the message.
4. **Scope holds.** No migration, rewrite, or bulk amendment of the 93 zero-extraction or 101
   drifting stories files already on main, per the confirmed scope boundary in
   `.docs/track/accepted-stories-are-never-checked-against-the-eng.md`.
