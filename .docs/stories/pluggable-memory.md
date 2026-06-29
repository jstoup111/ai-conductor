**Status:** Accepted

# Stories: Pluggable Memory — Phase 1

Source PRD: `.docs/specs/2026-06-29-pluggable-memory-source.md` (FR-1 … FR-13). Behavior-level —
no implementation mechanisms (those are deferred to architecture-review). Roles: **operator**
(configures projects), **agent/LLM** (performs all recall + persistence), **harness** (selects,
adopts, exposes — never retrieves).

---

## Story: Choose a memory platform per project

**Requirement:** FR-1

As an operator, I want to choose which memory platform backs a given project so that different
projects can use different memory while each behaves consistently.

### Acceptance Criteria
#### Happy Path
- Given a project with no platform chosen, when the harness runs, then the default built-in platform is active.
- Given a project where I have chosen an alternative platform, when the harness runs, then that platform is active for that project.
- Given two projects with different choices, when each runs, then each uses its own chosen platform independently.
- Given any project, when its platform is resolved, then exactly one platform is active (no per-category mixing); switching changes the whole project.

#### Negative Paths
- Given a project's platform choice, when an unrelated project runs, then the unrelated project's active platform is unchanged (no cross-project leakage).
- Given a project with no choice recorded, when it runs, then it never errors or blocks — it silently uses the default.

### Done When
- [ ] A run of a project with no selection demonstrably uses the default platform.
- [ ] A run of a project with an alternative selection demonstrably uses that platform.
- [ ] Two projects with differing selections each use their own, verified in their respective runs.

---

## Story: Invalid or unavailable platform falls back to the default

**Requirement:** FR-2

As an operator, I want a bad or unreachable platform selection to degrade safely so a
misconfiguration never breaks a run.

### Acceptance Criteria
#### Happy Path
- Given a valid, available platform selection, when the harness runs, then that platform is used with no warning.

#### Negative Paths
- Given a selection naming a platform that does not exist, when the harness runs, then it reports the problem clearly and uses the default platform, and the run continues.
- Given a selected platform that exists but is unavailable at run start, when the harness runs, then it reports the unavailability and falls back to the default, and the run continues.
- Given an empty or malformed selection, when the harness runs, then it is treated as "no selection" → default, with a clear note, never a crash.

### Done When
- [ ] An unknown-platform selection produces a clear report + default fallback + a completed run.
- [ ] An unavailable selected platform produces a report + default fallback + a completed run.
- [ ] A malformed selection resolves to the default without error.

---

## Story: The agent performs all memory retrieval (harness performs none)

**Requirement:** FR-3 *(architectural invariant)*

As a maintainer, I want retrieval to be the agent's job so the harness never owns search,
ranking, or relevance — which would be redundant and less capable than the agent + platform.

### Acceptance Criteria
#### Happy Path
- Given an active platform, when memory is recalled during a run, then the recall is performed by the agent against that platform (the harness only makes the platform available).

#### Negative Paths
- Given the whole harness, when inspected, then it contains no search, ranking, relevance, or embedding logic over memory (the invariant holds — no such behavior exists to exercise).
- Given a request to "find relevant memory," when handled, then the harness does not compute relevance itself; it relies on the agent (and the platform the agent queries).

### Done When
- [ ] A run shows recall occurring via the agent against the active platform.
- [ ] Inspection confirms the harness has no memory search/ranking/relevance/embedding behavior.

---

## Story: A platform supplies the agent guidance to recall and persist

**Requirement:** FR-4

As an operator, I want each non-default platform to carry the guidance the agent needs so that
adopting a platform also makes the agent able to use it correctly.

### Acceptance Criteria
#### Happy Path
- Given a non-default platform is active, when the agent recalls or persists memory, then the platform's recall/persist guidance is in effect and the agent follows it.

#### Negative Paths
- Given a non-default platform whose guidance is missing or incomplete, when the agent attempts recall/persist, then it has a defined, safe behavior (clear degradation, not silent incorrect behavior).
- Given the default platform, when active, then the existing recall guidance applies (no separate guidance required — see FR-16/parity).

### Done When
- [ ] With a non-default platform active, the agent's recall/persist follows that platform's guidance.
- [ ] Missing/incomplete guidance yields a defined safe behavior, not silent misbehavior.

---

## Story: Memory is durable and shared across a project's worktrees

**Requirement:** FR-5

