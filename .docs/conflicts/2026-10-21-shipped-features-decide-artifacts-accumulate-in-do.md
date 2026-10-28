# Conflict Check: Operator CLI prunes shipped features' DECIDE artifacts (#2963)

**Date:** 2026-10-21
**Stories checked:** `.docs/stories/shipped-features-decide-artifacts-accumulate-in-do.md`, Stories 1–6
**Result:** Clean. No blocking conflicts. One degrading conflict was found and resolved in the
stories. Three near-misses were folded into the stories and the ADR.

## Conflict: A local edit to a sealed plan cannot survive a prune without a halt

**Stories involved:** Story 4 (in-flight features survive a merged prune) vs protected-artifact seal
Story 1 and Codex hook-parity Story 1
**Files:** [.docs/stories/shipped-features-decide-artifacts-accumulate-in-do.md] vs
[.docs/stories/2026-07-27-protected-artifact-seal-self-amendment-1047.md],
[.docs/stories/codex-lacks-preventive-hook-parity-protected-artif.md]
**Type:** contradiction
**Severity:** degrading

**Description:** The original Story 4 negative path had an in-flight feature keep a local edit of
another stem's `.docs/plans` file through a prune "and the feature does not halt". `.docs/plans` is
sealed. Another feature's plan edit is refused at commit ("Given a staged change to
`.docs/architecture/`, `.docs/plans/`, or `.docs/stories/` belonging to another feature, when the
commit runs, then it is refused."). A changed protected artifact of a different feature halts the
seal ("Then the verdict is `{ ok: false, reason: 'Protected artifact changed: <path>' }` exactly as
before"). The criterion could not pass without weakening the seal.

**Resolution Options:**
1. Move the scenario to an unsealed prunable family (`.docs/coherence`).
2. Keep the plan path and drop the no-halt assertion.
3. Make the editing feature the shipped stem itself.

**Recommendation:** Option 1, chosen by the operator on 2026-10-21. Rebase behavior for a
modify/delete conflict is not proven for the in-flight rebase path, so the criterion now asserts
only that the edit is never silently discarded. Either the edited file is kept, or the rebase stops
naming the path. ADR D3's residual note was revised to match.

## Near-misses resolved

- **Undated-stem collision.** An undated marker such as `.docs/conflicts/alpha.md` can match both a
  shipped and an unshipped dated plan. This is consistent with
  `.docs/stories/step-applicability-is-fixed-repo-wide-decide-canno.md` ("the marker is treated as
  ambiguous"). Story 1 gained a negative path, and ADR D1 excludes and reports undated-only matches
  that hit more than one plan.
- **Singleton fallback.** `adr-2026-07-28-feature-aware-artifact-resolution` D3.4 ("When only one
  candidate exists, accept it as the legacy singleton fallback.") combined with smaller families can
  resolve a foreign artifact. Each rule holds alone, so this is not a story contradiction. It is
  recorded as ADR assumption A5 and accepted by the operator as a residual, and filed as #3338.
- **GitHub operation ownership.** `adr-2026-09-11-github-operation-ownership` D4 requires explicit
  authorization for unowned resources, and D2 forbids healing another operator's resources. ADR D4
  now uses the existing exact-request interactive approval for each remote write. The existing
  entry guard refuses the command in dispatched sessions. Story 2 gained negative paths for another
  operator's open `docs-prune/*` PR, for a daemon session, and for a declined approval.
- **Audit "refuses".** `.docs/stories/durable-shipped-record-enforcement-and-backfill-916-936.md`
  requires the audit to give every candidate one classification. Story 6 now makes a missing,
  never-deleted plan a per-row `unresolved` with reason `shipment-plan-pruned`. Repair alone refuses.

## Compatible overlaps (checked both directions)

- `adr-2026-08-23-committed-halt-record` D7 and `adr-2026-08-26-remove-retrospectives-one-shot` D5:
  amended by this spec. The halt-record story's "preserved rather than deleted" scope is the feature
  branch, not main after ship.
- `adr-2026-10-07-prune-base-inherited-deletions-from-the-seal` and
  `.docs/stories/base-inherited-artifact-deletion-deadlocks-both-se.md`: these supersede the 1047
  "ADDED or DELETED" rule for base-inherited deletions. docs-prune authors no feature-side deletion.
- `.docs/stories/abandoned-specs-are-kept-in-git-instead-of-the-iss.md`: docs-prune is the main-based
  change that story anticipated. Presence in `.docs/plans` still separates wanted from abandoned,
  because shipped stems are never wanted. The D6 lookup also covers its retired stems (noted in ADR
  D6).
- `.docs/stories/content-aware-shipped-work-dedup-never-re-dispatch.md`: dedup reads
  `.docs/shipped`, and "record without candidate is inert" supports Story 4.
- `adr-2026-07-25-fail-closed-durable-shipment-evidence` D3–D5: a docs-prune PR is classified
  `docs-only` (`not-applicable`) before its body is read, so it never records or repairs a ship.
  Post-merge reconcile verifies at the merge commit, which predates the prune.
- Repair publication (`<pr>/<slug>` branches) vs `docs-prune/<date>`: these are distinct refs, and
  neither pushes `main` or merges.
- `adr-2026-10-10-source-grounded-adversarial-plan-review-step` and
  `adr-2026-10-03-per-feature-step-applicability`: their markers are read only for dispatched stems,
  and shipped stems are never dispatched.
- Park and `reconcile-parked` refusing a pruned slug: an accepted ADR consequence.
- `.docs/stories/a-docs-only-spec-landing-silently-breaks-main-via-.md`: the corpus tests read only
  kept families and limits.
- No story or ADR requires the daemon, finish or CI to remove these artifacts automatically.

## ADRs examined

In depth:
- `adr-2026-08-23-committed-halt-record`
- `adr-2026-08-26-remove-retrospectives-one-shot`
- `adr-2026-10-07-prune-base-inherited-deletions-from-the-seal`
- `adr-2026-07-25-fail-closed-durable-shipment-evidence`
- `adr-2026-07-27-ancestry-proven-park-reconciliation`
- `adr-2026-07-28-feature-aware-artifact-resolution`
- `adr-2026-10-10-source-grounded-adversarial-plan-review-step`
- `adr-2026-10-03-per-feature-step-applicability`
- `adr-2026-07-22-coherence-waiver-and-duplicate-claim`
- `adr-2026-08-26-shared-coherence-parser-at-discovery`
- `adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts`
- `adr-2026-10-17-stacked-feature-publication-as-native-stack`
- `adr-2026-10-10-stacked-restack-journaled-replay`
- `adr-2026-09-11-github-operation-ownership`
- `adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep`
- `adr-002-engineer-store-and-retro-redirect`
- `adr-2026-09-20-halt-resolution-queue-derived-from-markers`

Scanned, no relevant claim:
- `adr-2026-06-29-track-marker-location`
- `adr-2026-07-22-coherence-gate-placement-and-validation-split`
- `adr-2026-07-26-daemon-decide-preseed-ownership`
- `adr-2026-08-03-fail-closed-decide-entry`
- `adr-2026-08-09-adr-layer-gated-by-committed-adr-signal`
- `adr-2026-08-09-adr-contradiction-detection-in-two-halves`
- `adr-2026-07-22-phase-scoped-docs-write-guard`

Narrowed out: every other approved ADR had no hit for prunable-family, retention, audit, repair,
seal, discovery-dedup or open-PR subject terms.

Excluded as superseded: the narrative-production half of `adr-002-engineer-store-and-retro-redirect`,
superseded by retro-removal D2. Its remaining half was examined.

## Stories examined

- `durable-shipped-record-enforcement-and-backfill-916-936`
- `abandoned-specs-are-kept-in-git-instead-of-the-iss`
- `a-halt-leaves-no-committed-pushed-record-for-the-o`
- `remove-retrospectives-full-and-micro-from-feature-`
- `phase-9.1-retro-signal-engineer-memory`
- `2026-07-27-protected-artifact-seal-self-amendment-1047`
- `base-inherited-artifact-deletion-deadlocks-both-se`
- `codex-lacks-preventive-hook-parity-protected-artif`
- `no-operator-command-to-reseal-a-protected-decide-a`
- `docs-guard-canonical-path-protection-2163`
- `block-edits-to-docs-spec-artifacts-during-build-an`
- `content-aware-shipped-work-dedup-never-re-dispatch`
- `step-applicability-is-fixed-repo-wide-decide-canno`
- `step-completion-globs-are-feature-unscoped-so-anot`
- `auto-resolve-open-pr-conflicts`
- `enforce-ownership-across-all-harness-github-operat`
- `a-docs-only-spec-landing-silently-breaks-main-via-`
- `batch-git-blob-reads-in-backlog-discovery-and-prot`
- `needs-human-halt-auto-resumed-at-dispatch-rewind-c`
- `a-change-to-one-stacked-child-cannot-be-carried-in`
- `custom-steps-work-only-in-this-repo-engine-hardcod`
- `auto-park-markers-written-to-the-worktree-s-daemon`
- `2026-07-03-intake-marker-plan-stem-keying`
- `shipped-is-fire-and-forget-no-reconciliation-sweep`

## Re-check

After the resolutions, the revised Story 1, 2, 4 and 6 criteria were rechecked against the same
corpus in both directions. No blocking conflicts remain.
