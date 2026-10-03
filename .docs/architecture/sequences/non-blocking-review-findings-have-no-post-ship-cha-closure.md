# Sequence: Close explicitly declared related issues on implementation merge

**Last updated:** 2026-09-30
**Scope:** Tasks 27–39: sealed declarations and shared FINISH verification.
**Validation:** Logical flows and plan updates approved by the operator 2026-09-30.

## Diagram

```mermaid
sequenceDiagram
  actor Author as Spec author
  participant Spec as Marker parser and spec land
  participant Seal as Protected closure descriptor
  participant Finish as Common FINISH coordinator
  participant Host as Guarded implementation PR boundary
  participant Bus as Existing event spine
  Author->>Spec: Top-level Closes-Also and optional origin
  alt Invalid explicit declaration
    Spec-->>Author: Refuse and name invalid entry
  else Valid declaration
    Spec->>Seal: Bind approved projection to source commit, path and digest
    Spec-->>Author: Spec publication uses non-closing Refs
    Note over Seal,Finish: Automatic rebase preserves authority, explicit reseal changes it
    Finish->>Seal: Revalidate active declaration against approved projection
    alt Drift, unreadable authority or transport mismatch
      Seal-->>Finish: Refuse publication and name incomplete coverage
    else Authority matches
      Seal-->>Finish: Deduplicated origin plus extra targets, including extra-only
      Finish->>Host: Guard ownership and read actual PR body and target base
      alt Unreadable body, refused guard or unsupported base
        Host-->>Finish: Typed incomplete or refused outcome
      else Authorized default-branch PR
        Note over Finish,Host: Older watched markers do not defer these closures
        Finish->>Host: Project only missing closing references, preserve other regions
        Finish->>Host: Re-read and verify every declared target
        Host-->>Finish: Complete or named missing linkage
      end
      Finish->>Bus: Emit linkage result
      alt Complete linkage
        Finish->>Finish: Continue ready and final completion
        Note over Host: Issue host closes targets on implementation merge
      else Incomplete linkage
        Finish-->>Author: Recoverable FINISH failure, preserve targets for retry
      end
    end
  end
```

## Legend

Targets are explicit declarations, not inferred from tracker prose. Armor and fenced content cannot
supply a declaration. The sealed projection excludes mutable owner/outcome fields. Extra-only specs
work without an originating issue. Legacy origin-only behavior remains valid.

Draft creation, body refresh and common FINISH share the same projection; FINISH re-observes remote
state before and after mutation. Fully qualified cross-repository targets are distinct. Existing
matching closing references are reused without duplicate lines. Partial retry repairs missing linkage
without a broad BUILD repair. Independent observed-close watches are outside this operation.

No direct issue-close call, issue-assignee mutation or automatic merge is introduced. The issue host
applies closing keywords when the implementation PR merges into its default branch.

[System context and flow index](../non-blocking-review-findings-have-no-post-ship-cha.md)

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-30 | Initial additional issue closure flow | PRD FR-13 through FR-16 |
| 2026-09-30 | Make merge-closure precedence explicit | Operator-approved conflict resolution |
| 2026-09-30 | Bind closure targets to the seal and shared FINISH completion | Plan update; approved ADR |
