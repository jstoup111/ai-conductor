# ADR: Worktree-removal coverage is enforced by an AST structural guard with an exemption registry

**Date:** 2026-08-07
**Status:** APPROVED
**Deciders:** James (operator), engineer DECIDE session for the bin/teardown spec

## Context

PRD FR-10 requires that every worktree-removal path in the harness either invites the project
teardown step or is recorded in an explicit exemption list, and that a newly added removal
path **fails the project's own validation** until classified. FR-11 requires the exemption
list to be accurate at delivery.

This requirement is not incidental. `CLAUDE.md`'s design principle states that when an agent
or an author repeatedly misses a rule, the durable fix is machinery that rejects at the moment
of the mistake, never a stronger prose rule. The defect being fixed by this feature is itself
an invisible omission — a hook that was never invited on any removal path — so shipping the
fix while leaving its own coverage to authorial discipline would reproduce the failure mode
one level up.

### Grounded constraints (verified by direct read at HEAD `1fd6a9a97`)

| Claim | Basis | Confidence |
| --- | --- | --- |
| `src/conductor/test/structural/` exists and holds four suites: `fixture-portability`, `release-workflow`, `smoke-entry-point`, `test-execution-policy` | verified | 99% |
| `test-execution-policy.test.ts` parses sources with the **TypeScript compiler API** (`import ts from 'typescript'`), walks call expressions, and matches `execa`/`spawn`/`exec…` callees against argument shapes — including a `join('bin','setup')` form, not just string literals | verified | 97% |
| That precedent already models exactly the analysis this guard needs: recognizing a process call whose arguments name a specific command and subcommand | verified | 95% |
| Removal call sites today: `daemon-deps.ts:128`, `daemon-park-cli.ts:220` (via `worktree-shared.ts:72`), `park-reconciliation.ts:639`, `autoresolve.ts:338`, `engineer/worktree-authoring.ts:145` (via `worktree-shared.ts:72`), `worktree.ts:81` | verified | 96% |
| `engineer/worktree-authoring.ts` and `worktree.ts` never call `prepareWorktree`; the only two `prepareWorktree` callers are `daemon-deps.ts` and `autoresolve.ts:325` | verified | 95% |

### Assumption

- **A1 — `worktree-shared.ts`'s `removeWorktree` is shared by one in-scope caller
  (`daemon-park-cli`) and one exempt caller (`engineer/worktree-authoring`).** *Basis:
  verified.* *Confidence: 96%.* **Load-bearing**, because it rules out the obvious design of
  putting teardown inside that shared helper — doing so would silently pull the
  operator-excluded engineer path into scope. The decision below accounts for it by keying
  the guard on the **calling module**, not on the helper.

No unconfirmed load-bearing assumption remains; this ADR is safe to approve.

## Options Considered

### Option A: put teardown inside `worktree-shared.removeWorktree`, no guard
- Pros: one line; nothing to enforce.
- Cons: **wrong by A1** — it silently teardowns engineer authoring worktrees, which the
  operator explicitly excluded. It also misses `daemon-deps` and `park-reconciliation`
  entirely, since both call `execa`/`runGit` directly rather than going through the helper.

### Option B: a text/regex grep over `src/**` for `worktree.*remove`
- Pros: trivial to write; no compiler dependency.
- Cons: matches comments, log strings, and documentation prose — `park-reconciliation.ts:327`
  and `:332` both discuss `git worktree remove` in comments and would trip it. A guard whose
  normal state is false positives gets suppressed, which is worse than no guard. It also
  cannot see the `runGit(['worktree','remove',…])` array form without a second, unrelated
  pattern.

### Option C: an AST structural guard keyed on the calling module, with an exemption registry ← selected
- Pros: matches the established `test-execution-policy.test.ts` precedent, including its
  handling of both literal and array/`join` argument forms; sees real call expressions rather
  than text, so comments and log strings are invisible to it; keying on the calling module
  correctly separates `daemon-park-cli` from `engineer/worktree-authoring` even though both
  reach the same helper.
- Cons: more code than a grep; the exemption registry needs upkeep when the deferred
  `autoresolve` work lands.

### Option D: a runtime assertion instead of a test
- Cons: fires in production, on the removal path, after the leak has already been decided.
  The whole value is catching an unclassified path at authoring time.

## Decision

**A structural test in `src/conductor/test/structural/`, using the TypeScript compiler API,
that enumerates every module under `src/conductor/src/` containing a worktree-removal call and
asserts each is classified.**

**1. Detection.** A removal call is a call expression whose callee is a process-invoking
identifier (the existing `PROCESS_CALLS` set, plus the repo's `runGit`/`git` helpers) and
whose arguments name `worktree` followed by `remove` — recognized in both the literal-command
form (`execa('git', ['worktree','remove', …])`) and the array form used by
`park-reconciliation`. Comments and string logs are structurally invisible, resolving Option
B's false-positive problem. Following the precedent's own approach, an argument form the
analyzer cannot resolve statically is treated as a **match** (fail-closed), not a miss.

**2. Classification.** Every detected module must be in exactly one of two sets, both declared
in the test file itself:
- **Routed** — the module also calls the teardown runner. The test asserts the call is
  present, so deleting the invitation while leaving the removal fails the suite.
- **Exempt** — the module appears in an exemption registry: a literal array of
  `{ module, reason }` entries. A module in neither set fails the suite with a message naming
  the unclassified path and instructing the author to route or classify it.

**3. Keying on the calling module, not the helper.** Per A1, `worktree-shared.removeWorktree`
is deliberately *not* the enforcement point. `daemon-park-cli` is routed; `worktree-shared`
itself is exempt as a pass-through primitive that neither prepares nor decides.

**4. The exemption registry as delivered (FR-11).** Three entries, each with a substantive
reason:
- `autoresolve.ts` — *prepares its worktree and therefore leaks; deliberately deferred by
  operator decision, tracked separately.* Distinguished in the reason text from the
  provisions-nothing cases, so a reader cannot mistake a known gap for a harmless one.
- `engineer/worktree-authoring.ts` — *never calls `prepareWorktree`; provisions nothing.*
- `worktree.ts` (`WorktreeManager.cleanup`) — *never calls `prepareWorktree`; provisions
  nothing.*
- `worktree-shared.ts` — *pass-through primitive; classification belongs to its callers.*

**5. Scope.** The guard reads `src/conductor/src/**` only. Test files, fixtures, and the guard
itself are excluded, matching the precedent's `thisFile` exclusion.

## Consequences

**Positive**
- A newly added removal path cannot silently leak; the suite fails until the author routes it
  or writes down why not.
- The `autoresolve` gap becomes a reviewed, reasoned entry in a registry rather than an
  absence nobody can see. A future author reading the registry learns the gap exists and that
  it was a decision.
- Deleting a teardown invitation while keeping the removal also fails, so the guard protects
  against regression as well as omission.

**Negative / accepted**
- The registry must be edited when the deferred `autoresolve` work lands — an intentional
  speed bump, and the mechanism by which that work gets closed out rather than forgotten.
- A refactor that moves a removal into a new module fails the suite until classified. This is
  the guard working, but it will occasionally surprise an author touching unrelated code; the
  failure message must therefore name the module, the classification options, and this ADR.

**Follow-on**
- `docs/contributing/testing.md` documents the guard and how to classify a new removal path.