As an operator running multiple worktrees, I want one durable memory so what I learn in one
worktree is available in the others and is not lost when a worktree is removed.

### Acceptance Criteria
#### Happy Path
- Given memory written while working in worktree A, when I work in sibling worktree B of the same project, then that memory is available in B.
- Given memory written in worktree A, when worktree A is removed, then the memory persists.
- Given memory is one set per project (branch-independent), when I write it on any branch's worktree, then it is visible everywhere immediately (not gated on a merge) — accepting that memory from a later-abandoned branch also persists.

#### Negative Paths
- Given a worktree is removed, when the removal completes, then no shared project memory is deleted as a side effect.
- Given two worktrees of the same project write memory close in time, when both complete, then both entries persist (no clobber or loss of one).
- Given a worktree of a *different* project, when it writes memory, then it does not appear in this project's memory (per-project isolation preserved).

### Done When
- [ ] A memory written in one worktree is observable in a sibling worktree.
- [ ] A memory survives removal of the worktree that wrote it.
- [ ] Concurrent writes from two worktrees both persist; cross-project writes stay isolated.

---

## Story: Adopt a platform safely and idempotently

**Requirement:** FR-6

As an operator, I want to adopt a memory platform for a project in one deliberate action that
sets it up, without risk of clobbering my existing configuration.

### Acceptance Criteria
#### Happy Path
- Given a project, when I adopt a platform (including any required setup and credentials for an external one), then the platform is ready and the agent can recall/persist with it.

#### Negative Paths
- Given a platform already adopted, when I adopt it again, then nothing is duplicated and no error occurs (idempotent).
- Given a project that already has other configuration (including other platforms), when I adopt a platform, then the existing configuration is left intact (no clobber).
- Given an external platform that requires credentials, when I adopt it without providing them, then I get a clear prompt/notice rather than a broken half-configured state.
- Given an adoption that is interrupted partway, when I re-run it, then it completes cleanly with no corrupt or partial state left behind.

### Done When
- [ ] Adopting a platform makes it usable by the agent in that project.
- [ ] Re-adopting is a clean no-op (no duplication, no error).
- [ ] Pre-existing configuration/other platforms are untouched by an adoption.
- [ ] Missing credentials produce a clear notice, not a broken state.

---

## Story: Remove or disable a platform cleanly

**Requirement:** FR-7

As an operator, I want to remove or disable a platform and have the project return to the
default, without disturbing anything else.

### Acceptance Criteria
#### Happy Path
- Given a project using an adopted platform, when I remove/disable it, then the project falls back to the default platform and the agent recalls from the default.

#### Negative Paths
- Given a platform already removed, when I remove it again, then it is a clean no-op (idempotent).
- Given multiple platforms/config present, when I remove one, then the others and unrelated configuration are unaffected.
- Given the active platform is removed mid-project, when the next run occurs, then it cleanly uses the default with no dangling references to the removed platform.

### Done When
- [ ] Removing the active platform returns the project to the default, verified in a run.
- [ ] Re-removing is a clean no-op.
- [ ] Removing one platform leaves other platforms/config intact.

---

## Story: The default platform works with zero setup

**Requirement:** FR-8

As an operator, I want the default platform to work out of the box so I am never forced to
adopt anything to have memory.

### Acceptance Criteria
#### Happy Path
- Given a fresh project with no adoption, when the harness runs, then the default platform is active and recall/persist work — with no external service and no credentials.

#### Negative Paths
- Given no network access and no credentials, when the default platform is used, then it still works (it depends on nothing external).

### Done When
- [ ] A fresh project recalls/persists via the default platform with no setup.
- [ ] The default platform works with no network and no credentials.

---

## Story: The default platform preserves today's memory experience

**Requirement:** FR-9

As an operator, I want the default platform to match what I have now so adopting this model
costs me nothing in recall quality or organization.

### Acceptance Criteria
#### Happy Path
- Given the default platform, when memory is recalled, then the categories and recall quality match today's experience.

#### Negative Paths
- Given existing memory organized in today's categories, when it is read under the default platform, then no category or entry semantics are lost or altered.
- Given a recall that returns relevant prior entries today, when run under the default platform, then it returns the same relevant entries.

### Done When
- [ ] The default platform exposes the same categories the operator has today.
- [ ] Recall under the default returns the same relevant entries as today.

---

## Story: Existing memory behaviors work under any active platform

**Requirement:** FR-10

