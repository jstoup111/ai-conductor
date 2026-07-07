# Sequence: daemon finish step with finish-record primitive (issue #281)

**Last updated:** 2026-07-07
**Scope:** Happy path + fail-closed path of the auto-mode finish step ending with
`conduct-ts finish-record` instead of manual marker writes.

## Diagram

```mermaid
sequenceDiagram
    participant D as Daemon conductor
    participant F as Finish skill session (haiku)
    participant P as conduct-ts finish-record
    participant G as gh / git
    participant M as Worktree .pipeline
    participant C as Completion gate (artifacts.ts)

    D->>F: dispatch /finish (auto-mode prompt: end with finish-record)
    F->>F: GATE 0, fresh verification, push + PR (/pr skill)
    F->>P: finish-record --choice pr --pr-url «url» --pipeline-dir «abs»
    P->>G: gh pr view --json url (non-empty?)
    P->>G: git merge-base --is-ancestor HEAD refs/remotes/origin/«branch»
    alt both checks pass
        P->>M: write pr_url into conduct-state.json
        P->>M: write finish-choice = pr (last, atomic)
        P-->>F: exit 0 (prints recorded choice + pr_url)
    else any check fails or errors
        P-->>F: exit non-zero, NO writes (fail-closed)
        F->>F: report blocker plainly, end without marker
    end
    D->>C: post-step completion check
    C->>M: read finish-choice + conduct-state.json (fresh mtime)
    C-->>D: done=true (try 1) — or done=false when finish-record refused
```

## Legend

- `finish-choice` is written **last**: the gate requires both the marker and `pr_url`,
  so writing the state file first means a crash between the two writes cannot produce a
  marker-present/pr_url-missing half-state that confuses the gate's error reason.
- The gate re-runs its own push-evidence and halt-title checks regardless — the
  primitive passing does not bypass any existing verification.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-07 | Initial generation | DECIDE phase for issue #281 (engineer flow) |
