# Complexity: generated-project-artifacts-delay-provider-startup

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | One config shape (a declared-exclusion list on `harness_self_host`) and one `ConductorEvent` union variant |
| External integrations | None new; two additional `git` invocations (`check-ignore`, `ls-files`) against the live checkout |
| Auth / permission surface | None added; the change sits INSIDE the self-host safety boundary that protects credentials, so a defect weakens an existing guard |
| State machines | None new; adds one fail-closed rejection path to the existing fingerprint → verify lifecycle |
| Story count | 5-6 (declaration honored; unsafe declaration rejected fail-closed; Git-ignored-but-undeclared still fingerprinted; same-named path outside declared scope still fingerprinted; duration signal emitted; absent declaration preserves current behavior) |
| Files touched | ~6-8: `self-host/live-boundary.ts`, `types/config.ts`, `engine/config.ts`, `engine/conductor.ts`, `types/events.ts`, plus tests and consumer config documentation |
| New runtime code | Yes — declaration plumbing into `fingerprintLiveBoundary`, a use-time proof function, validator branch, event emission |

## Rationale

Not Small: the change spans four engine modules plus the event union, adds a consumer-facing
configuration surface that `bin/migrate` and the config documentation must cover, and modifies a
safety guard whose failure mode is a silently blinded boundary rather than a visible error. The
use-time proof (each declared path must be Git-ignored and hold zero tracked files, re-verified
every fingerprint) is genuine new logic with its own fail-closed halt path, so it needs an
architecture review of where the proof runs relative to the walk and what happens when `git` itself
fails.

Not Large: no new subsystem, no schema migration, no cross-process coordination, and the blast
radius is one function's input plus one additive event variant. The existing
`harness_self_host` validator, the existing `isExcluded`/`manifest` walk, and the existing
`this.events` emitter are all reused rather than replaced.

→ **Medium.** Architecture-diagram, **lightweight** architecture-review, conflict-check, and
coherence-check all apply.

## Sequencing constraint

`harness_self_host` rejects unknown keys fail-closed (`engine/config.ts:1401`), so an engine
predating this key HALTs on a config that declares it. The engine change must ship and be deployed
before this repository's own `.ai-conductor/config.yml` declares an exclusion.

> **Amended 2026-09-21 by #1219:** the tier stays **M**, but the signals above no longer describe
> the feature. Under operator resolution R-1 the declaration mechanism is out of scope, so there is
> no new config shape, no `git` oracle, no validator branch, and the sequencing constraint above no
> longer applies — no config key is added. What remains: one additive `ConductorEvent` variant with
> its compile-enforced `EVENT_SINKS` declaration, timing instrumentation inside `manifest()`, one
> emission site in `conductor.ts`, and the render-path wiring
> (`adr-2026-07-10-intra-step-build-progress-events`). Roughly 4-6 files and 3 stories.
>
> **Why M and not S**, having reassessed rather than kept the label by inertia: the work still
> spans the sinks registry, the daemon renderer, and the OTel visualizer as compile-enforced
> exhaustiveness obligations, and it edits a module inside the self-host safety boundary. That is
> more than the single-surface change the Small tier describes. Architecture-diagram,
> architecture-review, conflict-check, and coherence-check therefore all still apply.
