# Architecture Review: Stack-aware feature identity and per-child state foundation (#2940)

**Date:** 2026-10-03
**Mode:** Full pre-stories review (Large tier, technical track; no PRD, so the inputs are the explore
output and the operator-confirmed scope boundary)
**Inputs reviewed:**
- `.docs/track/engine-cannot-represent-more-than-one-branch-step-.md` (scope boundary);
- `.docs/complexity/engine-cannot-represent-more-than-one-branch-step-.md`;
- `.docs/architecture/engine-cannot-represent-more-than-one-branch-step-.md`;
- the APPROVED ADRs cited below;
- source at `833b75868`.

**Method:** Three independent design analyses covered branch identity, per-child state with the
recovery CLIs, and base, events and golden tests. A consolidated design followed, then an adversarial
red-team pass that raised 16 findings. Every finding was dispositioned below or by an operator
decision before the ADR was written. All evidence was read from source and committed artifacts, and
nothing was executed.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | TypeScript only, inside the existing engine. No new package, service or infrastructure. |
| Prerequisites | #2723's slice manifest and coverage-binding membership are shipped (`engine/plan-slices.ts`, `coverage-binding-envelope.ts:31-34`). No migration. |
| Integration surface | Crosses many modules by design: four branch parsers plus about 8 branch consumers, the conduct-state, gate-verdict and kickback-ledger stores, the event union, and three CLIs. Each crossing is a narrow seam: one identity module, one path seam, and one optional field. |
| Data implications | Additive only. With no child, no new directory, key or field is written, so persisted state, verdict paths and `events.jsonl` stay byte-identical. Per-child files reuse existing schemas. No backfill. |
| Performance risk | No new hot path. The leaf-exists check is one local `show-ref` per child-attributed GitHub write or halt-PR operation, and it never runs with no child. The extra overlap-scan globs are two patterns. |
| Worktree isolation | All new state sits under the worktree's own `.pipeline/` (live-boundary excluded, `live-boundary.ts:69`). There are no shared ports, databases or files. |

**Verified facts the design rests on** (confidence and basis; verified means read in source or
reproduced in a scratch repository):
- Four private slug parsers and two `DAEMON_BRANCH_PREFIX` definitions exist
  (`finish-record-cli.ts:275-288`, `halt-pr-reconciliation.ts:39-51`,
  `daemon-halt-pr-operations.ts:12,40-42`, `github-operations-cli.ts:83-88`). 100%, verified.
- `JSON.stringify` in the event persister drops absent keys with no key sort and no hash
  (`event-persister.ts:192-199`). An absent `child` is byte-neutral. 100%, verified.
- `readAllVerdicts` skips non-`.json` entries (`gate-verdicts.ts:256-260`), and the evidence
  incomplete-write probe matches only `.test-suite-evidence.*.tmp` (`full-suite-evidence.ts:156-158`).
  A `children/` directory is invisible to both. 100%, verified.
- `for-each-ref` patterns match per path segment. `feat/c*/*` over-matches within a segment
  (`feat/cool/x`), `feat/c[1-9]/*` does not, and no existing ref matches the child globs. 100%,
  verified in a scratch repository and against 632 `feat/daemon-*` refs.
- A branch named exactly `feat/c<k>` blocks `feat/c<k>/*` refs. `feat/c<k>/<slug>` coexists with
  `feat/daemon-<slug>`. 100%, verified in a scratch repository.
- Seven existing plan stems fail the strict spec-slug rule, through dotted `phase-9.0` stems and
  stems longer than 50 characters. The child slug rule is therefore "single non-empty segment". 100%,
  verified.
- Slice positions are unbounded positive integers with gaps (`plan-slices.ts:148-152`). The only
  sliced plan in the corpus uses positions 1–3. 100%, verified.
- The four graded/tested-base sites deliberately differ in fetch and failure policy, so a unified
  resolver would change three of them at N=1. 95%, verified per site.
- One worktree per feature switches between child branches, and a feature ships only when the leaf
  merges. 100%, verified against the operator-approved #2940 design (decision 8b, §4.7).

No load-bearing assumption is unconfirmed. Every residual one is either verified above or settled by
an explicit operator decision recorded in the ADR.

## Complexity

