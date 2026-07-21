# Complexity: Setup-triage must not report "setup failed"/park when bin/setup succeeded (#582)

Tier: S

## Rationale

- **Bounded correctness fix within one existing engine flow.** The change lives in the
  `fixSession` terminal branch of `engine/setup-triage.ts` (the dirty-tree-after-setup-success
  path) plus the coupled park-rendering in `engine/daemon-runner.ts`. No new module, no new LLM
  dispatch surface, no state-machine change.
- **No architecture / ADR / conflict ceremony.** The fix stays *inside* the APPROVED
  adr-2026-07-09-setup-failure-triage contract — it still parks (sub-decision 4) and still uses
  the existing quarantine mechanism to preserve strays (sub-decision 2). The park→proceed
  decision is explicitly untouched (see track doc scope boundary), so no ADR amendment is
  required.
- **Reuses existing primitives.** The residual-stray capture reuses the already-shipped
  `quarantine()` helper (refreshes `wip/setup-quarantine-<slug>` if present); the accurate HALT
  surfacing reuses `daemon-runner.ts`'s existing `contractOutcome`/`quarantineRef`/`preservedPaths`
  rendering (daemon-runner.ts:453-476) — only the message text and outcome fields change.
- **Two coupled seams, one contract.** `fixSession` emits a distinct outcome discriminator; the
  daemon-runner park renderer must stop hardcoding "setup failed" for an empty tail. A light
  cross-file agreement, not an architectural coordination.
- **Negative-path coverage required but small.** A genuine nonzero setup exit must still park as
  "setup-still-failing" (unchanged); one existing test (`setup-triage.test.ts:731`, the
  "porcelain dirty → park with dirty paths" case) must be updated to the new distinct outcome +
  capture, plus new happy/negative assertions. No integration harness, no schema/CLI/hook change.
- **No migration/waiver:** the touched files are engine internals, not any
  `CANONICAL_BREAKING_SURFACES` (bin/conduct CLI, skill symlink targets, hook wiring,
  settings.json schema).

Ceremony for Tier S: track + stories + plan; no architecture doc, no decisions doc, no
conflict-check.