As an operator, I want the memory-using steps (the memory step, recall in design steps, project
setup) to work regardless of which platform is active.

### Acceptance Criteria
#### Happy Path
- Given the default platform, when the memory step / a recall-using design step / project setup runs, then each works as today.
- Given an alternative platform, when those same behaviors run, then each works (recall/persist via the active platform).

#### Negative Paths
- Given a switch from one platform to another, when those behaviors next run, then none of them break or error due to the switch.
- Given a design step that recalls prior decisions, when run under whichever platform is active, then it receives results from that active platform (not a stale or wrong source).

### Done When
- [ ] The memory step, a recall-using design step, and project setup all work under the default platform.
- [ ] The same behaviors work under an alternative platform.
- [ ] Switching platforms does not break any of these behaviors.

---

## Story: Migrating an existing project is safe and reversible

**Requirement:** FR-11

As an operator, I want moving an existing project to this model to preserve all my memory and
be reversible, so adoption carries no risk of loss.

### Acceptance Criteria
#### Happy Path
- Given an existing project with memory, when I migrate it to the new model, then all existing memory entries are preserved and available, and the migration is reversible.

#### Negative Paths
- Given a migration where the existing entries cannot first be safely preserved, when migration is attempted, then NO destructive change is made (it aborts safely, leaving the project as it was).
- Given a migration interrupted partway, when I re-run it, then no entries are lost and it completes (or remains safely reversible).
- Given an already-migrated project, when I migrate again, then it is a clean no-op.
- Given a migrated project, when I reverse the migration (a one-time rollback), then the project is restored to its pre-migration state; ongoing memory after migration accrues in the new model.

### Done When
- [ ] After migration, every pre-existing memory entry is still present and recallable.
- [ ] A migration that cannot safely preserve entries makes no destructive change.
- [ ] Migration is reversible (reverse restores prior state); re-migration is a no-op.

---

## Story: A new project needs no migration

**Requirement:** FR-12

As an operator, I want a newly set-up project to just use the default so I never face a
migration on greenfield work.

### Acceptance Criteria
#### Happy Path
- Given I set up a brand-new project, when it is initialized, then it uses the default platform with no migration step required.

#### Negative Paths
- Given new-project setup, when it runs, then it never triggers a migration or any destructive memory action.

### Done When
- [ ] A newly initialized project uses the default platform with no migration performed.
- [ ] New-project setup performs no migration/destructive memory action.

---

## Story: Memory problems never abort a run

**Requirement:** FR-13

As an operator, I want memory to be best-effort so a misconfigured or unavailable platform, or a
failed save, never blocks the SDLC flow.

### Acceptance Criteria
#### Happy Path
- Given a healthy active platform, when memory is read or written during a run, then it succeeds without interrupting the run.

#### Negative Paths
- Given a misconfigured platform, when the harness runs, then it surfaces a warning and the run continues to completion.
- Given the active platform is unavailable at recall time, when recall is attempted, then a warning is surfaced and the run continues.
- Given the active platform cannot accept a write (unavailable at persist time), when persistence is attempted, then the entry is saved to the **default local store** instead and a warning is surfaced — the memory is **not lost** and the run continues (FR-13a).
- Given repeated memory failures during a run, when they occur, then warnings are bounded (not flooding) and the run still completes.

### Done When
- [ ] A misconfigured platform yields a warning and a completed run.
- [ ] An unavailable platform at recall time yields a warning and a completed run.
- [ ] A write that the active platform cannot accept is saved to the default local store (not lost), warns, and the run completes.
- [ ] Repeated failures stay bounded in warnings and never abort the run.

---

## Coverage Map

| FR | Story |
|----|-------|
| FR-1 | Choose a memory platform per project |
| FR-2 | Invalid or unavailable platform falls back to the default |
| FR-3 | The agent performs all memory retrieval (harness performs none) |
| FR-4 | A platform supplies the agent guidance to recall and persist |
| FR-5 | Memory is durable and shared across a project's worktrees |
| FR-6 | Adopt a platform safely and idempotently |
| FR-7 | Remove or disable a platform cleanly |
| FR-8 | The default platform works with zero setup |
| FR-9 | The default platform preserves today's memory experience |
| FR-10 | Existing memory behaviors work under any active platform |
| FR-11 | Migrating an existing project is safe and reversible |
| FR-12 | A new project needs no migration |
| FR-13 | Memory problems never abort a run |
