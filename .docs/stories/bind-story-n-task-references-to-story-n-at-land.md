**Status:** Accepted

# Stories: Bind story-N task references to Story N at land (#2174)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the plan task story-reference grammar shared by the plan-coverage collector and the two land-time coherence readers, plus the diagnostic text of the orphan-task finding. Multi-id story lines, the stories-file heading grammar, and the orphan-task rule itself remain outside this slice.

## Story 1: A task's story reference binds to the story it names

As a spec author, I want the natural `story-N` spelling on a task's story-reference line to bind to Story N, so that a plan does not orphan every task over a prefix word the parser eats.

### Acceptance Criteria

#### Happy Path

- Given a plan task whose story-reference value reads `story-3` and a stories artifact declaring Story 3, when land parses the plan, then the task binds to story id `3` and raises neither an orphan-task gap nor a plan-coverage gap for it.
- Given plan tasks whose story-reference values read `Story 3`, `3`, `epic-3`, and `3.2-1`, when land parses the plan, then they bind to story ids `3`, `3`, `3`, and `3.2-1` respectively.

#### Negative Paths

- Given a plan task whose story-reference value reads `stories-3`, when land parses the plan, then the cited id stays the whole token `stories-3` and is never silently reduced to `3`.
- Given a plan task whose story-reference value is empty, reads `none`, or reads `n/a`, when land parses the plan, then the task cites no story id and the existing supporting-purpose and orphan rules decide its fate unchanged.

### Done When

- [ ] One exported story-reference parser is the single implementation used by the plan-coverage collector and by both land-time coherence readers.
- [ ] Parser unit cases bind the four accepted spellings `story-3`, `Story 3`, `3`, and `epic-3` to their story ids and preserve a dotted-and-hyphenated id such as `3.2-1` unchanged.
- [ ] Parser unit cases leave `stories-3` whole and yield no id for an empty value, `none`, `n/a`, `prerequisite`, and `all`.
- [ ] A land-boundary integration lands a spec whose task story references use the `story-N` spelling with no orphan-task gap and no plan-coverage gap.

## Story 2: A reference that binds to nothing says so

As a spec author, I want a story reference that matches no story to be named in the land failure, so that a spelling the parser cannot bind is diagnosable without an operator debugging round.

### Acceptance Criteria

#### Happy Path

- Given a plan task cites a story id absent from the stories artifact, when the orphan-task check reports that task, then the reported item carries the cited id text alongside the accepted story-reference spellings.

#### Negative Paths

- Given a plan task carries no story-reference line at all and a type that is neither infrastructure nor refactor, when the orphan-task check reports that task, then the reported item names the absent reference line and carries no invented cited id.

### Done When

- [ ] The orphan-task finding for a task citing an absent story id carries that cited id text and the list of accepted spellings.
- [ ] The orphan-task finding for a task with no story-reference line names the absent line and carries no cited id.
- [ ] Every orphan-task finding keeps its existing `task-<id>` gap id and its existing task title.

## Negative-category review

Invalid input is the dominant category and is covered directly: an unrecognized prefix-like token (`stories-3`), the sentinel values that mean "no story", an empty value, and an id that names no story. Data integrity is covered by the requirement that a preserved id such as `3.2-1` is not mangled and that gap ids stay stable, so a corrected parser cannot silently re-key existing findings. Auth, timeout, concurrency, resource-exhaustion, partial-failure, dependency-unavailability, and cascade-deletion categories are inapplicable: the change is a pure, synchronous, in-memory text parse with no I/O, no shared mutable state, no external dependency, and no deletion. Idempotency is inherent — the parser is a pure function of its input text — so no separate dedup criterion is warranted.
