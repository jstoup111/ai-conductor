# Conflict Check: Config keys that validate but have no consumer (#1025)

**Date:** 2026-08-26
**Stories checked:** .docs/stories/config-keys-that-validate-but-have-no-consumer-inc.md (Stories 1-5)
**ADR corpus:** repo_wide (per `conflict_check.adr_corpus`)
**Result:** PASSED — zero blocking, zero degrading conflicts

## Corpus

Repo-wide sweep of `.docs/decisions/` (513 files; all titles/statuses read, 30 read in full,
recorded in architecture-review-2026-08-26-config-keys-that-validate-but-have-no-consumer-inc).
Examined (subject-overlapping) ADRs: the 28 listed in that review's Alignment section — notably
adr-2026-07-25-custom-step-completion-artifacts, adr-2026-08-03-fail-closed-decide-entry,
adr-2026-07-27-daemon-decide-kickback-halt, adr-2026-07-01-machine-scoped-operator-identity,
adr-2026-08-09-conductor-block-single-source-of-truth, adr-2026-07-04-autoresolve-state-and-config,
adr-2026-07-04-auth-failure-park-and-poll, adr-2026-08-07-project-teardown-hook-contract-and-containment,
adr-2026-06-30-self-host-detection-seam, adr-2026-07-03-pr-timing-self-host-precedence,
adr-2026-07-26-event-sink-registry-exhaustiveness, adr-2026-07-12-wired-into-contract,
adr-2026-08-11-deprecated-no-op-step-retirement, adr-2026-08-14-retire-build-review-wiring-rubric,
adr-2026-08-26-remove-retrospectives-one-shot, adr-2026-07-06-migration-gate-waiver,
adr-2026-08-03-ledgered-per-block-migration-execution, adr-2026-07-21-s-tier-pipeline-knobs,
adr-2026-07-27-project-config-scaffolder. Narrowed out: the remaining ~485 ADRs whose subjects
(daemon lifecycle, build gates, evidence, retro, PR flow, etc.) touch no story surface. Supersession
parsing: adr-2026-07-12-wiring-check-gate excluded as fully superseded/deleted machinery; partially
superseded ADRs (adr-2026-07-27-daemon-decide-kickback-halt) retained and compared.

## ADR-versus-story scan

The two-phase-retirement ADRs (adr-2026-08-11, adr-2026-08-14) oppose Story 2's hard-fail
removals in the abstract, but adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal
(APPROVED, later, explicitly scoped) carries the dated operator waiver resolving that opposition
before stories were derived — the stories implement the waiver-bearing ADR, so no live
ADR-versus-story conflict exists. All other examined ADRs align (see the architecture review's
Alignment section for per-ADR verdicts).

## Story-pair scan (all pairs, both directions)

- S1 (accept gate/kickback_target) vs S2 (removals): disjoint key sets; satisfying either leaves
  the other intact. No conflict.
- S2 vs S3: S2 deletes only the resolver-adjacent surface; S3 asserts the live
  `mergeable_autoresolve` block's behavior survives. Compatible by construction.
- S2 vs S5: registry totality is derived from the validator's post-removal accepted sets, so a
  removed key needs no declaration and an orphaned declaration fails — consistent both directions.
- S4 (conductor guard) vs S5: user-accepted `conductor` keys carry live consumer declarations
  (update-check flow); the guard constrains source, not acceptance. No oscillation.
- S5 totality vs sanctioned "valid but deliberately inert" keys (adr-2026-07-03-pr-timing
  precedent): resolved inside S5 by first-class `none + reason` declarations — satisfying
  totality does not force deleting inert keys, and vice versa. Checked both directions; no
  oscillation.

## Existing-story scan

Grep across `.docs/stories/` for every touched surface. All hits reference surviving behavior:
nested `harness_self_host.auth_park_timeout_minutes` (sandbox-auth-expiry-park,
isolate-daemon-build-auth-from-operator-oauth, bin-teardown), the live `mergeable_autoresolve`
block (auto-resolve-open-pr-conflicts — Story 3 explicitly preserves its contract), and
user-level `conductor:` semantics (update-check-config-single-source-of-truth,
non-daemon-projects-inherit-self-host-config — Story 4 strengthens, does not contradict, their
"user-level surface" assertions). No existing story references the removed keys.

## Verdict

Conflict check passed. No blocking or degrading conflicts; no resolutions applied; no ADRs
superseded. Proceed to /plan.
