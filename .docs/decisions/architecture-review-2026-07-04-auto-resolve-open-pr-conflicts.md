# Architecture Review: Auto-Resolve Merge Conflicts on Open Watched PRs

**Date:** 2026-07-04
**Mode:** lightweight (tier M) — feasibility + alignment
**Inputs reviewed:** PRD `.docs/specs/2026-07-04-auto-resolve-open-pr-conflicts.md` (FR-1..16),
architecture `.docs/architecture/2026-07-04-auto-resolve-open-pr-conflicts.md` + sequence
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack:** no new dependencies. Every stage maps to existing engine modules:
  `mergeable-sweep.ts` (detection, labels), `rebase.ts` (`performRebase`-style rebase driving,
  deterministic CHANGELOG resolver, `resolveRebaseConflicts` bounded skill loop,
  `featureCommitsPreserved`/`isBranchCurrent` guards), `worktree-shared.ts` (worktree
  add/remove), `pr-labels.ts` (REST label ops + `prMergeState`).
- **Genuinely new engine surface:** (a) the sweep's CONFLICTING dispatch decision with
  attempt/cooldown gating; (b) a `.docs` keep-both deterministic resolver alongside the
  existing CHANGELOG one; (c) a deterministic suite-invocation seam — **none exists today**;
  the conductor only runs tests through Claude-driven build steps. FR-10 therefore requires a
  configured suite command (see adr-2026-07-04-autoresolve-state-and-config).
- **Prerequisites:** one new config block in `.ai-conductor/config.yml`; watch-entry schema
  extension (backward-compatible — old entries read with zero attempts).
- **Integration surface:** git, gh (existing runners), tmux/Claude dispatch for Tier 2
  (existing `/rebase` dispatch path). No new external systems.
- **Data implications:** none beyond the jsonl watch registry; no migrations.
- **Performance:** a resolution (worktree + rebase + suite) is minutes-scale; must not stall
  the sweep's label pass for other PRs — resolution runs after the label pass, serially
  (Condition 3).

## Alignment

- **ADR-001 (rebase insertion, engine-native, APPROVED)** and
  **adr-2026-06-29-rebase-conflict-resolution-dispatch (APPROVED)** confine prompt dispatch to
  the `conflict_halt` sub-path of `runRebaseStep` at finish time. This feature runs the same
  bounded sub-loop from a second call site (the sweep). That is a genuine widening of the
  dispatch exception → amending ADR **adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep**.
  Detection, guards, and the satisfied predicate remain engine-native, preserving ADR-001's
  spirit.
- **adr-2026-07-03-post-rebase-force-with-lease (APPROVED)** already establishes
  `--force-with-lease` (never bare `--force`) as the only sanctioned force-push and relies on
  one-daemon-per-repo for lease coherence. This feature adopts it unchanged; a lease rejection
  is an escalation, never a retry-with-force. No amendment needed.
- **Label mutations** must go through the REST helpers in `pr-labels.ts`
  (`gh pr edit --add-label` is broken by the Projects-classic sunset — PR #172 precedent).
- **No-ad-hoc-rebase rule:** this mechanism is a *sanctioned* rebase path, like the finish-time
  step; it is daemon-owned and never runs mid-build (eligibility explicitly excludes slugs
  with a live build worktree — see adr-2026-07-04-resolution-worktree-lifecycle).
- **Worktree isolation:** resolution uses a dedicated transient worktree with the existing
  `prepareWorktree` namespace pattern so the suite run cannot collide with other worktrees'
  databases/resources.
- **State management:** attempt count, last-attempt timestamp, and escalation live on the
  watch entry (single per-PR record, pruned with the entry); the sticky needs-remediation
  label remains the operator-visible off-switch (matches existing sweep semantics, FR-12..14).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Race with rekick/build push landing between resolution start and push | Integration | Low | Medium | `--force-with-lease` fails safe → escalate (FR-11); skip slugs with live build worktrees |
| Deterministic .docs keep-both mis-merges a genuinely conflicting doc | Data | Low | Medium | Scope keep-both to additive parallel-artifact collisions only; suite + guards still gate; escalate anything ambiguous |
| Suite command misconfigured → pushes unverified or never pushes | Technical | Medium | High | Fail-closed: no configured suite command → no push, escalate with concrete reason |
| Sweep tick stalls while a resolution runs | Performance | Medium | Low | Resolve after the label pass completes; serial, max one resolution per tick |
| Tests spawning real daemons/sessions leak processes | Knowledge | Medium | Medium | Injected runners + env kill-switch in vitest setup + one real-binary smoke (established convention) |

## ADRs Created

- `adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep` — amends
  adr-2026-06-29-rebase-conflict-resolution-dispatch (second sanctioned dispatch site).
- `adr-2026-07-04-autoresolve-state-and-config` — watch-entry schema extension for
  attempt/cooldown state; new config block incl. fail-closed suite command.
- `adr-2026-07-04-resolution-worktree-lifecycle` — dedicated transient `resolve-<slug>`
  worktree; remove on success and failure; skip slugs with a live build worktree; namespace
  prep for suite isolation.

## Conditions

1. **REST-only label mutations** via `pr-labels.ts` helpers (PR #172 precedent).
2. **Test hygiene:** all new engine paths use injected git/gh/dispatch runners; the production
   spawn path is guarded by the env kill-switch set in global vitest setup; include one
   real-binary smoke for any new external-CLI argv.
3. **Serial resolution, label pass first:** at most one PR resolution per sweep tick, run
   after all label updates, so watch freshness never degrades (NFR-3).
4. **Keep-both resolver scope:** applies only to conflicts strictly inside `.docs/` artifact
   paths; anything touching code, config, or mixed hunks falls through to Tier 2.
