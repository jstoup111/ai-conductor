# Architecture Review: Configurable push/PR timing (`pr_timing`)

**Date:** 2026-07-03
**Mode:** Lightweight (tier M) — feasibility + alignment; pre-stories full pass
**Inputs reviewed:** `.docs/track/configurable-pr-timing.md`,
`.docs/complexity/make-daemon-build-push-pr-timing-a-configurable-st.md`,
`.docs/architecture/configurable-pr-timing.md` (approved),
`.docs/architecture/sequences/configurable-pr-timing.md` (approved)
**Source:** jstoup111/ai-conductor#199 (operator-expanded to both publish flows)
**Verdict:** APPROVED

## Feasibility

- **Stack:** No new dependencies. All publish primitives exist: `findOrCreatePr` with
  `--draft` (`pr-labels.ts:341`), `markReadyForReview` (`pr-labels.ts:517`), injectable
  `GhRunner`/`GitRunner` factories with the `AI_CONDUCTOR_NO_REAL_EXEC` kill-switch
  (`pr-labels.ts:26-76`). `build-failure-escalation.ts:141-166` is a working model of
  push + draft-PR through that seam.
- **Config:** Follows the established chain — `HarnessConfig` + `knownTopLevelKeys`
  (fail-closed unknown keys, `config.ts:154-182`) + typed validation block
  (`owner_gate_cutover` precedent, `config.ts:480-490`) + total resolver
  (`resolved-config.ts:274-296` precedent). Read once at daemon startup
  (`daemon-cli.ts:184`), carried by `Conductor.config`.
- **Hook points verified:** daemon build start / loopGate step boundaries / post-rebase /
  finish all pass through engine-native code (`conductor.ts`), so early-draft needs no
  skill-contract change on the daemon side. Engineer side needs checkpoint commits — a
  real contract amendment, resolved in
  adr-2026-07-03-engineer-checkpoint-commits-idempotent-land.
- **Empty-branch edge:** `gh pr create` fails on a branch with no commits over base →
  draft PR creation is lazy (first ahead-of-base push). Encoded in
  adr-2026-07-03-pr-timing-config-key.

## Alignment

- **ADR-001 rebase loop:** untouched. No-dispatch keystone, satisfied predicate, and the
  bounded conflict_halt sub-path (adr-2026-06-29-rebase-conflict-resolution-dispatch) are
  unchanged; the new decision governs only the remote refresh after a successful rebase.
  No push during paused rebase / rebase-conflict HALT — consistent with
  `conductor.ts:508-511`. Force-push is contained to one engine-native site with
  `--force-with-lease` only (adr-2026-07-03-post-rebase-force-with-lease). Verified: no
  force-push exists in the codebase today, so containment starts clean.
- **Engineer land/handoff contracts:** land keeps every guard authoritative; commit step
  becomes stage-non-empty conditional; handoff gains a mark-ready path with create
  fallback. `land` already commits in place and tolerates pre-existing branch commits
  (`land-spec.ts:278-302`) — checkpoint commits do not violate its guards, only its
  empty-stage assumption. Details + negative paths in
  adr-2026-07-03-engineer-checkpoint-commits-idempotent-land.
- **Owner-gate / multi-operator / dedup:** no interaction. Daemon backlog reads only the
  merged base-branch tree (`daemon-backlog.ts:34-70`); intake dedup keys on
  source+sourceRef (adr-012); owner-gate evaluates only merged specs
  (`daemon-backlog.ts:356-379`). Open draft PRs are invisible to all three. The
  content-aware dedup ADR (adr-2026-07-03-committed-shipped-record-dispatch-dedup) keys on
  committed shipped records + spec hashes, also unaffected by open PRs.
- **EKS/isolated-remote constraint:** all new publish operations go through the
  `pr-labels.ts` injectable seam (adr-2026-06-30-self-host-detection-seam pattern) — swap
  the runner for platform identity/exec without touching callers. No local-machine
  assumptions added.
- **Default-inert convention:** `pr_timing` absent → `finish` → byte-identical behavior in
  both flows, including the auto-mode `/finish` prompt (`step-runners.ts:610-639`) and
  `handoff.ts:170`.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Force-push clobbers remote work | Data | Low | High | `--force-with-lease` only; single engine-native call site; one-daemon-per-repo rule makes daemon the lease holder |
| Early push fails silently and operator assumes visibility | Integration | Medium | Medium | Advisory failures are LOUD logs; terminal publish stays load-bearing; story must assert the loud log |
| `gh pr create` on empty branch fails | Integration | High (if unlazied) | Low | Lazy PR creation gated on ahead-of-base |
| land empty-stage failure after checkpoints | Technical | High (if unamended) | Medium | Idempotent-land amendment; negative-path test required |
| Draft PR left draft forever after advisory failures | Integration | Low | Medium | handoff/finish fallback to create path; mark-ready is terminal and load-bearing |
| CI cost of draft PRs during builds | Performance | High | Low | Accepted trade-off; opt-in per project |

## ADRs Created

- adr-2026-07-03-pr-timing-config-key (DRAFT → pending approval)
- adr-2026-07-03-post-rebase-force-with-lease (DRAFT → pending approval)
- adr-2026-07-03-engineer-checkpoint-commits-idempotent-land (DRAFT → pending approval)

## Conditions

None blocking. Stories must carry the negative paths named in the ADRs' follow-ups
(guard-still-fails-after-checkpoint, no-force outside post-rebase, no-push during
rebase HALT, loud advisory failure).
