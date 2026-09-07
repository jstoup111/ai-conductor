# Complexity: coverage-binding-retries-past-its-3-3-budget-when-

Tier: S

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None — `StepRunResult.refusal.kind` is an existing closed union (`seal \| needs-human \| validation-verdict`) that the fix reads. The only type change is one additive member on `classifyRetryDecision`'s existing `signal` union (`artifacts.ts:5054`), which `adr-2026-08-19` D5 names as the extension point |
| External integrations | None — no provider, `gh`, or filesystem boundary is added or moved |
| Auth / permission surface | None |
| State machines | None new — one existing loop (`conductor.ts:8688` `while (attempt < stepMaxRetries)`) consults an existing pure classifier one branch earlier. Step topology, prerequisites, enforcement, gate ordering, `HaltClass`, and the refusal halt at `conductor.ts:10557` are all untouched |
| Config surface | None new — reuses `retry_routing.enabled` (`adr-2026-08-19` D4; defaults `true`, `config.ts:2132`) |
| Event surface | None new — reuses `retry_decision` (`adr-2026-08-19` D5), so `adr-2026-07-26` obliges no new sink declaration |
| Story count | 4 (needs-human refusal routes on attempt 1; `seal` refusal still reruns; the refusal reason is named rather than "produced no output"; the kill switch restores today's behavior) |
| Files touched | 3 engine files (`conductor.ts`, `artifacts.ts`, `step-runners.ts`) + tests. No docs surface — `coverage_binding` has no row in `docs/reference/configuration.md` or `docs/reference/steps.md`, and `retry_routing.enabled` is already documented |
| New runtime code | ~25 lines: one classifier signal, one guarded call at the step-runner failure branch, one non-empty `output` on the refusal result |

## Rationale

The defect is a placement error, not a design gap. `conductor.ts:10557` already owns the terminal
refusal halt; it simply sits **after** the retry loop it should be short-circuiting. The chosen fix
consults the classifier that `adr-2026-08-19` D2 already placed at the step-runner failure branch,
keyed on a discriminator the result already carries.

Two facts hold the tier at Small. First, the blast radius is enumerable: only two code paths
produce a `refusal` today (`step-runners.ts:2566` needs-human, `conductor.ts:8846` seal), so the
change cannot reach a step that does not already opt in. Second, no shared contract is edited — the
`unretryableInputs` facet, the `isVerdictStep` allowlist, and every existing signal keep their
current meaning; the diff is additive.

The one genuine care point is that `seal` refusals are retryable **by design**
(`adr-2026-08-24-refused-step-status` D4 names "the seal retries-exhausted path" as a deliberate
stamp site). That is a correctness constraint on a ~25-line change, pinned by a negative-path
story, not a source of architectural complexity.

→ **Small.** Architecture-diagram, architecture-review, conflict-check, and coherence-check are
skipped for this tier.

## Precedent

`wiring-check-retries-on-evidence-it-invalidated-it` (Tier S) is the closest analogue: a
retry-semantics correction confined to existing predicates in engine files, with no topology
change. The comparable-class `finish-publication-burns-its-retry-budget-on-an-un` (#1565) was rated
**M**, but that change extended two closed unions, added an observation-fingerprint type, and
reworked an eight-branch executor — none of which applies here.

## Issue label corroboration

Issue #2371 carries `bug` and `priority: critical` but no `size:` label, so there is no filed
estimate to agree or disagree with. Critical priority reflects blast radius (a spinning daemon),
not implementation size.
