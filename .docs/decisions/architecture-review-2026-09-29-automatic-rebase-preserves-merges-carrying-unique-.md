# Architecture Review: Automatic rebase preserves merges carrying unique content

**Date:** 2026-09-29
**Mode:** Lightweight (Tier M), pre-stories, technical track
**Source:** jstoup111/ai-conductor#2498
**Input:** `.docs/track/automatic-rebase-preserves-merges-carrying-unique-.md` (Balanced scope),
`.docs/architecture/automatic-rebase-preserves-merges-carrying-unique-.md` (operator-approved)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | No new dependency. The design needs `git merge-tree --write-tree` (git ≥ 2.38), `commit-tree`, `patch-id --stable`, and `rebase -i` with `-c sequence.editor`. The local git is 2.53.0 (verified). `merge-tree --write-tree` is already a production dependency (`rebase.ts` `classifyProspectiveMerge`, `rebase-replay.ts`). |
| Prerequisites | None. Flattening activates only when `base..HEAD` contains a merge. |
| Integration surface | Three modules change behavior. `autoresolve.ts` replaces its own `git rebase --autostash` start and FR-9 subject capture with the shared primitive (operator-confirmed 2026-09-29, to remove duplicated replay logic). The other two are `rebase.ts` (`performRebase`, and the FR-9 subject input in the resolution path) and `rebase-translate.ts` (absorption pairs). There is also one additive union member in `types/events.ts`, plus its `EVENT_SINKS` row. That is within the Medium budget. |
| Data implications | No schema migration. `.pipeline/rebase-rewrites.json` gains entries of the existing old→new shape, and `rebase_conflict_halt` gains an optional field. |
| Performance | Flattening costs O(first-parent commits) `merge-tree` and `commit-tree` calls, twice (once in place, once as the dry run). Sub-second at the observed branch sizes (5 to 70 first-parent commits). |
| Worktree isolation | The todo file lives under `git rev-parse --git-path`. Objects are written only to the shared object store, which is safe across worktrees. No ports or shared files. |

**Load-bearing claims (verified by probe, 2026-09-29, objects-only, no refs left behind):**

- **Classification.** Tree identity classifies merges correctly. On the affected branch, 1 of 6
  merges re-merges to its own tree. Along the first parent, 3 of its merges are ancestry-only.
  Confidence 95%, verified.
- **Old path reproduces #2498.** Replaying the affected branch's 85 non-merge commits linearly with
  `merge-tree`, even onto its own merge base, conflicts after 2 commits at `6b52b5498` on the same
  files #2498 names. Confidence 95%, verified.
- **Flattening reproduces HEAD's tree in place.** Checked on 5 of 5 merge-bearing branches (5, 23,
  44, 63, and 70 commits). On the affected branch it replays cleanly (5 commits). Confidence 95%,
  verified.
- **First draft rejected.** The first-draft mechanics (remerge deltas plus a replay of every
  lineage) conflicted in place on 5 of 5 branches. Confidence 95%, verified.
- **`--rebase-merges` would lose content.** It drops manual merge-result edits. Confidence 85%,
  from the git documentation, not probed. This is not load-bearing for the chosen option.

## Alignment

- **Governing ADRs.** A repo-wide sweep of all 325 `adr-*.md` files found no APPROVED ADR that
  governs how the automatic rebase replays history. The replay strategy is an uncovered state and
  data-architecture decision, so a new ADR is required (§7). Two APPROVED ADRs whose assertions the
  design changes are amended additively, following the house pattern (D-numbered blockquotes):
  - `adr-2026-06-29-rebase-conflict-resolution-dispatch` **D2**: FR-9 compares against the
    engine-written replay list on a flattened replay.
  - `adr-2026-07-12-rebase-evidence-stamp-translation` **D10**: engine-recorded absorption pairs
    are resolved after patch-id, and preserve the no-laundering and shrink-only properties of D5
    and D7.
- **Consistent, no amendment needed.**
  - adr-2026-09-11-selective-post-rebase-verification: P, B, and O stay immutable, and the tree
    proof holds because the list is proven tree-equal to P.
  - adr-2026-07-03-post-rebase-force-with-lease: no push occurs during the dry run or a halt.
  - adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep: no new dispatch site. The sweep's autoresolve calls the shared primitive; its two sanctioned resolution call sites are unchanged.
  - adr-2026-07-04-resolution-worktree-lifecycle: `rebase --abort` still applies.
  - adr-2026-07-26-rebase-tail-current-branch-before-publication: a pre-mutation halt blocks
    finish.
  - adr-2026-09-23-engine-git-guard-on-agent-path: the recipe avoids refused commands.
