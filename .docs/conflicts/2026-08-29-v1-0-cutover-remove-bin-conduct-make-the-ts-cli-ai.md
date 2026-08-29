# Conflict Check: v1.0 cutover — remove bin/conduct (2026-08-29)

**Scope:** 4 new stories vs all `.docs/stories/` + repo-wide APPROVED ADR corpus
(`conflict_check.adr_corpus: repo_wide`; 532 decision files, ~50 keyword hits, ~35 read in
full/excerpt — examined and narrowed-out sets recorded below).

**Result: Clean Pass — zero blocking conflicts remain.** Two findings were resolved during the
check by amending the new stories in place; no existing story or ADR was changed.

## Resolved during check

### 1. `--auto` disposition vs the shipped #1436 spec (contradiction, blocking — resolved)
**Stories involved:** new Story 2 vs shipped `remove-the-unattended-one-shot-inline-run-auto-the` Story 1
**Type:** contradiction. The shipped, Accepted story pins `--auto` as a guided non-zero rejection
naming `daemon start` and `docs/guides/running-the-daemon.md`; the new story's first draft
demanded a bare unknown-option error, which cannot satisfy that pinned message.
**Resolution:** new Story 2 amended in place — `--auto` keeps the guided rejection (runs nothing,
exits non-zero); only `--step`/`--log`/`--output` are unknown options (verified: none of the three
is registered in `cli.ts`, so no behavior change there). The shipped story and
`architecture-review-2026-08-26-remove-the-unattended-one-shot-inline-run-auto-the`'s
"kept — they pin the surviving rejection behavior" disposition stand unchanged.

### 2. Memory-store bootstrap invocation dies with bin/conduct (state gap, blocking — resolved)
**Parties:** new Story 2 vs `adr-2026-06-29-shared-memory-store-placement-and-durability` (APPROVED)
**ADR filename stem:** adr-2026-06-29-shared-memory-store-placement-and-durability
**Story ID:** Story 2
**Evidence:** the only automatic caller of the canonical store setup is `bin/conduct:887`
(`run_memory_store_setup`, delegating to the TS `memory setup` verb); the TS engine exposes the
verb but never auto-invokes it (verified: no caller in `conductor.ts`/`daemon-runner.ts`).
Deleting `bin/conduct` without a port silently regresses the ADR's "called once at bootstrap"
guarantee, and the reference guard cannot catch it.
**Resolution:** new Story 2 amended in place — the TS run path must invoke the idempotent
memory-store setup before sessions touch `.memory/`, with a test.

## Notes (non-conflicts worth carrying)

- `adr-2026-07-27-ancestry-proven-park-reconciliation` mentions the `bin/conduct` forwarding list
  + arg guard; `reconcile-parked` is dispatched by the TS `daemon` command, so deleting
  `test_conduct_arg_guard.sh` removes no live coverage (the TS CLI has its own bare-word guard,
  pinned by new Story 2).
- Release gate: real `## Migration` block mandatory; a waiver is explicitly wrong for behavior
  changes (`adr-2026-07-06-migration-gate-waiver`). `Release-Semver: major`
  (`adr-2026-07-03-version-gate-semver-escalation`).
- Governing/supporting ADRs verbatim anticipate every assertion:
  `adr-2026-08-26-music-vocabulary-player-composer-rename` (as amended 2026-08-29),
  `adr-2026-07-05-standalone-bin-update`, `adr-2026-08-09-checkout-is-sole-version-identity-authority`
  (the parity assertions' own stated endpoint is this deletion),
  `adr-2026-08-09-conductor-block-single-source-of-truth`,
  `adr-2026-08-09-bash-yaml-access-via-conduct-ts-config` (bash config access rides the TS CLI,
  never bash bin/conduct — deletion breaks no config read).

## Corpus record (repo_wide)

Examined in full/excerpt: the ~35 ADRs/reviews named above plus
`adr-2026-06-30-halt-based-release-gates`, `adr-2026-08-01-scoped-run-verb-release-surface`,
`adr-2026-07-22-headless-vs-guided-examples`, `adr-2026-08-03-ledgered-per-block-migration-execution`,
`adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting`,
`adr-2026-06-29-platform-adoption-and-removal-surface`,
`adr-2026-07-04-versioned-engine-store-atomic-flip`,
`adr-2026-07-06-installed-root-resolution-for-global-writes`, and this feature's own review.
Narrowed out: ~180 daemon/build/rubric reviews (`--auto` hits are the engine run-mode string),
~120 ADRs matching only boilerplate release-surface paragraphs, ~130 memory/telemetry/evidence
ADRs with unrelated symlink/CLI hits, ~30 pre-TS numbered ADRs. Fully superseded (excluded):
adr-2026-08-16-preservation-anchored-completeness-exemption,
adr-2026-08-15-verify-only-anchored-tautology-exemption,
adr-2026-07-21-completeness-as-build-review-rubric, adr-2026-07-12-wiring-check-gate,
adr-2026-07-25-content-addressed-full-suite-proof,
adr-2026-08-12-removal-anchored-tautology-exemption — none overlap.