**High**, rated across the feature: many modules, the most-read state surfaces, and a byte-identity
constraint. The operator already split it: halt-to-leaf, the active-child cursor, the base override,
engine-site wiring, and child-capable evidence and cases went to #2942, and publication and teardown
to #2945. What remains is about 6–8 stories and 22–28 tasks. No spike is needed.

## Alignment

- **Machinery over prompts.** One identity module and one path seam make "is this branch this
  feature's?" and "where does this child's state live?" engine-computed, with drift tests guarding
  ownership. This follows the CLAUDE.md design principle.
- **Event spine.** The child is an optional field on existing `ConductorEvent` members. There is no
  new channel, sidecar or ledger. Event-spine skill verdict: extend the union, no exception needed.
  Per-child files are durable state, not telemetry.
- **Approved decisions honored without change:**
  - `adr-2026-08-09-one-pr-per-branch-halt-is-a-state` (no child PR exists);
  - `adr-2026-07-07-finish-record-primitive` D3 (the child refusal is a zero-write refusal);
  - `adr-2026-08-01-conduct-state-mutation-port` (per-child files go through the same port);
  - `adr-2026-07-11-pipeline-state-durability` D2 (enumerated deletes only);
  - `adr-2026-08-31-kickback-ledger-read-fails-closed` (same parser per file);
  - `adr-2026-07-11-verdict-aware-resume-entry` and
    `adr-2026-07-22-gate-evidence-code-validity-on-redispatch` (flat at N=1; #2942 extends them);
  - `adr-2026-07-08` leak triage (no change);
  - `adr-2026-09-29-plan-slice-manifest` D2 and D8 (no new importer of `plan-slices.ts`, no consumer
    of the flag). The consumer-boundary drift test stands unrelaxed.
- **Approved decisions extended additively:** each carries a `> **Amended 2026-10-03 by #2940:**` note.
  - `adr-2026-08-19-operator-step-rewind-through-the-mutation-port` D1–D5 (child coordinate);
  - `adr-2026-08-01-multi-proof-park-deletion-authority` amendment item 8 (daemon-owned includes
    children; children are never deleted);
  - `adr-2026-07-26-cross-dispatch-kickback-livelock-bound` D1 (per-child ledger location);
  - `adr-2026-09-29-plan-slice-manifest` D3 (configurable bound, implemented by #2941) and D6
    (membership is the child-identity source, and positions are immutable once children exist);
  - `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` D4 (`inspect --child`);
  - `adr-2026-09-11-github-operation-ownership` D2 (a child resolves to its feature only with the
    leaf present).
- **Superseded decisions:** none.
- **Diagram accuracy:** the approved diagram was updated in place (change log, 2026-10-03) to mark
  the parts #2942 implements.
- **Security boundaries:** the red-team's blocker (R1) was a widening of GitHub-write authorization
  for interactive `feature/<x>` worktrees, and it is closed by ADR decision 2. Every non-child input
  keeps today's logic verbatim. A child adds only a leaf-exists precondition on top of the unchanged
  committed-owner check, so a hand-made `feat/c1/<x>` gains no more than a hand-made
  `feat/daemon-<x>` has today (red-team vector g, cleared).
- **Production DI defaults:** no in-memory store is introduced. Every per-child store is the existing
  filesystem store instantiated at a child path.

### Focused local pattern basis

- **Golden fixtures.**
  - *Role:* precedent for the N=1 golden suite.
  - *Traits to keep:* committed fixture files headed with the commit they were recorded from,
    exercised through the production coordinator with injected git, gh and step-runner fakes.
  - *Why it applies:* it is this repository's accepted way to prove "unchanged output" across a
    refactor.
  - *Allowed variation:* different surfaces and three flag/slice cells.
  - *Rediscovery hints:* `test/engine/pr-body-regions-baseline.test.ts`,
    `test/fixtures/pr-body-regions-baseline-*.md`, and
    `createProductionFinishPublicationCoordinator`.
- **Per-path store instantiation.**
  - *Role:* precedent for per-child stores.
  - *Traits to keep:* a store is constructed from a path, holds its lease per path, and treats a
    missing file as the absent base case.
  - *Why it applies:* it gives per-child isolation with no schema change.
  - *Rediscovery hints:* `createFilesystemConductStateStore`, `withKickbackLedgerLease`, and
    `remediationCaseStorePath`.
- **Operator CLI flag maps.**
  - *Role:* precedent for the `rewind` argument rewrite.
  - *Traits to keep:* an allowlisted flag map, and an unknown or malformed form returns null so the
    top-level fallthrough is unchanged.
  - *Rediscovery hints:* `detectHaltClearCommand` and `detectKickbackBudgetCommand` in `cli.ts`.

## Domain Integrity

| Principle | Assessment |
|---|---|
| No primitive obsession | `ChildId` is a branded integer from `parseChildId`, never a raw number. Branch identity is a discriminated union, never a bare slug string. |
| Parse, don't validate | Branch names are parsed once, in the identity module. `--child` is parsed once at CLI dispatch. Consumers take typed results. |
| Invalid states unrepresentable | A `child` identity cannot carry an out-of-range id or a multi-segment slug. "No child" is `undefined` only, never `null` or `0`. Per-child files never mix with flat keys. |
| Semantic types | `ChildId` and `FeatureBranchIdentity` name what the value is. |
| Exhaustive matching | Consumers switch over the identity union's `kind` with no catch-all default. Each consumer's explicit `unrecognized` arm reproduces today's behavior. |

## Wiring Surface

Each new production surface, and where it is called from in production:

| Surface | Production caller (design-time commitment) |
|---|---|
| `feature-branch-identity.ts` `parseFeatureBranch` and `featureSlugOf` | `finish-record-cli.ts` (`conduct finish-record`); `halt-pr-reconciliation.ts` (daemon halt-PR sweep); `daemon-halt-pr-operations.ts`; `github-operations-cli.ts` (`ai-conductor github-operation`); `park-reconciliation.ts` (daemon park sweep) |
| `parseFeatureRef` and `CHILD_REF_GLOBS` | `engineer/intake/overlap-sources.ts` (intake overlap and `overlap-scan`) |
| `isDaemonOwnedBranchName` | `park-reconciliation.ts` shipped-record precondition |
| `leafBranchFor` and `LEAF_PREFIX` | `daemon-deps.ts` worktree creation, `mergeable-sweep.ts` teardown, `daemon-cli.ts` shipped-record probe and CI-fix head, `halt-pr-reconciliation.ts` leaf probe |
| `childBranchFor` | the identity module's own canonicalization round-trip inside `parseFeatureBranch`, so a non-canonical `feat/c01/x` is rejected. #2942's `resolveChildBase` becomes a second caller. |
| `ChildId`, `parseChildId` and `MAX_CHILD_ID` | `--child` parsing in `rewind.ts`, `task-cli.ts` and `cli.ts`, reached through `index.ts` CLI dispatch |
| `pipelinePathFor` and the child-aware `verdictPath`, conduct-state store path and kickback-ledger read | `rewind --child` (reads and writes child conduct-state and gate verdicts); `kickback-budget inspect --child` (reads the child ledger); `task --child` (validates membership through the envelope); fresh-session `clearKickbackLedger` at `conductor.ts` (enumerates child ledgers) |
| Event `child` field | `operator_rewind` emitted by `rewind --child` |
| `stacked_prs.max_slices` | none in this ticket (contract only; #2941 adds the key and its land consumer) |

Child-valued paths are statically reachable from `index.ts` dispatch with an argv-supplied child.
They are exercised in production once #2942 creates child state. Until then the as-built gate should
record them as `UNEXERCISED`, never as unreachable. The expected signatures are an
`operator_rewind` record carrying `"child":`, and a `children/<k>/gates/<step>.json` write.

**Advisory overlap scan** (`ai-conductor overlap-scan` over the paths above): two stale spec branches,
`origin/spec/daemon-self-host-guardrails` and `origin/spec/self-host-phase6-wiring`, last updated
three months ago, touch `daemon-deps.ts`, `daemon-cli.ts` and `conductor.ts`. No action is needed.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A parser migration changes output for an input accepted today, regressing every daemon feature | Technical | Medium | High | Decision 2: non-child logic moves verbatim. Table-driven parity tests cover every accepted input, including degenerate ones. |
| An N=1 byte drifts in state, events, status, dashboard, PR body or the Cost block | Data | Low | High | Structural N=1 (no child writes nothing new), plus the golden suite committed before any production change, in three flag/slice cells. |
| GitHub-write authorization widens | Security | Low (after R1 fix) | High | Decisions 2 and 3, parity tests over the scope check, and the leaf-exists precondition. |
| Flat readers miss child state once children exist | Technical | Certain at N≥2, zero here | High | The ADR names every flat reader as a #2942 obligation, and no producer of children exists until then. |
| Hand-made `feat/c<k>/…` or bare `feat/c<k>` refs | Integration | Low | Medium | Attribution is not authority (decision 3), the reserved namespace and creation probe (decision 4), and strict glob post-filtering. |
| Slice positions change after children exist | Data | Low | High | Decision 7's immutability contract. The guard comes with the ticket that creates children. |
| `rewind --child` leaves downstream state inconsistent | Technical | Low | Medium | Decision 13's demotion set (target onward in child k, every child above k, downstream whole-feature steps) through the port. |
| The golden suite misses a surface a later task changes | Knowledge | Medium | Medium | The matrix covers every surface in the scope boundary. Parser migrations are covered by parity tables, and normalization is limited to timestamps and the fixture root. Interval timings and the Time block are deliberately not golden-tested (operator decision). |

## ADRs Created

- `adr-2026-10-03-stacked-child-plans-identity-and-state`: **APPROVED** by the operator on 2026-10-03.

Additive amendment notes were added to six existing APPROVED ADRs, listed under Alignment. No ADR is
in DRAFT.

## Red-team disposition

| ID | Finding | Disposition |
|---|---|---|
| R1 | GitHub-operations scope widened for `feature/<x>` | Fixed: decision 2 |
| R2 | `rewind --child` vs D3 downstream demotion | Fixed: decision 13, operator-confirmed |
| R3 | Per-child ledger makes cumulative cap per child | Accepted as operator intent: decision 9, enabled by #2942 |
| R4 | Reseal changing positions orphans children | Decision 7, guard implemented by #2942 |
| R5 | `--child` accepted for a flag-off sliced feature | Fixed: existing child state required, plus a third golden cell |
| R6 | Flat-reader blindness at N≥2 | Enumerated in the ADR as #2942 obligations |
| R7 | Seams reachable only through a constant "no child" | Operator chose option B: ship only what CLIs reach and fix the contracts |
| R8 | Leaf vs child-absence conflation | Fixed: decision 6 |
| R9 | Over-broad drift test | Fixed: allowlist the migrated consumers |
| R10 | Fresh-session ledger clear misses children | Fixed: decision 8 |
| R11 | Overlap glob post-filter ordering | Fixed: decision 1 |
| R12 | Park branch-listed path could delete a child | Fixed: decision 2 |
| R13 | Golden coverage gaps | Fixed: decision 14; parity tables for parsers. The stores deferred to #2942 are out of this suite. |
| R14 | `raise`/`reset --child` as a dead surface | Fixed: not offered until #2942 |
| R15 | Leak triage unchanged vs scope wording | Recorded in the scope boundary |
| R16 | `rewind` malformed-argv text drift | Fixed: decision 13 (identical fallthrough) |

## Conditions

1. **The plan's first task commits only the golden fixtures and their tests.** There is no production
   diff in that task, and the fixtures are recorded from the pre-change base. Every later task keeps
   them green, and golden test files import no module this ticket creates.
2. **Every parser migration ships with a table-driven parity test** over every input the old parser
   accepted, including bare `feat/daemon-`, bare `spec/`, `feature/<x>`, trailing-hyphen slugs and
   nested remainders. The test asserts identical output, exit code and message.
3. **The drift test allowlists exactly the migrated consumers.** No production module outside the
   identity module may introduce new branch-literal identity checks.
4. **No production module imports `plan-slices.ts`, references `stacked_prs`, or uses the capitalized
   slice-section token.** `test/engine/plan-slices-consumer-boundary.test.ts` stays unmodified and
   green.
5. **No primitive without a production caller.** The Wiring Surface table is the contract.
   `stacked_prs.max_slices` is not added in this ticket.
6. **Runbook and reference updates ship in the same feature, through the project's
   `maintain-documentation` step, not as plan tasks.** They cover `docs/reference/cli.md`,
   `docs/runbooks/stalled-or-stuck-feature.md`, `docs/runbooks/worktree-and-evidence-recovery.md` and
   `docs/reference/artifacts.md`. Single-PR recipes stay unchanged, and a child-form subsection is
   added. Documentation goes in operator runbooks and the CLI reference only, never in shipped skill
   text.

## Blocking Issues

None.
