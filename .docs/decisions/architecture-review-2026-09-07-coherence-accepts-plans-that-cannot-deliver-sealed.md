# Architecture Review: Coherence accepts plans that cannot deliver sealed outcomes (engine half)
**Date:** 2026-09-07
**Stories reviewed:** none yet — pre-stories DECIDE review (technical track, tier M, lightweight mode)
**Verdict:** APPROVED WITH CONDITIONS

Scope boundary (binding, from `.docs/track/coherence-accepts-plans-that-cannot-deliver-sealed.md`):
land-time DECIDE only — `coherence-parse.ts`, `coherence-validator.ts`, tests, docs. The skill-text
achievability judgement ships in a separate operator session; no BUILD-time reroute; no plan
`## Coverage Check` carrier change.

## Feasibility

- **Parser widening is one branch.** `parseCoherenceArtifact` rejects any `criterion` row whose cell
  count is not exactly 6 (`coherence-parse.ts`, `cells.length !== 6`). Accepting 6 or 7 and parsing
  the seventh into an optional `correction` field on `CriterionCoherenceRow` touches one function; no
  legacy-row path changes (verified by reading the parser; 95%).
- **Bullet 1 of the intake needs no engine work.** `checkCriterionCoverage` already blocks any
  criterion row whose verdict is not `covered` (`criterion:verdict:<n>`), so once the skill emits
  `fail` the land already rejects. This feature adds the *what and where* — not the block (verified;
  98%).
- **Decision-id enumeration already exists at the call site.** `runCoherenceGate` builds the
  `adr-<stem>#D<n>` set via `parseAdrDecisions` + `formatArchitectureDecisionId` for the ADR layer;
  the correction-reference check reuses that set. Today it is built only when
  `required.layers.has('adr')`; the check must build it whenever a row carries an `architecture`
  correction (verified; 95%). An `architecture` reference with no ADR in the change set therefore
  resolves to "unknown decision" — correct, since the constraint the author names must be in the spec.
- **Waiver needs no change.** `parseCoherenceWaiver` validates against the validator's own reported
  gap-id set (dynamic vocabulary), so the two new ids and `criterion:correction-unknown-decision:<n>`
  are waivable with zero edits to `coherence-waiver.ts` (verified; 98%).
- **Discovery needs no change.** `daemon-backlog.ts` calls the same shared parser and reads shape
  only; a 7-cell row parses and is never required (verified via adr-2026-08-26; 95%).
- No new dependencies, config keys, events, schema, or infrastructure. Worktree-isolated: pure
  functions over committed text.

## Alignment

- **Governing, amended:** `adr-2026-08-31-coverage-binding-judge-step` D1 fixed the M/L carrier as a
  6-cell row "(unchanged shape)". This design widens it, so that ADR carries an additive amendment
  recording **D10** (correction cell grammar, gap ids, non-renaming, waivability) and **D11**
  (decision-id resolution reuse, no routing). Preferred over a new ADR per the repository's
  amendment-first convention; one ADR keeps owning the criterion-claim vocabulary.
- **Served, not violated:** `adr-2026-07-22-coherence-gate-placement-and-validation-split` — every
  added check is mechanical, model-free, at land. `adr-2026-08-24-evidentiary-defects-are-not-waivable`
  — a malformed seventh cell reuses the non-waivable `unparseable-criterion-row`; a well-formed `fail`
  with a correction is a coverage gap and waivable. `adr-2026-07-22-coherence-waiver-and-duplicate-claim`
  and `adr-2026-08-26` — no existing gap id or parse-failure reason is renamed; `criterion:verdict:<n>`
  stays for rows without the cell. `adr-2026-09-02-adr-decision-citability-contract` D1 — decision ids
  come only from `parseAdrDecisions`. `adr-2026-08-22-one-owner-per-review-question` and D6 of the
  amended ADR — the correction layer is a label; the engine never appends a task or routes to
  `plan`/`architecture_review`. The operator's standing rule that a `PLAN_GAP` halt is the correct
  terminal state is untouched.
