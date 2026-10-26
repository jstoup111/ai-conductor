# Halt record

Status: halted
Slug: decide-artifacts-are-too-repetitive-for-people-to-
Class: needs-human
Halting step: rebase
Phase: SHIP
Branch: feat/daemon-decide-artifacts-are-too-repetitive-for-people-to-
Child: 3
Head SHA: 03b6b4fc7afc9e24b3095371cd5509b8194712e9
Halted at: 2026-10-26T18:59:38.433Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
restack conflict child 2
commit e49d3df7ef39454156ca1fe2b30ad57bc1c49da3; paths: src/conductor/src/engine/artifacts.ts, src/conductor/src/engine/as-built-projection.ts, src/conductor/src/engine/build-review-inputs.ts, src/conductor/src/engine/coverage-binding-decide-set.ts, src/conductor/src/engine/plan-stories-reference.ts, src/conductor/src/engine/prd-audit-projection.ts, src/conductor/src/engine/rebase.ts, src/conductor/src/engine/task-progress.ts, src/conductor/test/engine/feature-resolvers-manifest.test.ts
replay commit a469d461fcc8bf615defd151fe722dbfe9918006; src/conductor/src/engine/step-runners.ts conflict lines 5200-5373 (runCoverageBinding), src/conductor/src/engine/coverage-binding-decide-set.ts (deleted by upstream, modified by source), src/conductor/test/engine/manifest-routing-conduct.test.ts lines 9 and 115-144; source intends to route the coverage_binding stories/PRD/complexity reads through feature manifests and tests that via resolveCoverageBindingDecideSet and runCoverageBinding; upstream 879a4040f0 (#3411) retired the coverage_binding step and decide-set module and moved those same stories/complexity reads into slice-topology.ts loadSliceTopology (lines 234-268) with strict stories-path/stories-unreadable failure semantics; missing decision: whether manifest routing (and the source's test assertions) should be ported into the sealed slice-topology loader, including how a manifest-declared but missing stories artifact should fail there, or dropped as retired scope
```
