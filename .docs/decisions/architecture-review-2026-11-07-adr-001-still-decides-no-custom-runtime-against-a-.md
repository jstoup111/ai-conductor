# Architecture Review: ADR-001 still decides "No custom runtime" against a 106k-LOC runtime

**Date:** 2026-11-07
**Mode:** lightweight (Medium tier: §2 Feasibility and §4 Alignment only)
**Source:** `jstoup111/ai-conductor#1480`
**Inputs reviewed:** the explore output
(`.docs/track/adr-001-still-decides-no-custom-runtime-against-a-.md`: technical track, Balanced scope,
on-demand query), the complexity record and the operator-approved component diagram
(`.docs/architecture/adr-001-still-decides-no-custom-runtime-against-a-.md`).
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

**Stack compatibility.** No new package, service or infrastructure. The classifier is a TypeScript
engine module, and the subcommand is registered in the existing commander table in
`src/conductor/src/cli.ts`, next to `render-diagrams` and the other subcommands. Verified.

**Prerequisites.** None. The seams it reuses already exist on main: `adrApprovalStatus`
(`artifacts.ts`), `MANIFEST_KIND_LOCATIONS` (`feature-manifest.ts`) and land's ADR hard-gate block
(`engineer/land-spec.ts`). Verified.

**Integration surface.** Three modules: the CLI table, land and the new classifier. The classifier
depends only on the two existing seams. No external API.

**Data implications.** One tracked file is deleted: `.docs/decisions/001-harness-architecture.md`.
Because `.docs/decisions` is in `PROTECTED_ARTIFACT_DIRECTORIES`, the deletion must ride the spec PR
through land; a build cannot make it. Land stages with `git add -- .docs …`, which stages removals
(ADR assumption A1, inferred, 95%). No engine, skill or test reads the file. A grep for
`001-harness-architecture` finds only four `.docs` records, and the other "ADR-001" mentions refer to
`adr-001-rebase-insertion-mechanism` (verified). Each of those four records gets an additive
amendment note beside its citation. Three are not ADRs, so no land ADR gate applies to them. The
fourth, `adr-2026-09-28-skills-may-bundle-executable-helpers`, has no `## Assumptions` section, so the
ledger gate skips it, and its seven citable decisions satisfy the citability gate (verified,
`adr-assumption-ledger-scope.ts`). Amending it brings those decisions into this spec's coherence
obligations. No existing record is renamed or rewritten.

**Performance risk.** The query reads about 770 Markdown files once per invocation. Each is a small
file read and a regex pass. It needs no pagination and does no git calls.

**Worktree isolation.** Read-only; it uses no shared resource, port or database.

## Alignment

**Governing decisions reused, not duplicated.**
- `adrApprovalStatus` remains the single disposition reader (ADR decision 3). No second status
  parser is added.
- `adr-2026-10-24-per-feature-artifact-manifest` decision 2 keeps ADRs in the shared
  `.docs/decisions/` folder. Its decision 5 keeps repository-scoped corpora on legacy resolution.
  Reading the location from `MANIFEST_KIND_LOCATIONS` follows both and leaves the manifest itself
  unchanged.
- Land's existing ADR hard gates (approval, citability, canonical filename, assumption ledger) are
  unchanged. The new added-file shape rule runs alongside them.

**New structural decision.** A shared record-shape table read by both the CLI and land is a new
cross-module ownership seam, and the deletion breaks with the append-only ADR convention. Both are
recorded in `adr-2026-11-07-decision-corpus-query-and-known-record-shapes`.

**Pattern consistency.** Classifying by filename prefix matches how the engine already selects
records (`adr-*` in land and plan review, `architecture-review-*` and `technical-assessment-*` in
`artifacts.ts`). The content fallback is new, but it reuses the same `Status:` and `Verdict:` lines
the gates already read.

**State management.** Kind and disposition are closed unions:
`decision | review | assessment | reference | unclassified` and
`approved | superseded | other | undeclared`. No boolean flags.

**Consumer portability.** Consumer repositories receive records from two other harness writers:
`skills/prd/SKILL.md` writes `api-response-contract.md` and `skills/bootstrap/SKILL.md` writes
`styleguide.md`. Both are in the known-shapes table, so the land rule cannot refuse harness output.
Existing legacy records in any repository are grandfathered, and a repository with no corpus gets an
empty result with exit 0.

**Interaction with in-flight work.**
- #3418 (path policy reads the manifest) is landed and building. It does not touch the corpus
  classifier or land's ADR block.
- #3419 (spec 3, layout) is not yet specified. ADR decision 5 and assumption A4 bound the
  interaction.
- #782 (move ADRs) is an open intake that the kind-table seam accommodates.
- The overlap scan over the wiring paths found no overlap and no open blockers.

**Security boundaries.** The command is read-only, local and needs no credentials. Its only input is
the corpus file list and contents.

**Production DI defaults.** No DI surface and no stores.

**Diagram accuracy.** The component and sequence diagram for this stem matches the design above.

## Wiring Surface

| New surface | Production caller |
|---|---|
| Decision-corpus classifier module (known-shapes table, kind and disposition rules, corpus enumeration) | Called by the `decisions` subcommand action and by land's ADR hard-gate block |
| `ai-conductor decisions` subcommand | Registered in the CLI command table in `src/conductor/src/cli.ts`, dispatched by the existing `bin/conduct` / `ai-conductor` entry point |
| Land added-file shape rule | Runs inside `landSpec`'s existing ADR hard-gate step (`engineer/land-spec.ts`) over the change set's added `.docs` paths under the corpus directory |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Land does not stage the deletion of 001 | Technical | Low | Medium | Plan includes a land-time check that the change set lists 001 as deleted; land retains the worktree on failure |
| A harness writer adds a new corpus filename later and land refuses it | Integration | Low | Medium | Shapes live in one table; refusal names the file and the accepted shapes |
| #3419 relocates review records outside the kind table | Integration | Medium | Low | ADR decision 5 and the follow-up comment on #3419 and #782 |
| The new subcommand trips the release gate's CLI-surface classifier | Integration | High | Low | Plan carries the migration block or release waiver decision explicitly |

## ADRs Created

- `adr-2026-11-07-decision-corpus-query-and-known-record-shapes`: seven decisions; four
  load-bearing assumptions approved by the operator.

## Conditions

1. The deletion of `001-harness-architecture.md` and the four amendment notes are part of the spec PR
   change set, not plan tasks. Builds cannot modify `.docs/decisions`.
2. The plan states how the additive CLI surface satisfies the release gate (a migration block or a
   waiver), with the reasoning.
3. The follow-up comment on #3419 and #782 named in the ADR is posted before handoff completes.
