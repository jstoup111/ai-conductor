# Complexity: build-review accept and findings refuse every stacked-feature child (#3448)

Tier: S

Rationale:
- **Production code.** Two files change.
  - `src/conductor/src/engine/build-review-cli.ts`: the `findings` and `accept` dispatchers read
    the child-scoped aggregate and kickback ledger, and their refusals name the cause.
  - `src/conductor/src/cli.ts`: the `build-review accept` grammar detector and its commander
    help accept an optional `--child <k>`.
- **Scope.**
  - One optional CLI flag is added, mirroring the existing `--child` of `findings` and
    `resolve-case`.
  - Nothing else is new: no module, model, persisted schema, event type, state machine or
    external integration.
  - The refusal events keep their `reason` values.
  - `bin/conduct` is untouched, so the self-host release gate flags no breaking surface.
- **Architecture.** The change conforms to existing APPROVED decisions and needs no ADR:
  - `adr-2026-10-07-per-child-build-region` D4 puts region verdicts and kickback-ledger gate
    entries under `.pipeline/children/<k>/`.
  - D9 of the same ADR makes `build_review` child-local.
  - D10 of the same ADR has every kickback-ledger caller pass the active child.
  - `adr-2026-10-20-operator-acceptance-is-durable-case-state` D9 keeps the disposition store
    feature-scoped.
  - `adr-2026-08-13-stable-build-review-finding-dispositions` D4 keeps `accept`'s exact lap,
    exact finding, TTY and operator-identity requirements. `--child` only selects whose current
    lap those requirements are checked against.
  - The live gate already writes these paths. Only the two CLI readers diverge.
- **Stories.** Three are expected: child-scoped `findings`, child-scoped `accept`, and
  cause-naming refusals with flat features unchanged.

Per the Small tier rules, architecture-diagram, architecture-review, conflict-check,
coherence-check and plan-review are skipped.