- **Event spine.** The design passes the schema-not-file test in `.agents/skills/event-spine`. The
  new signal is one `ConductorEvent` variant with an `EVENT_SINKS` row
  (adr-2026-07-26-event-sink-registry-exhaustiveness). The halt extends `rebase_conflict_halt`
  (adr-2026-08-11-halt-events-ride-the-persisted-spine). There is no sidecar and no log line.
- **Machinery principle.** Classification, proof, and halting are all mechanical (tree identity).
  No LLM judgement is introduced, and the existing resolver keeps its scope.
- **Local pattern basis.** `rebase-replay.ts` `captureReplayIdentity` is the precedent for
  tree-only `merge-tree --write-tree` proofs through the injected runner. Preserve three traits: an
  explicit merge base, exit code 1 meaning conflict, and no worktree writes. Allowed variation: a
  chained replay instead of a single merge. Hint: `rebase-replay.ts`, `captureReplayIdentity` and
  `compareReplayTree`.
- **Scope boundary.** This is Balanced, as confirmed. Recovery-skill changes, a branch sweep, and a
  topology-preserving replay are excluded.

## Wiring Surface

- **Shared replay primitive (new export in `rebase.ts`, ADR D8).** Called from `performRebase` in place of its `git rebase --autostash` call, and from `autoresolve.ts` in place of its own rebase start at the open-PR resolution site. Both are existing production paths: the rebase `loopGate`, the re-kick path, and the mergeable sweep's autoresolve.
- **`flatten_refused` (new `RebaseOutcome` kind, ADR D5).** Handled by `runRebaseStep` (`conductor.ts`) and `resumeRebaseFirst` (`daemon-rekick.ts`), which write the HALT without dispatching the resolver. Autoresolve maps the refusal to its escalation reason `merge-flatten-refused`.

- **Flatten audit (internal to the shared primitive).** Invoked
  from `performRebase` after replay-identity capture and before any rebase command. That places it
  on the rebase `loopGate` (`conductor.ts`) and on the daemon re-kick path (`daemon-rekick.ts`),
  both existing `performRebase` callers.
- **Engine-written todo installation.** Also inside `performRebase`, as the replacement rebase
  command for the merge-bearing branch.
- **`rebase_merge_audit` (new `ConductorEvent` variant).** Emitted from `performRebase` on a
  successful flatten, and routed by its `EVENT_SINKS` row to `EventPersister`.
- **`rebase_conflict_halt.mergeAudit` (optional field).** Stamped at the existing emit site when
  the halt is a pre-mutation flatten refusal. It is rendered by the existing halt rendering in
  `daemon-cli.ts`.
- **Absorption pairs.** Passed in-process from `performRebase` to the existing
  `translateAfterRebase` hook (`opts.translateAfterRebase`) and consumed in `rebase-translate.ts`.
- **FR-9 replay-list subjects.** Consumed by `featureCommitsPreserved` through
  `resolveRebaseConflictsInner`, which is the existing caller.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Evidence or repair boundaries citing side-lineage commits resolve to a later point than before | Data | Medium | Medium | Amendment D10 absorption rule, shrink-only; residue stays loud (07-12 D4) |
| A rebase pick of a flattened commit trips the commit-msg attribution hook | Technical | Low | Medium | Condition 1: verify in BUILD |
| `-c sequence.editor` todo install interacts badly with `--autostash` | Technical | Low | Medium | Condition 2: RED test in a scratch repo |
| A flattened merge conflicts with the new base more often than expected, raising halt volume | Integration | Low | Low | The halt names the merge and gives the recipe; the event exposes counts for tuning |
| Autoresolve's tier-1 and tier-2 resolution meets a paused `rebase -i` state for the first time | Integration | Low | Medium | Story 9 negative path: a real-git test that pauses a flattened replay on the autoresolve path |
| An operator loses the merge topology they deliberately built | Knowledge | Medium | Low | The `Flattened-merge:` trailer and the audit event record every merge sha |

## ADRs Created

- `adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history`, with decisions 1 to 7.
- Amendment **D2** to `adr-2026-06-29-rebase-conflict-resolution-dispatch`.
- Amendment **D10** to `adr-2026-07-12-rebase-evidence-stamp-translation`.

## Conditions

1. BUILD proves the commit-msg hook does not reject, or is satisfied by, the flattened commit
   picks.
2. BUILD pins, with a RED test against a real scratch repository, that the engine-written todo is
   installed under `--autostash` and that the rebase result equals the dry-run tree.
3. Branches with no merge in `base..HEAD` keep today's command byte-for-byte (regression test on
   the invoked git arguments).
