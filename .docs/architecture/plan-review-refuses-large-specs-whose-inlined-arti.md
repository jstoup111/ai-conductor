# Sequence: plan review prompt carries an index, not every cited ADR

**Last updated:** 2026-10-24
**Scope:** Proposed flow for #3278. The round-1 plan-review prompt keeps the plan, the stories and
the in-scope ADR decisions whose text differs from the spec's merge base (plus every decision of an
ADR the spec adds) verbatim. Every other in-scope decision, and the coherence artifact, becomes an
index entry (id, title, worktree path) that the read-only reviewer opens with its own read tools. The prompt budget defaults to 400,000 characters,
and the operator can raise it with `plan_review.max_prompt_chars` or once with a CLI flag. An over-budget prompt is refused
before dispatch, naming each section's size, what to change, and the override. Validation still
grounds findings against the full artifacts. Round 2 keeps today's changed-only selection. There is
no new process, store, persisted schema, event or land rung. The flow extends the plan-review
runner, the ADR scope helper, the config surface, the `compose plan-review` CLI and the reviewer
brief.

## Diagram

```mermaid
sequenceDiagram
  participant Op as Operator
  participant Entry as compose plan-review / conduct step runner
  participant Cfg as Harness config
  participant Run as Plan-review runner
  participant Scope as ADR scope
  participant Prov as Read-only reviewer
  participant WT as Worktree .docs and source
  participant Val as Finding validator

  Op->>Entry: run plan review, optional --max-prompt-chars «n»
  Entry->>Cfg: read configured prompt budget
  Entry->>Run: worktree, plan stem, budget = flag, else config, else 400000
  Run->>WT: read plan, stories, coherence, changed paths, in-scope ADRs, merge-base ADR texts
  Run->>Scope: plan text, changed paths, ADR texts, merge-base ADR texts
  Scope-->>Run: changed decisions verbatim, every other in-scope decision as an index entry
  alt round 1
    Note over Run: inline = plan + stories + changed decisions + candidates
    Note over Run: index = unchanged «adr-stem»#D«n» with title and path, coherence path
  else round 2
    Note over Run: inline = changed tasks, stories and decisions only, as today
  end
  Run->>Run: measure prompt against budget
  alt over budget
    Run-->>Entry: refusal naming each section size, the largest sections to trim, and the override
    Entry-->>Op: refusal, exit 1, no reviewer dispatched
  else within budget
    Run->>Prov: prompt with inline sections and index, read-only, native schema
    Prov->>WT: open indexed ADRs, coherence and source before citing them
    Prov-->>Run: findings
    Run->>Val: findings against full plan, stories, ALL in-scope ADR texts, source
    Val-->>Run: accepted findings
    Run->>WT: write .docs/plan-review/«stem».md as today
    Run-->>Entry: artifact
    Entry-->>Op: findings or plan review clean
  end
```

## Legend

- **Changed decision** is an in-scope decision whose passage text differs from the same
  decision at the spec's merge base (`resolveIdeaFiles` already resolves it), or any decision of
  an ADR the spec adds. An amendment note sits inside its decision's passage, so an amended
  decision is a changed one. Changed decisions stay inline because they are what the spec amends.
- **Indexed decision** is every other in-scope decision, whether its ADR is cited or changed
  elsewhere. It becomes an index entry with its title and worktree path, with no passage text.
- **Coherence** becomes one index entry with its worktree path.
- **Validator** is unchanged: it grounds quoted passages against the full artifact texts, so a
  finding quoting an indexed ADR still validates.
- **Budget** precedence is the CLI flag, then the config key, then the 400,000-character default.
  The refusal happens before any provider is dispatched, so it spends no tokens.
- **Round 2** keeps the existing digest-based changed-only selection; only the budget and refusal
  wording change for it.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-24 | Initial generation | #3278: plan review refuses Large specs over 400k characters |
| 2026-10-24 | Inline rule narrowed to changed decisions; config block named | Architecture review: on #2945 every cited ADR was changed, so whole-ADR inlining saved nothing |
