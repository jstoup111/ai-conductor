# Architecture: Protected-target scan enforcement path

**Date:** 2026-08-19
**Feature:** plan-tasks-can-declare-a-protected-artifact-outcom
**Governing decision:** [adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts](../decisions/adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts.md) §4

## Scope

One pure function and its three callers. No new component, no new channel, no new store — this
feature repairs detection inside an existing seam.

## C4 L3 — component view (current, with the defect marked)

```mermaid
flowchart TB
  subgraph authoring["DECIDE authoring"]
    planskill["skills/plan §3<br/>sealed-artifact prohibition<br/><b>omits .docs/decisions</b><br/><b>Files: set only</b>"]
    cli["cli.ts:422<br/>conduct-ts plan-protected-targets<br/><b>advises adding Files:</b>"]
  end

  subgraph engine["engine"]
    scan["<b>scanPlanProtectedTargets</b><br/>plan-protected-targets.ts<br/><b>Files: XOR prose</b>"]
    parse["parsePlanTaskPaths<br/>plan-task-parse.ts"]
    seal["protected-artifact-seal.ts<br/>PROTECTED_ARTIFACT_DIRECTORIES (5)<br/>isProtectedArtifactPath / namesOwnFeature"]
  end

  subgraph gates["enforcement rungs"]
    land["land-spec.ts:242<br/>engineer land — BLOCKING throw"]
    remed["conductor.ts:10127<br/>remediation redirect detection<br/>(not a gate)"]
  end

  planskill -->|"tells author to run"| cli
  cli --> scan
  land --> scan
  remed --> scan
  scan --> parse
  scan --> seal

  classDef bug fill:#7f1d1d,stroke:#ef4444,color:#fff
  class scan,planskill,cli bug
```

**Defect surface (red).** Three components state the same wrong rule:

| Component | Wrong rule |
| --- | --- |
| `scanPlanProtectedTargets` | Scans `**Files:**` paths **or** body prose, never both. |
| `skills/plan` §3 | Prohibition scoped to the `**Files:**` set; omits `.docs/decisions/`. |
| `cli.ts:433` message | Advises adding `**Files:**` — the change that silences the prose scan. |

## Target state

```mermaid
flowchart LR
  task["plan task"] --> files["**Files:** paths"]
  task --> prose["body prose refs"]

  files --> union{"union<br/>(was XOR)"}
  prose --> union

  union --> pred["isProtectedArtifactPath<br/>AND NOT namesOwnFeature<br/><i>(unchanged)</i>"]
  pred -->|true| viol["violation<br/>{taskId, path}"]
  viol --> land["engineer land: throw"]
  viol --> cli["CLI: exit 1 + corrected guidance"]
```

The single structural change is `XOR → union`. The predicate, the return shape, the three callers,
and the `parsePlanTaskPaths` / seal-module dependencies are all unchanged — the governing ADR §4
requires the policy to reuse "the seal module's own directory set and own-feature predicate … so a
future change to what 'sealed' means propagates for free."

**Unchanged by design.** `namesOwnFeature` stays: the seal reports own-feature drift as a
`selfAmendment` and returns `ok: true` (`protected-artifact-seal.ts:1000`, `conductor.ts:6092`),
and the governing ADR §3 states the exclusion is deliberate.

## Deliberately absent

- No build-dispatch rung. The ADR: enforcement is "at authoring and land, not retroactive over
  merged plans." Measured exposure across 112 unshipped plans is effectively zero.
- No plan-declared bypass. Rejected by name in the governing ADR's alternatives.
- No marker-word detection for a prose reference carrying no path. Never observed, and measured at
  a 31% false-positive rate on a gate that fronts every land — see the architecture review's R1.
- No new event, ledger, or sidecar. The violation is a return value consumed in-process by the
  caller that asked for it.
