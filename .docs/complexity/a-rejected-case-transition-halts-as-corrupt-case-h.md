# Complexity: A rejected case transition halts as corrupt case history (#3123)

Tier: S

## Rationale

- **One diagnostic seam, propagated.** `RemediationCaseStore.mutate` in
  `src/conductor/src/engine/remediation-case-store.ts` already parses the persisted state (`load`)
  and the proposed next state (`parseState(mutation.nextState)`) separately, but returns the same
  `malformed-state` reason for both (verified by reading `mutate`). The fix types the next-state
  failure as a rejected transition with its violated invariant and offending case and source ids,
  and carries that through `reconcileRemediationCases` and the build-review adjudication
  coordinator's existing failure paths.
- **No invariant or schema change.** The one-case-per-source rule, the persisted store format, and
  every read-path reason stay exactly as they are. Admitting a new concern at a resolved anchor is
  #2464; recurrence limits are #3124.
- **Conforms to the approved design; no ADR.** adr-2026-08-29-build-review-remediate-case-adjudication
  D5 requires the store to be validated fail-closed and leased for mutation. A rejected transition
  still writes nothing and still halts needs-human; only its classification and diagnostic change.
- **Extends the existing event spine.** The `remediation_adjudication_failed` member of the
  `ConductorEvent` union gains optional structured fields; its sink registration (persist only) is
  per type and unchanged. No new channel.
- **Documentation.** One recovery subsection in `docs/runbooks/stalled-or-stuck-feature.md`.
- **No migration or waiver.** The touched files are engine internals, not any canonical breaking
  surface (`bin/conduct CLI`, `skill symlink targets`, `hook wiring`, `settings.json schema`).

Ceremony for Tier S: track, stories, plan; no architecture diagram, architecture review,
conflict-check, or coherence-check.