- **Precedent to reuse (focused local pattern basis):** the diff-locality disposition
  (`adr-2026-08-23-diff-locality-is-an-authored-disposition`) — an authored, closed-vocabulary
  per-criterion cell that the engine requires and validates but never infers. Traits to preserve:
  parse-don't-validate at the parser (`isCriterionDiffLocalityDisposition` sibling), validator emits a
  positional gap id `criterion:<class>:<n>`, detail names the criterion verbatim. Allowed variation:
  the new cell is optional in grammar and conditional on verdict, where disposition is mandatory.
  Rediscovery seeds: `coherence-parse.ts` (`CriterionDiffLocalityDisposition`, `isCriterion…`),
  `coherence-validator.ts` (`checkCriterionCoverage`, `NON_NEGATIVE_CRITERION_DISPOSITIONS`).
- **State management:** the correction is a discriminated value (`{ layer: 'plan' }` |
  `{ layer: 'architecture', decisionId }`), not a free string plus a boolean — invalid combinations
  (architecture with no id) are unrepresentable after parse.
- **Diagram:** `.docs/architecture/coherence-accepts-plans-that-cannot-deliver-sealed.md` reflects
  this design (parser → criterion check → correction-reference check → report → unchanged waiver;
  discovery shape-only; BUILD/SHIP absent).

## Wiring Surface

| New/changed surface | Called from in production |
|---|---|
| `CriterionCoherenceRow.correction` (optional field) + 7-cell branch in `parseCoherenceArtifact` | Existing callers: `runCoherenceGate` (land) and `discoverBacklog` (`daemon-backlog.ts`, shape-only) — no new call site |
| `checkCriterionCoverage` per-layer gap ids and enriched detail | Existing call in `runCoherenceGate`; rendered by `renderGapReport` into the land rejection |
| Correction-reference check (`criterion:correction-unknown-decision:<n>`) | Inside `runCoherenceGate`, immediately after the ADR-layer decision-id enumeration, feeding the same `gaps` list `evaluateCoherenceWaiver` consumes |
| Docs: `docs/reference/artifacts.md` (coherence mapping shape), `docs/explanation/gates.md` (criterion layer) | Reader-facing; no runtime |

Early overlap scan (advisory): 24 stale `origin/spec/*` branches flag `coherence-parse.ts`; all
predate the file's extraction (adr-2026-08-26) and none is an active lane on this surface.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A landed artifact with a 7-cell row is dispatched by a daemon pinned to an older engine dist whose parser still requires 6 cells | Integration | Low | Medium | Discovery blocks it as `missing-coherence` with the line-level remedy (adr-2026-08-26 D3/D4 no-silent-loss) — recoverable, and the row only appears on `fail` rows, which never land unwaived |
| Author writes `architecture:` citing an ADR outside the change set | Data | Medium | Low | `criterion:correction-unknown-decision:<n>` names it; waivable with rationale |
| Skill half and engine half land in either order | Integration | Medium | Low | Engine accepts the cell as optional; a skill emitting the cell before the engine lands hits `unparseable-criterion-row` at land (fail-closed, loud) — land the engine first per the repository's engine-owns-vocabulary rule |

## ADRs Created

None. `adr-2026-08-31-coverage-binding-judge-step` amended additively (D10, D11).

## Conditions

- C1. The plan's `## Architecture Obligation Coverage` maps D10 and D11 to tasks with exact
  `Done when` evidence, and the decision-id set is enumerated for the correction check even when the
  `adr` layer is not otherwise engaged.
- C2. Tests pin: every existing 6-cell fixture parses byte-identically; a `fail` row without the cell
  still yields `criterion:verdict:<n>`; a seventh cell on a non-`fail` row is unparseable.
- C3. Docs updated in the same diff: `docs/reference/artifacts.md` coherence mapping shape and
  `docs/explanation/gates.md` criterion-layer paragraph.
