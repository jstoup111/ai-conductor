# Complexity: manual_test auto-mode marker record

Tier: M

## Rationale

Approach C changes a **gating** completion contract across three surfaces and must coexist
with several existing `manual_test` behaviors — more than a single-file Small fix, but with
no new models, auth, external integrations, or state machines that would make it Large.

Signals:

- **Integrations / surfaces touched (3):** a new `conduct-ts manual-test-record` CLI
  (engine), the `manual_test` completion predicate in `artifacts.ts` (SKIP-sentinel
  recognition), and the `manual-test` skill contract (every-exit-path record call). Plus the
  `buildRetryHint` `manual_test` case and CHANGELOG/README docs.
- **Existing-behavior coexistence (elevates from S):** the SKIP sentinel and record CLI must
  not collide with the #367 whitewash guard (keyed on FAIL rows + HEAD sha), the
  `manual_test`→build FAIL kickback, or the SHIP parallel-validation fan-out group. This
  cross-behavior risk is why conflict-check is retained.
- **Models / auth / state machines / external integrations:** none.
- **Estimated story count:** ~8 (skip-record happy, results-record happy, gate accepts
  SKIP sentinel, gate still rejects missing/whitewash, fail-closed write, skill calls CLI on
  every exit, retry-hint, and the D5 S-tier skip).
- **D5 (S-tier skip) addition:** a one-line `skippableForTiers: ['S']` change on the
  `manual_test` step def reusing the existing selector tier-skip path — small, precedented
  (`conflict_check`/`acceptance_specs`), and orthogonal to enforcement. Adds surface but does
  not change the tier: still **M** overall.

Direct precedent: `adr-2026-07-11-finish-step-engine-completion-machinery` (#499) was Tier M
and is the analog — engine-owned completion marker via a fail-closed record CLI.
