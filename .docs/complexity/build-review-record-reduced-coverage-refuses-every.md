# Complexity: build-review record-reduced-coverage refuses every stacked-feature child (#3498)

Tier: S

Rationale:
- **Production code.** Four files change, each by a small amount.
  - `src/conductor/src/engine/build-review-cli.ts`: `dispatchBuildReviewRecordReducedCoverage`
    reads the selected child's aggregate (initial read and in-lease recheck) and kickback ledger
    through the child-scoped readers #3448 added. Its refusals name the artifact and the reason.
  - `src/conductor/src/cli.ts`: the `record-reduced-coverage` grammar detector and its commander
    help accept an optional `--child <k>`.
  - `src/conductor/src/engine/build-review-halt-render.ts`:
    `renderExhaustedMechanicalBuildReviewHalt` takes an optional child and prints `--child <k>` in
    its recovery command.
  - `src/conductor/src/engine/conductor.ts`: the one exhausted-allowance halt call site passes the
    active region child it already holds.
- **Scope.**
  - One optional CLI flag is added. It mirrors the existing `--child` of `findings`, `accept` and
    `resolve-case`.
  - Nothing else is new: no module, model, persisted schema, event type, state machine or
    external integration.
  - The refusal and acceptance events keep their `type` and `reason` values.
  - `bin/conduct` is untouched, so the self-host release gate flags no breaking surface.
- **Architecture.** The change conforms to existing APPROVED decisions and needs no ADR:
  - `adr-2026-10-07-per-child-build-region` decision 4 puts region verdicts and kickback-ledger
    gate entries under `.pipeline/children/<k>/`.
  - Decision 9 of the same ADR makes `build_review` child-local.
  - Decision 10 of the same ADR has every kickback-ledger caller pass the active child, and has a
    cap halt name the child.
  - `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` D6 keeps the command's exact-lap,
    TTY, operator-identity and exhausted-allowance requirements. D9 keeps the record
    feature-scoped with no expiry. `--child` only selects whose current lap and allowance those
    requirements are checked against.
  - `adr-2026-10-20-operator-acceptance-is-durable-case-state` D9 keeps the disposition store
    feature-scoped.
  - The live gate already writes these paths. Only this CLI reader and the halt text diverge.
- **Delivery.** The operator asked for sliced delivery. `evaluateStackEligibility`
  (`src/conductor/src/engine/plan-slices.ts`) requires tier M or L for stacking. The operator then
  chose to keep the honest Small tier and ship a single PR. So there is no `## Slices` section and
  no `Stacked-Delivery` sign-off.
- **Stories.** Three are expected: child-scoped recording with the child's allowance, a child
  halt that prints a working command, and cause-naming refusals with flat features unchanged.
