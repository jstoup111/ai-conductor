# Architecture Review: Routed repair hosts a finding on a stack child that lacks its target file
**Date:** 2026-10-31
**Mode:** Lightweight (Tier M): §2 Technical Feasibility and §4 Architectural Alignment
**Inputs reviewed:** explore output and track `.docs/track/routed-repair-hosts-a-finding-on-a-stack-child-tha.md`
(scope: path evidence and D5 verification, no new halt, no finding split); approved diagram
`.docs/architecture/routed-repair-hosts-a-finding-on-a-stack-child-tha.md`;
`adr-2026-10-12-routed-whole-feature-repair` as amended through #3477; intake jstoup111/ai-conductor#3550.
**Verdict:** APPROVED WITH CONDITIONS

## Technical intent

1. **One citation resolver.** Every cited path is resolved against one `git ls-tree -r --name-only` listing
   of the leaf tip before it counts as evidence:
   - an exact file entry is kept as-is;
   - otherwise a citation that is the unique suffix of one listed file at a `/` boundary resolves to that
     file (a bare basename `register-artifact-cli.ts`, or a partial path `restack/restack-sync.ts`);
   - a citation that names a directory, or that suffix-matches several listed files, is dropped. It is
     neither an input nor an output;
   - a citation with no match is an output the repair creates, as D4 already states.
2. **Token cleanup.** `citedRepositoryPaths` also strips wrapping punctuation on the leading side of a
   token, such as `(`, `[` and `<`, as it already does on the trailing side. Today
   `(register-artifact-cli.ts)` yields `(register-artifact-cli.ts`.
3. **D4 inputs.** A routed item's prerequisite inputs are its resolved input files. They also cover the
   text fields that allocation renders into the item's rem blocks: task titles, rationale, criterion and
   governing clause. `selectHost` is unchanged and runs on those inputs. `prerequisitePaths` in the route
   record holds only resolved files.
4. **D5 verification.** `settleRoutedBuildClaim` and `verifyPrerequisiteClaim` read the claimed paths and
   the stored `prerequisitePaths` through the same resolver. A stored directory entry, which open route
   records written before this change may hold, is dropped and never fails a destination.
5. **No new halt.** Every resolved input is present at the leaf tip by definition, and D4 falls back
   to the leaf. So D4 always finds a host that holds every file the item's rem blocks cite, and this
   change adds no refusal. The operator chose fewer halts and more autonomy over a separate admission
   check (2026-10-31). Such a check would either pre-empt the #3445 admission fence's `mechanical` halt
   with a `needs-human` one, or never fire. The only halt the resolver can raise is the existing
   unreadable-leaf halt.

## Feasibility

- **Stack.** Plain git plumbing already used in this module. No new dependency, process or service.
  Verified (100%): `cannot-host.ts` and `prerequisite-claim.ts` already shell out to `git ls-tree`.
- **Root cause.** Verified (95%). Replaying `citedRepositoryPaths` on the `rem-as-built-R3` title
  returns `(register-artifact-cli.ts`, `src/conductor/src/engine/`, `rebase-translate.ts` and
  `restack/restack-sync.ts`. None of the three file tokens is a path at the repository root, so
  `classifyCitedPaths` files each as an output. The directory passes `git ls-tree <tree> -- <dir>/` on every
  child, so it is the only input, and child 1 hosts. The live record for
  `path-policy-still-decides-feature-ownership-by-fol` round r1 stores `prerequisitePaths:
  ["src/conductor/src/engine/"]` for finding `:6`, which matches.
- **D5 defect.** Verified (95%) by reading the code. `hasPaths` in `prerequisite-claim.ts` requires each path
  to equal one line of `ls-tree -r --name-only`, so a stored directory input can never match. Any claim from
  a host whose items cite a directory comes back unverified.
- **Prerequisites.** None. The route-record schema is unchanged: `prerequisitePaths` stays `string[]`.
- **Integration surface.** Four files in one module: `routing/cited-repository-paths.ts`,
  `routing/cannot-host.ts`, `routing/round-router.ts` and `routing/prerequisite-claim.ts`. The
  `conductor.ts` caller already passes the leaf tip and git runner. It changes only if the block-text fields
  are collected there rather than in the router.
- **Data.** Existing open route records keep working. Only the D5 read path sees their legacy directory
  entries, and point 4 drops them.
- **Performance.** One recursive listing of the leaf tip per round (verified 100%: 7,638 entries in this
  repo at HEAD, a single git call) replaces per-citation lookups. Closure-tree checks stay per input, as today.
- **Worktree isolation.** Read-only git object reads. No new shared state.

## Alignment

- **D4 (owner and host).** Preserved. The owner and host split, the upward-only move, the leaf fallback
  and the "absent means output" rule are all unchanged. The change defines a cited path more precisely:
  resolved against the leaf, and never a directory. Amended in place.
