# Sequence: HALT → re-dispatch → resume, with one PR per branch

**Last updated:** 2026-08-09
**Scope:** the deadlock flow reported in jstoup111/ai-conductor#1415 and the target flow that
replaces it. Covers PR birth, HALT decoration, and the deterministic clear on a successful
re-dispatch.

## Diagram — today (deadlock)

```mermaid
sequenceDiagram
  participant D as daemon
  participant C as conductor
  participant A as build agent
  participant E as escalateBuildFailure
  participant GH as GitHub

  D->>C: dispatch build attempt 1
  C->>A: run plan task needing the retained draft PR
  A->>GH: gh pr list --head «branch»
  GH-->>A: no PR
  A-->>C: HALT — needs authorization to push and create the retained draft PR
  C->>E: escalate irrecoverable HALT
  E->>GH: push «branch» + gh pr create --draft
  GH-->>E: PR «N» titled needs-remediation «branch», labelled, marker in body
  D->>C: dispatch build attempt 2
  C->>A: re-run the same plan task
  A->>GH: gh pr list --head «branch»
  GH-->>A: PR «N» — a remediation placeholder
  A-->>C: HALT — no retained draft PR exists
  Note over C,GH: SHIP entry is never reached, so the repair<br/>bound to it never runs. The label stays,<br/>ci-fix and mergeable-sweep stay suppressed.
```

## Diagram — target

```mermaid
sequenceDiagram
  participant D as daemon
  participant C as conductor
  participant A as build agent
  participant E as escalateBuildFailure
  participant GH as GitHub

  D->>C: dispatch build attempt 1
  C->>GH: BUILD entry — first commit over base, push + gh pr create --draft
  GH-->>C: PR «N» titled feat «desc», draft, no halt label
  C->>C: persist pr_url in durable feature state
  C->>A: run plan task needing the retained draft PR
  A->>GH: resolve retained PR
  GH-->>A: PR «N» — a live implementation PR
  A-->>C: HALT for an unrelated reason
  C->>E: escalate irrecoverable HALT
  E->>GH: add needs-remediation label + halt comment to PR «N»
  Note over E,GH: no second PR is created — the slot is not contested
  D->>C: operator clears HALT, dispatch attempt 2
  C->>GH: resolve retained PR, then clear the halt state
  GH-->>C: label removed, marker stripped, title floored to feat «desc»
  C->>A: re-run the plan task against PR «N»
  A-->>C: task completes — build proceeds
  Note over GH: ci-fix and mergeable-sweep are eligible again<br/>because the label is genuinely gone
```

## Legend

- **Today** — the retry finds the placeholder and refuses it, and every repair mechanic is
  reachable only from SHIP entry, a phase this flow never reaches. The result is a loop that
  burns the attempt budget re-asking one question.
- **Target** — the PR is born before any task can need it, the HALT is a *decoration* on that
  PR, and clearing the HALT plus a re-dispatch is sufficient to resume. No operator edits a
  title, a body, or a label by hand.
- **Not shown** — a HALT that occurs before the branch has any commit over base. There is no PR
  to decorate in that window; the escalation surface for it is an open question carried into
  `/architecture-review`.
- `«»` marks variable parts of labels (PR numbers, branch names, descriptions).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-09 | Initial generation | DECIDE phase for issue #1415 (engineer session) |