- **D5 (prerequisite claim).** Preserved. The verification order, the strictly-above rule, the
  transaction and the sync are unchanged. Only the path comparison becomes resolver-backed. Amended in place.
- **D3 (residue judgement).** Unchanged. `residue-default` still places an ambiguous item at the earliest
  candidate as its owner. With correct inputs, D4 then moves the host upward on evidence. That is the
  owner/host split the ADR already relies on, so #3550 needs no D3 change.
- **D6 and D7 (record and admission).** Unchanged. Resolution runs inside `routeAdmittedRound`'s
  no-mutation contract ("no allocation/write happens before ownership and tree readability are
  known"), and the #3445 admission fence keeps its precedence because no halt is added before it.
- **#3203 operator rounds.** Unaffected. Prerequisite claims stay disabled there, and operator rounds don't
  run through `routeAdmittedRound`.
- **Design principle.** Machinery by default: git computes which file a citation names and whether a
  child holds it. No judgement is added and no LLM output is re-parsed.
- **Pattern basis.** Local precedent is `selectHost`/`classifyCitedPaths` in `routing/cannot-host.ts`. They
  are pure readers over a `GitRunner`, return a `{ kind: 'halt', detail }` union instead of throwing, and
  never write refs. The resolver keeps that shape and lives beside them. Allowed variation: one listing call
  may serve several lookups.
- **Diagram.** The approved diagram matches this intent.

### Parallel work on the same ADR

`spec/rebase-base-refresh-revalidation-halts-needs-human` (#3477, unlanded) amends decisions 7, 8 and 14
of the same ADR. This spec amends decisions 4 and 5. The two sets of decisions share no text or
behaviour, and amendment notes are additive, so the specs can land in either order. Recorded as an
operator sequencing decision, condition 3.

## Domain Integrity

Skipped in lightweight mode. One note for BUILD: the resolver's per-citation result is a closed union
(input, output, dropped-directory, dropped-ambiguous), not a pair of booleans.

## Wiring Surface

- `resolveCitedPaths` (new, `routing/cannot-host.ts`): called by `routeAdmittedRound` for task-bound and
  residue items, and by `settleRoutedBuildClaim` / `verifyPrerequisiteClaim` on the routed-BUILD terminal
  claim path (`conductor.ts` → `settleRoutedBuildClaim`). It replaces the per-path classification in
  `classifyCitedPaths`.
- Block-text citations (new, `routing/round-router.ts`): `routeAdmittedRound` adds the citations from
  each item's task titles, rationale, criterion and governing clause to the item's resolver input,
  before `selectHost`.
- No new event, config key, CLI, HALT class or persisted field.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A basename that names a new file resolves to an unrelated existing file with the same unique name, moving the host upward needlessly | Technical | Low | Medium | Upward moves already happen on evidence and the leaf always qualifies. A test fixes the exact-then-suffix order |
| More findings host above their owner, so a child PR carries a fix to code a lower slice introduced | Technical | Medium | Medium | Accepted by the operator's scope (no split). The route rationale and `prerequisite-paths` reason record why |
| Dropping ambiguous citations hides the one file that would have moved the host | Technical | Low | High | The D5 claim path still lets a builder name the exact file, and a verified claim moves the host upward. Accepted 2026-10-31 |
| An open route record written before the change keeps directory inputs | Data | Medium | Low | D5 reads stored inputs through the resolver (point 4) |

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | Plan tasks and findings cite repository files by exact path, partial path or basename, so leaf-tree suffix resolution recovers the files they mean | inferred | 90% | yes | Citations stay unresolved and the miss remains | APPROVED by operator 2026-10-31 |
| A2 | Dropping a directory or ambiguous citation is safer than treating it as an input, which never fails, or halting on it, which wedges rounds on prose | inferred | 85% | yes | Mis-hosting persists, or routing halts more often | APPROVED by operator 2026-10-31 |
| A3 | The text `allocateFrozenBlocks` renders into a rem block is the gap's task title, rationale, criterion, parent task and governing clause | verified | 97% | yes | Host selection would miss files only block text cites | — |

## ADRs Created

None. No new structural decision: the change sharpens what D4 and D5 already define. Amendment notes are
added beside decisions 4 and 5 of `adr-2026-10-12-routed-whole-feature-repair`.

## Conditions

1. The plan's Architecture Obligation Coverage table carries a row for every decision (1–18) of
   `adr-2026-10-12-routed-whole-feature-repair`, because its amendment enters this spec's change set.
2. A test reproduces #3550: a three-child fixture whose finding cites a basename that exists only on the leaf
   hosts on the leaf, and a D5 claim from a host with a stored directory input verifies.
3. This spec and #3477 land independently, with no blocked-by edge (operator 2026-10-31).
4. No new halt or refusal is added. The admission fence and the existing unreadable-tree halts are the
   only stops on this path (operator 2026-10-31).
